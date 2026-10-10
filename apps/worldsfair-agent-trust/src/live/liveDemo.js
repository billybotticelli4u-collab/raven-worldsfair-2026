/**
 * `npm run demo:live-local` — Features 1 + 2, fully local, no network beyond
 * 127.0.0.1, no credentials. Evidence is the retained signed fixture.
 */
import { createFleet, pidAlive } from "./orchestrator.js";
import { loopbackJson } from "./http.js";

const POPULATION = ["honest", "tamperer", "wrong-capability", "bad-pin", "replayer", "stale"];
const WATCHDOG_MS = 60_000;

export async function runLiveDemo({ json = false, out = console.log } = {}) {
  const fleet = createFleet();
  const watchdog = setTimeout(async () => {
    await fleet.stopAll();
    process.stderr.write("demo:live-local watchdog expired; all processes stopped\n");
    process.exit(1);
  }, WATCHDOG_MS);
  watchdog.unref();
  let transcript;
  let ok = false;
  try {
    const registry = await fleet.start("registry");
    const bs = {};
    for (const variant of POPULATION) {
      bs[variant] = await fleet.start("agent-b", { config: { variant, registryUrl: registry.url } });
    }
    bs.impostor = await fleet.start("agent-b", {
      config: { variant: "impostor", registryUrl: registry.url, claimEndpoint: bs.honest.url },
    });
    const a = await fleet.start("agent-a", { config: { registryUrl: registry.url, evidencePolicy: "fixture" } });

    const selection = (await loopbackJson(`${a.url}/v0/run`, { method: "POST", body: {}, timeoutMs: 20_000 })).json;
    const replay = (await loopbackJson(`${a.url}/v0/run`, { method: "POST", body: { targetAgentId: "agent-b-replayer" } })).json;
    const unknown = (await loopbackJson(`${a.url}/v0/run`, { method: "POST", body: { targetAgentId: "agent-b-ghost" } })).json;
    transcript = { selection, replay, unknown };
    ok = selection?.outcome === "PROCEED" && selection.selectedAgentId === "agent-b-honest" &&
      replay?.attempts?.[0]?.reason === "nonce_replayed" &&
      unknown?.attempts?.[0]?.reason === "unknown_agent";
  } finally {
    const stopped = await fleet.stopAll();
    clearTimeout(watchdog);
    const strays = stopped.filter((p) => pidAlive(p.pid));
    transcript = { ...(transcript ?? {}), processes: stopped, strays: strays.map((p) => p.pid) };
    if (strays.length) ok = false;
  }
  if (json) {
    out(JSON.stringify({ ok, ...transcript }, null, 2));
    return ok;
  }
  out(formatLiveDemo(transcript, ok));
  return ok;
}

export function formatLiveDemo(t, ok) {
  const lines = [];
  lines.push("Raven Agent Trust - live local exchange (separate processes, 127.0.0.1 only)");
  const d = t.selection?.discovery ?? [];
  lines.push(`Registry: ${d.length} self-asserted agent cards (listing is not trust)`);
  lines.push("Discovery by Agent A (capability evidence.request:raven.receipt-v1, verifier pin 1b04356a):");
  for (const c of d) {
    lines.push(`  ${c.agentId.padEnd(26)} ${c.eligible ? "eligible" : `skipped: ${c.reasons.join(", ")}`}`);
  }
  lines.push("Live proof requests (fresh nonce each, 30 s response window, real clock):");
  for (const at of t.selection?.attempts ?? []) {
    if (at.stage === "discovery") continue;
    lines.push(`  ${String(at.agentId).padEnd(26)} ${at.outcome.padEnd(8)} ${at.reason}`);
  }
  lines.push(`Selected provider: ${t.selection?.selectedAgentId ?? "none"} -> ${t.selection?.outcome ?? "REFUSE"}`);
  const r = t.replay?.attempts?.[0];
  lines.push(`Replay check: agent-b-replayer re-sends its first (already used) answer -> ${r?.outcome ?? "?"} ${r?.reason ?? ""}`);
  const u = t.unknown?.attempts?.[0];
  lines.push(`Unknown agent: agent-b-ghost -> ${u?.outcome ?? "?"} ${u?.reason ?? ""}`);
  lines.push("Evidence: retained signed BONK receipt fixture (liveAcquisition:false), checked by the pinned verifier at the disclosed fixture time. Not live chain data; not permission to transact.");
  const n = t.processes?.length ?? 0;
  lines.push(`Shutdown: ${n - (t.strays?.length ?? 0)}/${n} processes exited${t.strays?.length ? ` (STRAYS: ${t.strays.join(",")})` : ""}`);
  lines.push(ok ? "Result: live discovery and proof-request demo completed" : "Result: DEMO DID NOT COMPLETE AS EXPECTED");
  return lines.join("\n");
}
