/**
 * Discovery registry — a small Raven-run directory of agent cards on
 * 127.0.0.1. Agents register themselves; Agent A queries by capability.
 * The registry stores claims; it does not vouch for any agent.
 *
 *   POST /v0/register   { card }        -> { agentId, cardSha256 }
 *   GET  /v0/agents?capability=<cap>    -> { agents: [{ card, cardSha256 }] }
 */
import { pathToFileURL } from "node:url";
import { cardSha256, cardShapeReasons } from "./cards.js";
import { listenLoopback, readJsonBody, sendJson } from "./http.js";
import { LIVE_PROTOCOL } from "./constants.js";
import { runAsChildProcess } from "./childProcess.js";

const MAX_AGENTS = 32;

export async function startRegistry() {
  const entries = new Map();
  const handle = await listenLoopback(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method === "POST" && url.pathname === "/v0/register") {
        const body = await readJsonBody(req);
        const card = body?.card;
        const reasons = cardShapeReasons(card);
        if (reasons.length) return sendJson(res, 400, { error: "invalid_card", reasons });
        if (entries.has(card.agentId)) return sendJson(res, 409, { error: "agent_id_taken" });
        if (entries.size >= MAX_AGENTS) return sendJson(res, 429, { error: "registry_full" });
        const hash = await cardSha256(card);
        entries.set(card.agentId, { card, cardSha256: hash, registeredAt: new Date().toISOString() });
        return sendJson(res, 201, { agentId: card.agentId, cardSha256: hash });
      }
      if (req.method === "GET" && url.pathname === "/v0/agents") {
        const capability = url.searchParams.get("capability");
        const agents = [...entries.values()]
          .filter((e) => capability === null || e.card.capabilities.includes(capability))
          .map((e) => ({ card: e.card, cardSha256: e.cardSha256, registeredAt: e.registeredAt }));
        return sendJson(res, 200, {
          protocol: LIVE_PROTOCOL,
          registry: "raven-demo-registry/0",
          note: "Cards are self-asserted claims. Listing is not trust.",
          query: { capability },
          agents,
        });
      }
      return sendJson(res, 404, { error: "not_found" });
    } catch {
      return sendJson(res, 400, { error: "bad_request" });
    }
  });
  return { ...handle, entries };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runAsChildProcess("registry", async () => {
    const reg = await startRegistry();
    return { url: reg.url, agentId: "registry", close: reg.close };
  });
}
