import assert from "node:assert/strict";
import test from "node:test";
import { startRegistry } from "../src/live/registryServer.js";
import { startAgentB } from "../src/live/agentBServer.js";
import { createAgentA } from "../src/live/agentACore.js";
import { loopbackJson } from "../src/live/http.js";

async function world(t, variants, aOpts = {}) {
  const reg = await startRegistry();
  t.after(() => reg.close());
  const bs = {};
  for (const v of variants) {
    const cfg = { variant: v, registryUrl: reg.url };
    if (v === "impostor") cfg.claimEndpoint = bs.honest.url;
    bs[v] = await startAgentB(cfg);
    t.after(() => bs[v].close());
  }
  return { reg, bs, a: createAgentA({ registryUrl: reg.url, ...aOpts }) };
}

const one = async (a, id) => (await a.run({ targetAgentId: id })).attempts[0];

test("live exchange: honest provider -> PROCEED over HTTP with a fresh nonce", async (t) => {
  const { a } = await world(t, ["honest"]);
  const r = await a.run();
  assert.equal(r.outcome, "PROCEED");
  assert.equal(r.selectedAgentId, "agent-b-honest");
  const at = r.attempts[0];
  assert.match(at.nonce, /^[0-9a-f]{64}$/);
  assert.equal(at.transport.reason, "accepted");
  const [claim, request, response, verification] = at.exchange;
  assert.deepEqual([claim.type, request.type, response.type, verification.type],
    ["solana.claim", "evidence.request", "evidence.response", "evidence.verification"]);
  assert.equal(response.challengeEcho.nonce, request.challenge.nonce);
  assert.equal(response.source.liveAcquisition, false, "fixture evidence is never labeled live");
  assert.equal(verification.result.disclosure.evaluationTimeKind, "deterministic_fixture_demo_time");
});

test("selection skips refused providers and picks the honest one", async (t) => {
  const { a } = await world(t, ["tamperer", "wrong-capability", "bad-pin", "honest"]);
  const r = await a.run();
  assert.equal(r.selectedAgentId, "agent-b-honest");
  const reasons = Object.fromEntries(r.attempts.map((x) => [x.agentId, x.reason]));
  assert.equal(reasons["agent-b-tamperer"], "integrity_or_malformed");
  assert.equal(reasons["agent-b-wrong-capability"], "capability_missing");
  assert.equal(reasons["agent-b-bad-pin"], "verifier_pin_mismatch");
});

test("refuse: unknown agent", async (t) => {
  const { a } = await world(t, ["honest"]);
  const at = await one(a, "agent-b-ghost");
  assert.equal(at.outcome, "REFUSE");
  assert.equal(at.reason, "unknown_agent");
});

test("refuse: bad verifier pin even when targeted directly (never contacted)", async (t) => {
  const { a } = await world(t, ["bad-pin"]);
  const at = await one(a, "agent-b-bad-pin");
  assert.equal(at.reason, "verifier_pin_mismatch");
  assert.equal(at.stage, "discovery");
});

test("refuse: tampered receipt", async (t) => {
  const { a } = await world(t, ["tamperer"]);
  const at = await one(a, "agent-b-tamperer");
  assert.equal(at.outcome, "REFUSE");
  assert.equal(at.reason, "integrity_or_malformed");
});

test("refuse: stale response outside the freshness window", async (t) => {
  const { a } = await world(t, ["stale"]);
  const at = await one(a, "agent-b-stale");
  assert.equal(at.reason, "stale_response");
  assert.equal(at.stage, "transport");
});

test("refuse: replayed answer (old nonce) from a replaying provider", async (t) => {
  const { a } = await world(t, ["replayer"]);
  assert.equal((await one(a, "agent-b-replayer")).outcome, "PROCEED");
  const second = await one(a, "agent-b-replayer");
  assert.equal(second.outcome, "REFUSE");
  assert.equal(second.reason, "nonce_replayed");
});

test("refuse: replayed old-nonce answer to a fresh Agent A (never seen nonce)", async (t) => {
  const { a, reg } = await world(t, ["replayer"]);
  assert.equal((await one(a, "agent-b-replayer")).outcome, "PROCEED");
  const fresh = createAgentA({ registryUrl: reg.url });
  const at = await one(fresh, "agent-b-replayer");
  assert.equal(at.reason, "nonce_mismatch_replay");
});

test("refuse: the same accepted response presented twice (single-use nonce)", async (t) => {
  const { a } = await world(t, ["honest"]);
  const at = await one(a, "agent-b-honest");
  const [, request, response] = at.exchange;
  assert.equal(a.acceptResponse(request, response).reason, "nonce_replayed");
});

