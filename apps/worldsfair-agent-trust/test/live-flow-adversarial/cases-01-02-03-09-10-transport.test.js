/**
 * Adversarial live-flow cases 1, 2, 3, 9, 10 — transport layer.
 * Every case must end in REFUSE with the named code; the matching red
 * controls live in red-controls.mjs (one throwaway mutation per case).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { startRegistry } from "../../src/live/registryServer.js";
import { startAgentB } from "../../src/live/agentBServer.js";
import { createAgentA } from "../../src/live/agentACore.js";
import { loopbackJson } from "../../src/live/http.js";
import { pidAlive } from "../../src/live/orchestrator.js";
import { deadPort, registerCard, spawnHungAgent, startRogueB } from "./helpers.mjs";

async function world(t) {
  const reg = await startRegistry();
  t.after(() => reg.close());
  return { reg, a: (opts = {}) => createAgentA({ registryUrl: reg.url, ...opts }) };
}
const run1 = (a, id) => a.run({ targetAgentId: id }).then((r) => r.attempts[0]);

// ---------------------------------------------------------------- case 1
test("case 1: replayed old response (same challenge reused) -> REFUSE nonce_replayed", async (t) => {
  const { reg, a } = await world(t);
  const rogue = await startRogueB(t, { agentId: "agent-b-replayer-rogue", registryUrl: reg.url, behavior: "replay-same-nonce" });
  const agentA = a();

  const first = await run1(agentA, rogue.agentId);
  assert.equal(first.outcome, "PROCEED", "control: first use of the challenge is accepted");
  const second = await run1(agentA, rogue.agentId);
  assert.equal(second.outcome, "REFUSE", "replayed response must never PROCEED");
  assert.equal(second.stage, "transport");
  assert.equal(second.reason, "nonce_replayed");
});

// ---------------------------------------------------------------- case 2
test("case 2: response to a different challenge -> REFUSE nonce_mismatch_replay", async (t) => {
  const { reg, a } = await world(t);
  const rogue = await startRogueB(t, { agentId: "agent-b-cross-rogue", registryUrl: reg.url, behavior: "echo-old-nonce" });

  // Agent A1 completes an exchange; the rogue captures its nonce.
  const first = await run1(a(), rogue.agentId);
  assert.equal(first.outcome, "PROCEED", "control: first exchange completes");
  // A fresh Agent A2 issues a NEW challenge; the rogue answers with A1's old
  // nonce — a response to a different challenge, never seen by A2.
  const second = await run1(a(), rogue.agentId);
  assert.equal(second.outcome, "REFUSE");
  assert.equal(second.stage, "transport");
  assert.equal(second.reason, "nonce_mismatch_replay");
  assert.notEqual(second.nonce, first.nonce);
});

// ---------------------------------------------------------------- case 3
test("case 3a: missing respondedAt -> REFUSE responded_at_invalid", async (t) => {
  const { reg, a } = await world(t);
  const rogue = await startRogueB(t, { agentId: "agent-b-notime-rogue", registryUrl: reg.url, behavior: "echo-missing-time" });
  const at = await run1(a(), rogue.agentId);
  assert.equal(at.outcome, "REFUSE");
  assert.equal(at.stage, "transport");
  assert.equal(at.reason, "responded_at_invalid");
});

test("case 3b: expired timestamp (respondedAt 60 s old, beyond the 30 s window) -> REFUSE stale_response", async (t) => {
  const { reg, a } = await world(t);
  const rogue = await startRogueB(t, { agentId: "agent-b-stale-rogue", registryUrl: reg.url, behavior: "echo-stale" });
  const at = await run1(a(), rogue.agentId);
  assert.equal(at.outcome, "REFUSE");
  assert.equal(at.stage, "transport");
  assert.equal(at.reason, "stale_response");
});

test("case 3c: timestamp 60 s in the future -> REFUSE response_from_future", async (t) => {
  const { reg, a } = await world(t);
  const rogue = await startRogueB(t, { agentId: "agent-b-future-rogue", registryUrl: reg.url, behavior: "echo-future" });
  const at = await run1(a(), rogue.agentId);
  assert.equal(at.outcome, "REFUSE");
  assert.equal(at.stage, "transport");
  assert.equal(at.reason, "response_from_future");
});

// ---------------------------------------------------------------- case 9
test("case 9a: valid-JSON HTTP 500 error body (no response object) -> REFUSE invalid_evidence_response", async (t) => {
  const { reg, a } = await world(t);
  // control: an honest Agent B really does fail closed on malformed JSON input
  const honest = await startAgentB({ variant: "honest", registryUrl: reg.url });
  t.after(() => honest.close());
  const raw = await fetch(`${honest.url}/v0/evidence-request`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{not json",
  });
  assert.equal(raw.status, 500, "malformed JSON must not be accepted by Agent B");

  const rogue = await startRogueB(t, { agentId: "agent-b-http500-rogue", registryUrl: reg.url, behavior: "http-500" });
  const at = await run1(a(), rogue.agentId);
  assert.equal(at.outcome, "REFUSE");
  assert.equal(at.stage, "transport");
  assert.equal(at.reason, "invalid_evidence_response");
});

test("case 9d: malformed-JSON body served to Agent A (200, unparseable bytes) -> REFUSE invalid_evidence_response", async (t) => {
  const { reg, a } = await world(t);
  // The rogue returns a GENUINELY malformed JSON body (truncated bytes), not a
  // valid-JSON error envelope: Agent A's parser must fail closed and the shape
  // check must refuse with the structured reason.
  const rogue = await startRogueB(t, { agentId: "agent-b-badjson-rogue", registryUrl: reg.url, behavior: "malformed-json-body" });
  const at = await run1(a(), rogue.agentId);
  assert.equal(at.outcome, "REFUSE");
  assert.equal(at.stage, "transport");
  assert.equal(at.reason, "invalid_evidence_response");
});

test("case 9b: oversized response (>64 KiB) -> REFUSE provider_unreachable", async (t) => {
  const { reg, a } = await world(t);
  const rogue = await startRogueB(t, { agentId: "agent-b-huge-rogue", registryUrl: reg.url, behavior: "oversized-response" });
  const at = await run1(a({ requestTimeoutMs: 5_000 }), rogue.agentId);
  assert.equal(at.outcome, "REFUSE");
  assert.equal(at.stage, "request");
  assert.equal(at.reason, "provider_unreachable");
});

test("case 9c: hung agent -> REFUSE provider_unreachable via timeout, then zero stray processes", async (t) => {
  const { reg, a } = await world(t);
  const hung = await spawnHungAgent(t, { agentId: "agent-b-hung" });
  const regRes = await registerCard(reg.url, {
    cardVersion: "raven-agent-card/0",
    agentId: "agent-b-hung",
    role: "evidence-provider",
    endpoint: hung.url,
    capabilities: ["evidence.request:raven.receipt-v1"],
    verifierPin: "raven-receipt-verifier@1b04356a275742752fb7afd8dfcc4269d462a778",
    subjects: [{
      chain: "solana-mainnet",
      mintAddress: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
      tokenProgramAddress: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    }],
    evidenceSource: "retained_fixture",
  });
  assert.equal(regRes.status, 201);

  const started = Date.now();
  const at = await run1(a({ requestTimeoutMs: 500 }), "agent-b-hung");
  const elapsed = Date.now() - started;
  assert.equal(at.outcome, "REFUSE");
  assert.equal(at.stage, "request");
  assert.equal(at.reason, "provider_unreachable");
  assert.ok(elapsed < 5_000, `timeout must fire promptly (took ${elapsed} ms)`);

  // the hung child is killed by the t.after hook; assert zero strays here too
  hung.child.kill("SIGKILL");
  await new Promise((res) => {
    const k = setTimeout(res, 3_000);
    hung.child.once("exit", () => { clearTimeout(k); res(); });
  });
  assert.equal(pidAlive(hung.pid), false, "no stray process left behind");
});

// --------------------------------------------------------------- case 10
test("case 10: Agent B unreachable (registered endpoint closed) -> REFUSE endpoint_unreachable", async (t) => {
  const { reg, a } = await world(t);
  const port = await deadPort();
  const res = await registerCard(reg.url, {
    cardVersion: "raven-agent-card/0",
    agentId: "agent-b-gone",
    role: "evidence-provider",
    endpoint: `http://127.0.0.1:${port}`,
    capabilities: ["evidence.request:raven.receipt-v1"],
    verifierPin: "raven-receipt-verifier@1b04356a275742752fb7afd8dfcc4269d462a778",
    subjects: [{
      chain: "solana-mainnet",
      mintAddress: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
      tokenProgramAddress: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    }],
    evidenceSource: "retained_fixture",
  });
  assert.equal(res.status, 201, "the directory accepts the card; the endpoint is simply dead");
  const at = await run1(a(), "agent-b-gone");
  assert.equal(at.outcome, "REFUSE");
  assert.equal(at.stage, "card_check");
  assert.equal(at.reason, "endpoint_unreachable");
});

// ------------------------------------------- transport hygiene control
test("control: loopback client still refuses non-loopback targets", async () => {
  await assert.rejects(loopbackJson("http://example.com/x"), /non_loopback_target_refused/);
});
