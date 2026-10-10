/**
 * Agent B as a standalone HTTP process on 127.0.0.1 (one variant per process).
 *
 *   GET  /.well-known/raven-agent.json -> this agent's card
 *   POST /v0/claim                     -> { claim: solana.claim }
 *   POST /v0/evidence-request          -> { response: evidence.response + challengeEcho }
 *
 * Variants (demo/test population — some are meant to be refused):
 *   honest            valid retained receipt fixture
 *   tamperer          one-field tampered fixture (integrity must fail)
 *   wrong-capability  card does not offer raven.receipt-v1 evidence
 *   bad-pin           card names a different verifier pin
 *   replayer          answers later requests with its first response (old nonce)
 *   stale             answers with a respondedAt two minutes in the past
 *   impostor          registers a card whose endpoint is another agent's URL
 *
 * Extension point: startAgentB(config, { evidenceProvider }) replaces the
 * fixture with any async (evidenceRequest) => evidence.response source
 * (see INTERFACE.md). The transport/challenge layer is unchanged.
 */
import { pathToFileURL } from "node:url";
import { agentBHandleEvidenceRequest, agentBMakeClaimMessage } from "../lib/agentB.js";
import { isProtocolMessage } from "../lib/protocol.js";
import { BONK_SUBJECT } from "../lib/ravenVerify.js";
import { CUSTOM_SOURCE_LABEL, EVIDENCE_CAPABILITY, FIXTURE_SOURCE_LABEL, LIVE_PROTOCOL, VERIFIER_PIN } from "./constants.js";
import { makeCard, cardSha256 } from "./cards.js";
import { listenLoopback, loopbackJson, readJsonBody, sendJson } from "./http.js";
import { runAsChildProcess } from "./childProcess.js";

export const VARIANTS = Object.freeze([
  "honest", "tamperer", "wrong-capability", "bad-pin", "replayer", "stale", "impostor",
]);
const OTHER_PIN = "raven-receipt-verifier@0000000000000000000000000000000000000000";

function fixtureMode(variant) {
  return variant === "tamperer" ? "tampered" : "valid";
}

function subjectFor(config) {
  return config.subject ? { ...config.subject } : { ...BONK_SUBJECT };
}

function claimMessageFor(config, claimProvider) {
  return claimProvider ? claimProvider(subjectFor(config)) : agentBMakeClaimMessage("valid");
}

function validRequestShape(request) {
  return isProtocolMessage(request, "evidence.request") &&
    request.from === "agent-a" && request.to === "agent-b" &&
    typeof request.claimId === "string" &&
    request.challenge && typeof request.challenge.nonce === "string" &&
    /^[0-9a-f]{64}$/.test(request.challenge.nonce);
}

export async function startAgentB(config, { evidenceProvider = null, claimProvider = null } = {}) {
  if (!VARIANTS.includes(config.variant)) throw new Error("unknown_variant");
  const agentId = config.agentId ?? `agent-b-${config.variant}`;
  let firstResponse = null;
  let card = null;

  const handle = await listenLoopback(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method === "GET" && url.pathname === "/.well-known/raven-agent.json") {
        return sendJson(res, 200, card);
      }
      if (req.method === "POST" && url.pathname === "/v0/claim") {
        return sendJson(res, 200, { protocol: LIVE_PROTOCOL, providerAgentId: agentId, claim: claimMessageFor(config, claimProvider) });
      }
      if (req.method === "POST" && url.pathname === "/v0/evidence-request") {
        const body = await readJsonBody(req);
        const request = body?.request;
        if (!validRequestShape(request)) return sendJson(res, 400, { error: "invalid_evidence_request" });
        if (request.challenge.providerAgentId !== agentId) {
          return sendJson(res, 409, { error: "request_addressed_to_other_agent" });
        }
        if (config.variant === "replayer" && firstResponse) {
          return sendJson(res, 200, { protocol: LIVE_PROTOCOL, response: firstResponse });
        }
        const response = evidenceProvider
          ? await evidenceProvider(stripChallenge(request), { agentId, subject: subjectFor(config) })
          : agentBHandleEvidenceRequest(stripChallenge(request), fixtureMode(config.variant)).evidenceResponse;
        const respondedAt = config.variant === "stale"
          ? new Date(Date.now() - 120_000).toISOString()
          : new Date().toISOString();
        response.challengeEcho = {
          nonce: request.challenge.nonce,
          requestMessageId: request.messageId,
          providerAgentId: agentId,
          respondedAt,
        };
        if (!firstResponse) firstResponse = response;
        return sendJson(res, 200, { protocol: LIVE_PROTOCOL, response });
      }
      return sendJson(res, 404, { error: "not_found" });
    } catch {
      return sendJson(res, 500, { error: "agent_b_error" });
    }
  }, config.port);

  const declaredEndpoint = config.variant === "impostor" && config.claimEndpoint
    ? config.claimEndpoint
    : handle.url;
  card = makeCard({
    agentId,
    role: "evidence-provider",
    endpoint: declaredEndpoint,
    capabilities: config.variant === "wrong-capability"
      ? ["evidence.request:other.attestation"]
      : [EVIDENCE_CAPABILITY],
    verifierPin: config.variant === "bad-pin" ? OTHER_PIN : VERIFIER_PIN,
    subjects: [subjectFor(config)],
    // Never advertise the fixture when another evidence source is plugged in.
    evidenceSource: config.evidenceSourceLabel ??
      (evidenceProvider ? (evidenceProvider.evidenceSourceLabel ?? CUSTOM_SOURCE_LABEL) : FIXTURE_SOURCE_LABEL),
  });

  if (config.registryUrl) {
    const reg = await loopbackJson(`${config.registryUrl}/v0/register`, { method: "POST", body: { card } });
    if (reg.status !== 201) throw new Error(`registration_failed_${reg.status}`);
  }
  return {
    ...handle,
    agentId,
    card,
    cardSha256: await cardSha256(card),
  };
}

function stripChallenge(request) {
  const { challenge: _c, ...rest } = request;
  return rest;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runAsChildProcess("agent-b", async () => {
    const config = JSON.parse(process.env.RAVEN_LIVE_AGENT_CONFIG ?? "{}");
    const b = await startAgentB(config);
    return { url: b.url, agentId: b.agentId, close: b.close };
  });
}