test("refuse: wrong endpoint (impostor card points at another agent)", async (t) => {
  const { a } = await world(t, ["honest", "impostor"]);
  const at = await one(a, "agent-b-impostor");
  assert.equal(at.reason, "endpoint_card_mismatch");
  assert.equal(at.servedAgentId, "agent-b-honest");
});

test("refuse: endpoint unreachable after the provider stops", async (t) => {
  const { a, bs } = await world(t, ["honest"]);
  const d = await a.discover();
  await bs.honest.close();
  const at = await a.exchange(d.candidates[0]);
  assert.equal(at.reason, "endpoint_unreachable");
});

test("refuse: response missing its challenge echo", async (t) => {
  const { a } = await world(t, ["honest"]);
  const at = await one(a, "agent-b-honest");
  const [, request, response] = at.exchange;
  const { challengeEcho: _e, ...noEcho } = response;
  assert.equal(a.acceptResponse(request, noEcho).reason, "challenge_echo_missing");
});

test("refuse: response timestamped in Agent A's future (clock skew > 30 s)", async (t) => {
  const { a } = await world(t, ["honest"], { clock: () => new Date(Date.now() - 120_000) });
  const at = await one(a, "agent-b-honest");
  assert.equal(at.reason, "response_from_future");
});

test("Agent B refuses a request addressed to a different agent", async (t) => {
  const { bs } = await world(t, ["honest"]);
  const r = await loopbackJson(`${bs.honest.url}/v0/evidence-request`, {
    method: "POST",
    body: { request: { protocolVersion: "raven-agent-trust/1", type: "evidence.request", messageId: "m", from: "agent-a", to: "agent-b", claimId: "c", challenge: { nonce: "a".repeat(64), providerAgentId: "agent-b-other" } } },
  });
  assert.equal(r.status, 409);
});

test("non-loopback peers are refused by the client", async () => {
  await assert.rejects(loopbackJson("http://example.com/x"), /non_loopback_target_refused/);
  await assert.rejects(loopbackJson("http://localhost:1/x"), /non_loopback_target_refused/);
});

test("extension points: injected evidenceProvider and verifyEvidence are used; transport checks still apply", async (t) => {
  const { agentBHandleEvidenceRequest } = await import("../src/lib/agentB.js");
  const reg = await startRegistry();
  t.after(() => reg.close());
  let provided = 0;
  const b = await startAgentB({ variant: "honest", agentId: "agent-b-custom", registryUrl: reg.url, evidenceSourceLabel: "custom_source" }, {
    evidenceProvider: async (request) => { provided++; return agentBHandleEvidenceRequest(request, "tampered").evidenceResponse; },
  });
  t.after(() => b.close());
  assert.equal(b.card.evidenceSource, "custom_source");
  const b2 = await startAgentB({ variant: "honest", agentId: "agent-b-unlabeled", registryUrl: reg.url }, { evidenceProvider: async () => null });
  t.after(() => b2.close());
  assert.equal(b2.card.evidenceSource, "custom_evidence_provider", "a plugged-in provider never advertises retained_fixture");
  const a = createAgentA({ registryUrl: reg.url });
  assert.equal((await one(a, "agent-b-custom")).reason, "integrity_or_malformed");
  let verified = 0;
  const a2 = createAgentA({ registryUrl: reg.url, verifyEvidence: async (args) => {
    verified++;
    assert.ok(args.now instanceof Date);
    const { ravenVerifyEvidenceResponse, BONK_FIXTURE_NOW } = await import("../src/lib/ravenVerify.js");
    return ravenVerifyEvidenceResponse({ ...args, now: BONK_FIXTURE_NOW });
  } });
  assert.equal((await one(a2, "agent-b-custom")).outcome, "REFUSE");
  assert.equal((await one(a, "agent-b-custom")).advertisedEvidenceSource, "custom_source");
  assert.equal(provided, 3);
  assert.equal(verified, 1);
});

test("port is configurable (explicit or RAVEN_LIVE_PORT); host is always 127.0.0.1", async (t) => {
  const probe = await startRegistry();
  const port = probe.port;
  await probe.close();
  const reg = await startRegistry({ port });
  t.after(() => reg.close());
  assert.equal(reg.port, port);
  assert.equal(reg.server.address().address, "127.0.0.1");
  const { resolvePort } = await import("../src/live/http.js");
  assert.throws(() => resolvePort("abc"), /port_invalid/);
  assert.throws(() => resolvePort(70000), /port_invalid/);
  process.env.RAVEN_LIVE_PORT = "0";
  t.after(() => { delete process.env.RAVEN_LIVE_PORT; });
  assert.equal(resolvePort(undefined), 0);
});
