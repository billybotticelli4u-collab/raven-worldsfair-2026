/**
 * Agent A — discovery, live proof request, verification, decision.
 *
 * 1. Query the registry; evaluate every card (capability, verifier pin,
 *    subject, shape). Ineligible cards are reported, never contacted.
 * 2. For a candidate: fetch its /.well-known card from the card's endpoint and
 *    require it to be byte-identical (canonical SHA-256) to the registry card
 *    — an endpoint that answers as someone else is refused.
 * 3. Ask for the claim, then send evidence.request carrying a fresh 32-byte
 *    nonce, issuedAt, requester/provider ids and the provider card hash.
 * 4. Accept the evidence.response only if it echoes THIS nonce (single use),
 *    names this provider, and its respondedAt is inside the freshness window
 *    by Agent A's real clock.
 * 5. Verify the receipt with the pinned verifier (unchanged) and let the
 *    existing Day-2 policy (../lib/agentA.js) decide PROCEED / REFUSE.
 *
 * Verification: default is the existing ravenVerifyEvidenceResponse at the
 * disclosed fixture time (liveAcquisition:false), exactly as the offline
 * demo. Transport freshness/nonce use the real clock. A caller may inject
 * `verifyEvidence` (same signature/shape) — see INTERFACE.md.
 */
import { randomBytes } from "node:crypto";
import { applyDecisionPolicy, createEvidenceRequest } from "../lib/agentA.js";
import { BONK_FIXTURE_NOW, BONK_SUBJECT, ravenVerifyEvidenceResponse } from "../lib/ravenVerify.js";
import { isProtocolMessage } from "../lib/protocol.js";
import { cardSha256, evaluateProviderCard } from "./cards.js";
import {
  CHALLENGE_BINDING_SKEW_MS,
  CLOCK_SKEW_MS,
  EVIDENCE_CAPABILITY,
  LIVE_PROTOCOL,
  RESPONSE_FRESHNESS_WINDOW_MS,
} from "./constants.js";
import { loopbackJson } from "./http.js";

