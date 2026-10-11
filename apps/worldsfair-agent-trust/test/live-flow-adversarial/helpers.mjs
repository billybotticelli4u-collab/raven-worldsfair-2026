/**
 * Shared adversarial fixtures for the live-flow fail-closed pack.
 *
 * KIMI 2026-10-11. Every helper builds a REAL 127.0.0.1 HTTP peer or a REAL
 * child process — no mocks of Agent A's code under test. Agent A always runs
 * its real discovery / card check / claim / challenged request / acceptance /
 * pinned-verifier path.
 */
import http from "node:http";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { agentBHandleEvidenceRequest, agentBMakeClaimMessage } from "../../src/lib/agentB.js";
import { createEvidenceResponse } from "../../src/lib/protocol.js";
import { BONK_SUBJECT } from "../../src/lib/ravenVerify.js";
import { makeCard, cardSha256 } from "../../src/live/cards.js";
import { EVIDENCE_CAPABILITY, VERIFIER_PIN } from "../../src/live/constants.js";
import { listenLoopback, loopbackJson, sendJson } from "../../src/live/http.js";
import { pidAlive } from "../../src/live/orchestrator.js";

export const PKG = fileURLToPath(new URL("../..", import.meta.url));
const HERE = fileURLToPath(new URL(".", import.meta.url));

/** wSOL — used to request a subject the honest BONK receipt does not cover. */
export const SOL_SUBJECT = {
  chain: "solana-mainnet",
  mintAddress: "So11111111111111111111111111111111111111112",
  tokenProgramAddress: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
};

/** The pinned vendor's own wrong-key test vector (a self-consistent signature
 * from a key that is NOT in ravenProductionTrustedKeys). */
export function loadVendorReceipt(name) {
  const p = path.resolve(
    HERE,
    "../../../../vendor/raven-receipt-verifier/packages/verify-js/fixtures/receipt-v1",
    name,
  );
  const parsed = JSON.parse(readFileSync(p, "utf8"));
  return parsed.input ?? parsed;
}

/** A port that is guaranteed closed right now (bind, release). */
export async function deadPort() {
  const s = http.createServer();
  await new Promise((res) => s.listen(0, "127.0.0.1", res));
  const port = s.address().port;
  await new Promise((res) => s.close(res));
  return port;
}

export async function registerCard(registryUrl, card) {
  return loopbackJson(`${registryUrl}/v0/register`, { method: "POST", body: { card } });
}

function honestEvidenceResponse(request) {
  const { challenge: _c, ...stripped } = request;
  const built = agentBHandleEvidenceRequest(stripped, "valid").evidenceResponse;
  built.challengeEcho = {
    nonce: request.challenge.nonce,
    requestMessageId: request.messageId,
    providerAgentId: request.challenge.providerAgentId,
    respondedAt: new Date().toISOString(),
  };
  return built;
}

/**
 * A rogue Agent B: a real 127.0.0.1 HTTP service with selectable misbehavior.
 *   "replay-same-nonce"   serve the FIRST captured response again on every later
 *                         evidence-request (identical challenge reuse)
 *   "echo-old-nonce"      answer later requests with a fresh response whose
 *                         challengeEcho.nonce is the FIRST request's nonce
 *                         (response to a different challenge)
 *   "echo-missing-time"   fresh response, challengeEcho without respondedAt
 *   "echo-stale"          fresh response, respondedAt 60 s in the past
 *   "echo-future"         fresh response, respondedAt 60 s in the future
 *   "field-flip"          first response's receipt gets ONE field altered
 *                         without re-signing, then replayed to every request
 *   "http-500"            evidence-request -> 500 agent_b_error (VALID JSON error
 *                         body; Agent A sees an error object, no response object)
 *   "malformed-json-body" evidence-request -> 200 with a GENUINELY MALFORMED JSON
 *                         body (truncated bytes, JSON content-type); Agent A's
 *                         parser must fail closed on the unparseable bytes
 *   "live-predated-receipt"    response claims liveAcquisition:true and the
 *                         receipt timestamp is 60 s BEFORE challenge.issuedAt
 *                         (live-path challenge-binding gate must refuse)
 *   "live-invalid-receipt-timestamp" response claims liveAcquisition:true and
 *                         the receipt timestamp is unparseable
 *   "fixture-card-claims-live" response claims liveAcquisition:true while the
 *                         card (and Agent A's transcript) says retained_fixture;
 *                         receipt timestamp moved just AFTER the challenge so
 *                         the binding gate passes and the tampered receipt
 *                         reaches verification
 *   "oversized-response"  evidence-request -> 200 with a >64 KiB JSON body
 * cardTamper: if set, the /.well-known card is the registered card with these
 * fields changed after listing (capability / endpoint / verifierPin variants).
 */
