// Regression for CODEX review a8361b0b (751f604b): a startAgentB that fails
// after it has started listening (duplicate id 409, registry full 429,
// registry transport error, non-loopback registry) must close its listener.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { startAgentB } from "../src/live/agentBServer.js";
import { startRegistry } from "../src/live/registryServer.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROBE = path.join(HERE, "helpers", "duplicateRegistrationProbe.mjs");

function listeningServerSet() {
  return new Set(process._getActiveHandles().filter((h) => h instanceof net.Server && h.listening));
}
function listeningServers() {
  return listeningServerSet().size;
}

async function freePort() {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}

function connectRefused(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: "127.0.0.1", port });
    sock.once("connect", () => { sock.destroy(); resolve(false); });
    sock.once("error", (e) => resolve(e.code === "ECONNREFUSED"));
  });
}

async function expectCleanRejection(t, config, messagePattern) {
  const beforeSet = listeningServerSet();
  const before = beforeSet.size;
  // If the check under test regresses, close the leaked server afterwards so the
  // test fails fast instead of keeping this test process alive.
  t.after(async () => {
    for (const s of listeningServerSet()) if (!beforeSet.has(s)) await new Promise((r) => { s.closeAllConnections?.(); s.close(() => r()); });
  });
  const port = await freePort();
  await assert.rejects(startAgentB({ variant: "honest", ...config, port }), messagePattern);
  assert.equal(listeningServers(), before, "a rejected startAgentB must not leave a listening server");
  assert.equal(await connectRefused(port), true, `rejected Agent B port ${port} must be closed`);
}

test("duplicate agent id (409) closes the rejected Agent B listener", async (t) => {
  const reg = await startRegistry();
  t.after(() => reg.close());
  const first = await startAgentB({ variant: "honest", agentId: "agent-b-dup", registryUrl: reg.url });
  t.after(() => first.close());
  await expectCleanRejection(t, { agentId: "agent-b-dup", registryUrl: reg.url }, /registration_failed_409/);
});

test("registry full (429) closes the rejected Agent B listener", async (t) => {
  const reg = await startRegistry();
  t.after(() => reg.close());
  const started = [];
  t.after(async () => { for (const b of started) await b.close(); });
  for (let i = 0; i < 32; i++) {
    started.push(await startAgentB({ variant: "honest", agentId: `agent-b-fill-${i}`, registryUrl: reg.url }));
  }
  await expectCleanRejection(t, { agentId: "agent-b-overflow", registryUrl: reg.url }, /registration_failed_429/);
});

test("registry transport error closes the rejected Agent B listener", async (t) => {
  const dead = await freePort(); // nothing listens here
  await expectCleanRejection(t, { agentId: "agent-b-orphan", registryUrl: `http://127.0.0.1:${dead}` }, /fetch failed|ECONNREFUSED/);
});

test("non-loopback registry URL closes the rejected Agent B listener", async (t) => {
  await expectCleanRejection(t, { agentId: "agent-b-far", registryUrl: "http://192.0.2.1:9" }, /non_loopback_target_refused/);
});

test("a child that only makes a rejected duplicate registration exits naturally", async (t) => {
  const reg = await startRegistry();
  t.after(() => reg.close());
  const first = await startAgentB({ variant: "honest", agentId: "agent-b-dup-child", registryUrl: reg.url });
  t.after(() => first.close());
  const child = spawn(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", PROBE, reg.url, "agent-b-dup-child"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { PATH: process.env.PATH ?? "" },
  });
  let out = "";
  child.stdout.on("data", (d) => { out += d; });
  const result = await new Promise((resolve) => {
    const timer = setTimeout(() => { child.kill("SIGKILL"); resolve({ timedOut: true }); }, 10_000);
    child.once("exit", (code, signal) => { clearTimeout(timer); resolve({ timedOut: false, code, signal }); });
  });
  assert.equal(result.timedOut, false, `child must exit on its own within 10 s (stdout: ${out.trim()})`);
  assert.equal(result.code, 0);
  assert.match(out, /REJECTED registration_failed_409/);
});
