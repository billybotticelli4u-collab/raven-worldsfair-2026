/**
 * Hung Agent B — a REAL child process for the timeout case.
 *
 * Serves its card and claim normally, then never answers
 * POST /v0/evidence-request (the socket is held open with no response).
 * Lifecycle follows the shared child-process contract: one READY line,
 * exits on stdin close / SIGTERM / SIGINT / 120 s cap.
 *
 * Config (RAVEN_LIVE_AGENT_CONFIG): { "agentId": "..." }
 */
import { pathToFileURL } from "node:url";
import { agentBMakeClaimMessage } from "../../../src/lib/agentB.js";
import { makeCard } from "../../../src/live/cards.js";
import { BONK_SUBJECT } from "../../../src/lib/ravenVerify.js";
import { EVIDENCE_CAPABILITY, VERIFIER_PIN } from "../../../src/live/constants.js";
import { listenLoopback, sendJson } from "../../../src/live/http.js";
import { runAsChildProcess } from "../../../src/live/childProcess.js";

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runAsChildProcess("agent-b", async () => {
    const config = JSON.parse(process.env.RAVEN_LIVE_AGENT_CONFIG ?? "{}");
    const agentId = config.agentId ?? "agent-b-hung";
    let card = null;
    const handle = await listenLoopback(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method === "GET" && url.pathname === "/.well-known/raven-agent.json") {
        return sendJson(res, 200, card);
      }
      if (req.method === "POST" && url.pathname === "/v0/claim") {
        return sendJson(res, 200, { protocol: "raven-agent-trust-live/0", providerAgentId: agentId, claim: agentBMakeClaimMessage("valid") });
      }
      if (req.method === "POST" && url.pathname === "/v0/evidence-request") {
        // Deliberate adversarial hang: consume the request, never respond.
        for await (const _chunk of req) { /* drain */ }
        return; // socket held open; client timeout must fire
      }
      return sendJson(res, 404, { error: "not_found" });
    }, 0);
    card = makeCard({
      agentId,
      role: "evidence-provider",
      endpoint: handle.url,
      capabilities: [EVIDENCE_CAPABILITY],
      verifierPin: VERIFIER_PIN,
      subjects: [{ ...BONK_SUBJECT }],
      evidenceSource: "retained_fixture",
    });
    return { url: handle.url, agentId, close: handle.close };
  });
}
