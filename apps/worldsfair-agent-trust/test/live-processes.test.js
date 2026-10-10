import assert from "node:assert/strict";
import test from "node:test";
import net from "node:net";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { pidAlive } from "../src/live/orchestrator.js";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const FLAGS = ["--experimental-strip-types", "--disable-warning=ExperimentalWarning"];

const portClosed = (url) => new Promise((resolve) => {
  const { port } = new URL(url);
  const s = net.connect({ host: "127.0.0.1", port: Number(port) });
  s.once("connect", () => { s.destroy(); resolve(false); });
  s.once("error", () => resolve(true));
});

async function waitDead(pids, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (pids.every((p) => !pidAlive(p))) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return pids.every((p) => !pidAlive(p));
}

test("demo:live-local runs registry + 7 Agent B + Agent A as separate processes and leaves zero strays", async () => {
  const r = spawnSync(process.execPath, [...FLAGS, path.join(ROOT, "scripts/agent-trust-live-demo.mjs"), "--json"], {
    cwd: ROOT, encoding: "utf8", timeout: 90_000, env: { PATH: process.env.PATH },
  });
  assert.ifError(r.error);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.processes.length, 9);
  const pids = out.processes.map((p) => p.pid);
  assert.equal(new Set(pids).size, 9, "each role is its own OS process");
  assert.ok(!pids.includes(process.pid));
  for (const p of out.processes) assert.match(p.url, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.deepEqual(out.strays, []);
  assert.equal(await waitDead(pids), true);
  for (const p of out.processes) assert.equal(await portClosed(p.url), true, `${p.role} port still open`);
  assert.equal(out.selection.outcome, "PROCEED");
  assert.equal(out.replay.attempts[0].reason, "nonce_replayed");
});

test("demo:live-local human output is stable and honest", () => {
  const r = spawnSync(process.execPath, [...FLAGS, path.join(ROOT, "scripts/agent-trust-live-demo.mjs")], {
    cwd: ROOT, encoding: "utf8", timeout: 90_000, env: { PATH: process.env.PATH },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /agent-b-bad-pin\s+skipped: verifier_pin_mismatch/);
  assert.match(r.stdout, /agent-b-wrong-capability\s+skipped: capability_missing/);
  assert.match(r.stdout, /agent-b-tamperer\s+REFUSE\s+integrity_or_malformed/);
  assert.match(r.stdout, /agent-b-stale\s+REFUSE\s+stale_response/);
  assert.match(r.stdout, /agent-b-impostor\s+REFUSE\s+endpoint_card_mismatch/);
  assert.match(r.stdout, /Selected provider: agent-b-honest -> PROCEED/);
  assert.match(r.stdout, /agent-b-ghost -> REFUSE unknown_agent/);
  assert.match(r.stdout, /liveAcquisition:false/);
  assert.match(r.stdout, /Shutdown: 9\/9 processes exited/);
  assert.doesNotMatch(r.stdout, /on-chain agent action/i);
});

test("children exit when their parent is killed abruptly (no strays)", async () => {
  const probe = spawn(process.execPath, [...FLAGS, fileURLToPath(new URL("./helpers/fleetCrashProbe.mjs", import.meta.url))], {
    stdio: ["ignore", "pipe", "pipe"], env: { PATH: process.env.PATH },
  });
  const line = await new Promise((resolve, reject) => {
    let buf = "";
    const t = setTimeout(() => reject(new Error("probe timeout")), 20_000);
    probe.stdout.on("data", (d) => {
      buf += d;
      if (buf.includes("\n")) { clearTimeout(t); resolve(buf.slice(0, buf.indexOf("\n"))); }
    });
  });
  const { pids, urls } = JSON.parse(line);
  assert.ok(pids.every(pidAlive));
  probe.kill("SIGKILL");
  assert.equal(await waitDead(pids), true, "children must exit after parent death");
  for (const u of urls) assert.equal(await portClosed(u), true);
});