export function createAgentA({
  registryUrl,
  agentId = "agent-a",
  verifyEvidence = null,
  challengeBindingSkewMs = CHALLENGE_BINDING_SKEW_MS,
  requestTimeoutMs = 5_000,
  windowMs = RESPONSE_FRESHNESS_WINDOW_MS,
  clock = () => new Date(),
} = {}) {
  if (typeof challengeBindingSkewMs !== "number" || !(challengeBindingSkewMs >= 0)) {
    throw new Error("challenge_binding_skew_invalid");
  }
  const consumedNonces = new Set();
  const outstanding = new Map();

  async function discover({ capability = EVIDENCE_CAPABILITY, subject = BONK_SUBJECT } = {}) {
    const { status, json } = await loopbackJson(`${registryUrl}/v0/agents`);
    if (status !== 200 || !json || !Array.isArray(json.agents)) throw new Error("registry_unavailable");
    const candidates = [];
    for (const entry of json.agents) {
      const verdict = evaluateProviderCard(entry.card, { capability, subject });
      const recomputed = await cardSha256(entry.card);
      if (recomputed !== entry.cardSha256) verdict.reasons.push("registry_hash_mismatch");
      candidates.push({
        agentId: entry.card?.agentId ?? null,
        endpoint: entry.card?.endpoint ?? null,
        cardSha256: entry.cardSha256,
        advertisedEvidenceSource: entry.card?.evidenceSource ?? null,
        eligible: verdict.reasons.length === 0,
        reasons: verdict.reasons,
        card: entry.card,
      });
    }
    return { query: { capability, subject }, candidates };
  }

  function refuse(agentIdTried, stage, reason, extra = {}) {
    return { agentId: agentIdTried, outcome: "REFUSE", stage, reason, ...extra };
  }

  /** One live exchange with one discovered candidate. */
  async function exchange(candidate, { subject = BONK_SUBJECT } = {}) {
    if (!candidate) return refuse(null, "discovery", "unknown_agent");
    if (!candidate.eligible) return refuse(candidate.agentId, "discovery", candidate.reasons[0] ?? "ineligible", { reasons: candidate.reasons });

    // 2. The endpoint must answer as the registered card.
    let wellKnown;
    try {
      wellKnown = await loopbackJson(`${candidate.endpoint}/.well-known/raven-agent.json`);
    } catch {
      return refuse(candidate.agentId, "card_check", "endpoint_unreachable");
    }
    if (wellKnown.status !== 200 || !wellKnown.json) return refuse(candidate.agentId, "card_check", "endpoint_card_unavailable");
    const servedHash = await cardSha256(wellKnown.json);
    if (servedHash !== candidate.cardSha256 || wellKnown.json.agentId !== candidate.agentId) {
      return refuse(candidate.agentId, "card_check", "endpoint_card_mismatch", {
        servedAgentId: wellKnown.json.agentId ?? null,
      });
    }

    // 3. Claim, then a challenged evidence.request.
    const claimRes = await loopbackJson(`${candidate.endpoint}/v0/claim`, { method: "POST", body: {} });
    const claimMessage = claimRes.json?.claim;
    if (claimRes.status !== 200 || !isProtocolMessage(claimMessage, "solana.claim")) {
      return refuse(candidate.agentId, "claim", "invalid_claim");
    }
    const s = claimMessage.claim.subject;
    if (!s || s.mintAddress !== subject.mintAddress || s.tokenProgramAddress !== subject.tokenProgramAddress || s.chain !== subject.chain) {
      return refuse(candidate.agentId, "claim", "claim_subject_not_requested");
    }
    let evidenceRequest;
    try {
      evidenceRequest = createEvidenceRequest(claimMessage);
    } catch {
      return refuse(candidate.agentId, "claim", "invalid_claim");
    }
    const nonce = randomBytes(32).toString("hex");
    const issuedAt = clock().toISOString();
    evidenceRequest.challenge = {
      nonce,
      issuedAt,
      requesterAgentId: agentId,
      providerAgentId: candidate.agentId,
      providerCardSha256: candidate.cardSha256,
    };
    outstanding.set(nonce, { providerAgentId: candidate.agentId, issuedAt });

    let wire;
    try {
      wire = await loopbackJson(`${candidate.endpoint}/v0/evidence-request`, {
        method: "POST",
        body: { protocol: LIVE_PROTOCOL, request: evidenceRequest },
        timeoutMs: requestTimeoutMs,
      });
    } catch {
      outstanding.delete(nonce);
      return refuse(candidate.agentId, "request", "provider_unreachable");
    }
    const evidenceResponse = wire.json?.response;
    const transport = acceptResponse(evidenceRequest, evidenceResponse);
    if (!transport.ok) {
      return refuse(candidate.agentId, "transport", transport.reason, { nonce, transport });
    }

    // 4b. Live path only: the receipt must have been issued for THIS challenge.
    // Applied when a live verifier is injected or the response claims live
    // acquisition; the default offline fixture path is untouched.
    if (verifyEvidence || evidenceResponse.source?.liveAcquisition === true) {
      const binding = checkChallengeBinding(evidenceRequest, evidenceResponse);
      if (!binding.ok) {
        return refuse(candidate.agentId, "challenge_binding", binding.reason, {
          nonce, transport, binding, advertisedEvidenceSource: candidate.card?.evidenceSource ?? null,
          evidenceSource: evidenceResponse.source ?? null,
        });
      }
    }

    // 5. Verify with the pinned verifier, then the unchanged Day-2 policy.
    const verificationResponse = verifyEvidence
      ? await verifyEvidence({ evidenceRequest, evidenceResponse, now: clock() })
      : await ravenVerifyEvidenceResponse({ evidenceRequest, evidenceResponse, now: BONK_FIXTURE_NOW });
    const decision = applyDecisionPolicy({ claimMessage, evidenceRequest, verificationResponse });
    return {
      agentId: candidate.agentId,
      outcome: decision.decision,
      stage: decision.decision === "PROCEED" ? "decided" : "verification",
      reason: decision.reason,
      nonce,
      transport,
      advertisedEvidenceSource: candidate.card?.evidenceSource ?? null,
      evidenceSource: evidenceResponse.source ?? null,
      disclosure: verificationResponse.result.disclosure,
      evidenceIdentity: verificationResponse.result.evidenceIdentity,
      exchange: [claimMessage, evidenceRequest, evidenceResponse, verificationResponse],
    };
  }

  /**
   * Transport checks on an incoming evidence.response. Single-use nonces:
   * a response is accepted at most once, and only for the request that is
   * outstanding under that exact nonce.
   */
  function acceptResponse(evidenceRequest, evidenceResponse) {
    const sent = evidenceRequest.challenge;
    if (!isProtocolMessage(evidenceResponse, "evidence.response")) return { ok: false, reason: "invalid_evidence_response" };
    const echo = evidenceResponse.challengeEcho;
    if (!echo || typeof echo.nonce !== "string") return { ok: false, reason: "challenge_echo_missing" };
    if (consumedNonces.has(echo.nonce)) return { ok: false, reason: "nonce_replayed" };
    if (echo.nonce !== sent.nonce) return { ok: false, reason: "nonce_mismatch_replay" };
    if (!outstanding.has(echo.nonce)) return { ok: false, reason: "nonce_not_outstanding" };
    if (echo.providerAgentId !== sent.providerAgentId) return { ok: false, reason: "provider_mismatch" };
    if (echo.requestMessageId !== evidenceRequest.messageId) return { ok: false, reason: "request_mismatch" };
    const respondedMs = Date.parse(echo.respondedAt);
    const nowMs = clock().getTime();
    const issuedMs = Date.parse(sent.issuedAt);
    if (!Number.isFinite(respondedMs)) return { ok: false, reason: "responded_at_invalid" };
    if (respondedMs < issuedMs - CLOCK_SKEW_MS || nowMs - respondedMs > windowMs) {
      return { ok: false, reason: "stale_response", respondedAt: echo.respondedAt, windowMs };
    }
    if (respondedMs > nowMs + CLOCK_SKEW_MS) return { ok: false, reason: "response_from_future" };
    consumedNonces.add(echo.nonce);
    outstanding.delete(echo.nonce);
    return { ok: true, reason: "accepted", respondedAt: echo.respondedAt, windowMs };
  }

  /**
   * receipt-v1 `timestamp` (signed body field, issuance/observation time) must
   * be >= challenge.issuedAt - challengeBindingSkewMs (default 5 s). Missing
   * evidence is left to the verifier (missing_evidence). The Agent A CLI
   * process (agentAServer.js) always uses the default.
   */
  function checkChallengeBinding(evidenceRequest, evidenceResponse) {
    const receipt = evidenceResponse.evidence;
    if (evidenceResponse.status !== "supplied" || receipt == null) return { ok: true, reason: "not_applicable" };
    const issuedAt = Date.parse(evidenceRequest.challenge?.issuedAt);
    const ts = typeof receipt.timestamp === "string" ? Date.parse(receipt.timestamp) : Number.NaN;
    const facts = { receiptTimestamp: typeof receipt.timestamp === "string" ? receipt.timestamp : null,
      challengeIssuedAt: evidenceRequest.challenge?.issuedAt ?? null, skewMs: challengeBindingSkewMs };
    if (!Number.isFinite(ts)) return { ok: false, reason: "receipt_timestamp_invalid", ...facts };
    if (!Number.isFinite(issuedAt) || ts < issuedAt - challengeBindingSkewMs) {
      return { ok: false, reason: "receipt_predates_challenge", ...facts };
    }
    return { ok: true, reason: "issued_after_challenge", ...facts };
  }

  /** Discovery -> try eligible candidates in registry order -> first PROCEED. */
  async function run({ capability = EVIDENCE_CAPABILITY, subject = BONK_SUBJECT, targetAgentId = null } = {}) {
    const discovery = await discover({ capability, subject });
    const attempts = [];
    let pool = discovery.candidates;
    if (targetAgentId) {
      const found = pool.find((c) => c.agentId === targetAgentId);
      attempts.push(found ? await exchange(found, { subject }) : refuse(targetAgentId, "discovery", "unknown_agent"));
    } else {
      for (const c of pool) attempts.push(await exchange(c, { subject }));
    }
    const selected = attempts.find((a) => a.outcome === "PROCEED") ?? null;
    return {
      protocol: LIVE_PROTOCOL,
      agentId,
      discovery: discovery.candidates.map(({ card: _card, ...rest }) => rest),
      attempts,
      selectedAgentId: selected?.agentId ?? null,
      outcome: selected ? "PROCEED" : "REFUSE",
    };
  }

  return { discover, exchange, acceptResponse, run, consumedNonces };
}
