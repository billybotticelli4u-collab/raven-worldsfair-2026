/**
 * Agent A as a standalone HTTP process on 127.0.0.1.
 *   POST /v0/run { targetAgentId?, subject? } -> discovery + exchange transcript
 * Config via RAVEN_LIVE_AGENT_CONFIG: { registryUrl, evidencePolicy }.
 * There is deliberately no way to inject trusted keys into this process.
 */
import { pathToFileURL } from "node:url";
import { createAgentA } from "./agentACore.js";
import { listenLoopback, readJsonBody, sendJson } from "./http.js";
import { runAsChildProcess } from "./childProcess.js";

export async function startAgentA(config) {
  const agent = createAgentA({ registryUrl: config.registryUrl, evidencePolicy: config.evidencePolicy ?? "fixture" });
  const handle = await listenLoopback(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method === "POST" && url.pathname === "/v0/run") {
        const body = await readJsonBody(req);
        const result = await agent.run({
          targetAgentId: typeof body.targetAgentId === "string" ? body.targetAgentId : null,
          ...(body.subject ? { subject: body.subject } : {}),
        });
        return sendJson(res, 200, result);
      }
      return sendJson(res, 404, { error: "not_found" });
    } catch (err) {
      return sendJson(res, 500, { error: "agent_a_error", message: err instanceof Error ? err.message : "error" });
    }
  });
  return { ...handle, agentId: "agent-a" };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runAsChildProcess("agent-a", async () => {
    const config = JSON.parse(process.env.RAVEN_LIVE_AGENT_CONFIG ?? "{}");
    const a = await startAgentA(config);
    return { url: a.url, agentId: a.agentId, close: a.close };
  });
}