export async function startRogueB(t, { agentId, registryUrl, behavior, cardTamper = null }) {
  let card = makeCard({
    agentId,
    role: "evidence-provider",
    endpoint: null, // filled after listen
    capabilities: [EVIDENCE_CAPABILITY],
    verifierPin: VERIFIER_PIN,
    subjects: [{ ...BONK_SUBJECT }],
    evidenceSource: "retained_fixture",
  });
  let firstResponse = null;
  let firstNonce = null;

  const handle = await listenLoopback(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/.well-known/raven-agent.json") {
      const served = cardTamper ? { ...card, ...cardTamper } : card;
      return sendJson(res, 200, served);
    }
    if (req.method === "POST" && url.pathname === "/v0/claim") {
      return sendJson(res, 200, {
        protocol: "raven-agent-trust-live/0",
        providerAgentId: agentId,
        claim: agentBMakeClaimMessage("valid"),
      });
    }
    if (req.method === "POST" && url.pathname === "/v0/evidence-request") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const request = JSON.parse(body || "{}").request;

      if (behavior === "http-500") {
        return sendJson(res, 500, { error: "agent_b_error" });
      }
      if (behavior === "malformed-json-body") {
        // Status 200 and a JSON content-type, but the body is truncated,
        // unparseable bytes — a genuinely malformed JSON response to Agent A.
        res.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        });
        return res.end('{"protocol":"raven-agent-trust-live/0","response":{"challengeEcho":{"nonce":"deadbeef');
      }
      if (behavior === "oversized-response") {
        const payload = JSON.stringify({ protocol: "raven-agent-trust-live/0", response: honestEvidenceResponse(request), padding: "x".repeat(70 * 1024) });
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(payload);
      }
      if (behavior === "live-predated-receipt" ||
          behavior === "live-invalid-receipt-timestamp" ||
          behavior === "fixture-card-claims-live") {
        // Live-path rogues (Billy 2's challenge-binding gate, 005c84a): the
        // response CLAIMS live acquisition; the receipt timestamp is moved
        // relative to THIS request's challenge.issuedAt.
        const response = honestEvidenceResponse(request);
        const issuedMs = Date.parse(request.challenge?.issuedAt ?? "");
        if (behavior === "live-predated-receipt") {
          response.evidence = { ...response.evidence, timestamp: new Date(issuedMs - 60_000).toISOString() };
        } else if (behavior === "live-invalid-receipt-timestamp") {
          response.evidence = { ...response.evidence, timestamp: "not-a-time" };
        } else {
          response.evidence = { ...response.evidence, timestamp: new Date(issuedMs + 1_000).toISOString() };
        }
        response.source = { ...(response.source ?? {}), liveAcquisition: true };
        return sendJson(res, 200, { protocol: "raven-agent-trust-live/0", response });
      }
      if (behavior === "replay-same-nonce" && firstResponse) {
        return sendJson(res, 200, { protocol: "raven-agent-trust-live/0", response: firstResponse });
      }

      const response = honestEvidenceResponse(request);
      if (behavior === "echo-old-nonce" && firstNonce) {
        response.challengeEcho.nonce = firstNonce;
      } else if (behavior === "echo-missing-time") {
        delete response.challengeEcho.respondedAt;
      } else if (behavior === "echo-stale") {
        response.challengeEcho.respondedAt = new Date(Date.now() - 60_000).toISOString();
      } else if (behavior === "echo-future") {
        response.challengeEcho.respondedAt = new Date(Date.now() + 60_000).toISOString();
      } else if (behavior === "field-flip") {
        if (firstResponse) {
          return sendJson(res, 200, { protocol: "raven-agent-trust-live/0", response: firstResponse });
        }
        const receipt = response.evidence;
        response.evidence = { ...receipt, disclaimer: `${receipt.disclaimer} [one field altered without re-signing]` };
      }

      if (behavior === "replay-same-nonce" || behavior === "field-flip") firstResponse ??= response;
      firstNonce ??= request.challenge.nonce;
      return sendJson(res, 200, { protocol: "raven-agent-trust-live/0", response });
    }
    return sendJson(res, 404, { error: "not_found" });
  }, 0);

  card = { ...card, endpoint: handle.url };
  const registered = await registerCard(registryUrl, card);
  if (registered.status !== 201) throw new Error(`rogue_registration_failed_${registered.status}`);
  t.after(() => handle.close());
  return { ...handle, agentId, card, cardSha256: await cardSha256(card) };
}

/**
 * A REAL hung Agent B child process (fixtures/hung-agent.mjs): READY line,
 * serves card + claim, never answers evidence-request. Resolves with the
 * process record; t.after kills it and asserts it is gone (zero strays).
 */
export function spawnHungAgent(t, { agentId = "agent-b-hung" } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--experimental-strip-types", "--disable-warning=ExperimentalWarning",
        path.join(HERE, "fixtures", "hung-agent.mjs")],
      {
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          PATH: process.env.PATH ?? "",
          RAVEN_LIVE_AGENT_CONFIG: JSON.stringify({ agentId }),
          RAVEN_LIVE_MAX_LIFETIME_MS: "120000",
        },
      },
    );
    const timer = setTimeout(() => reject(new Error("hung_agent_start_timeout")), 15_000);
    let buf = "";
    let stderr = "";
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.stdout.on("data", (d) => {
      buf += d.toString();
      const nl = buf.indexOf("\n");
      if (nl === -1) return;
      clearTimeout(timer);
      try {
        const ready = JSON.parse(buf.slice(0, nl));
        if (ready.event !== "ready") throw new Error("bad_ready_line");
        const record = { child, pid: ready.pid, url: ready.url, agentId: ready.agentId, stderr };
        t.after(async () => {
          if (!pidAlive(record.pid)) return;
          child.kill("SIGKILL");
          await new Promise((res) => {
            const k = setTimeout(res, 3_000);
            child.once("exit", () => { clearTimeout(k); res(); });
          });
          if (pidAlive(record.pid)) throw new Error(`stray_process_${record.pid}`);
        });
        resolve(record);
      } catch (e) {
        reject(e);
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`hung_agent_exited_${code}: ${stderr.trim().slice(0, 200)}`));
    });
  });
}

export { createEvidenceResponse, honestEvidenceResponse };
