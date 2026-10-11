// Live-path challenge binding (follow-up b): receipt-v1 `timestamp`
// must not precede challenge.issuedAt by more than CHALLENGE_BINDING_SKEW_MS.
import assert from "node:assert/strict";
import test from "node:test";
import { startRegistry } from "../src/live/registryServer.js";
import { startAgentB } from "../src/live/agentBServer.js";
import { createAgentA } from "../src/live/agentACore.js";
import { CHALLENGE_BINDING_SKEW_MS, FIXTURE_SOURCE_LABEL } from "../src/live/constants.js";
import { agentBHandleEvidenceRequest } from "../src/lib/agentB.js";
import { BONK_FIXTURE_NOW, ravenVerifyEvidenceResponse } from "../src/lib/ravenVerify.js";

/**
 * Provider: the genuine fixture response, with the receipt timestamp moved
 * relative to the challenge. Verifier: checks the ORIGINAL genuine receipt,
 * so it always says verified — isolating the binding gate.
 */
async function world(t, { offsetMs, rawTimestamp, liveLabel = false, aOpts = {} }) {
  const reg = await startRegistry();
  t.after(() => reg.close());
  const genuine = new Map();
  const b = await startAgentB({ variant: "honest", agentId: "agent-b-shifted", registryUrl: reg.url }, {
    evidenceProvider: async (request) => {
      const resp = agentBHandleEvidenceRequest(request, "valid").evidenceResponse;
      genuine.set(resp.messageId, structuredClone(resp.evidence));
      resp.source = { ...resp.source, liveAcquisition: liveLabel };
      resp.evidence.timestamp = rawTimestamp ?? new Date(Date.now() + offsetMs).toISOString();
      return resp;
    },
  });
  t.after(() => b.close());
  const verifyEvidence = async ({ evidenceRequest, evidenceResponse }) => ravenVerifyEvidenceResponse({
    evidenceRequest,
    evidenceResponse: { ...evidenceResponse, evidence: genuine.get(evidenceResponse.messageId) },
    now: BONK_FIXTURE_NOW,
  });
  const a = createAgentA({ registryUrl: reg.url, verifyEvidence, ...aOpts });
  return (await a.run({ targetAgentId: "agent-b-shifted" })).attempts[0];
}

test("tolerance is 5 s", () => assert.equal(CHALLENGE_BINDING_SKEW_MS, 5_000));

test("receipt issued after the challenge -> PROCEED", async (t) => {
  const at = await world(t, { offsetMs: 0 });
  assert.equal(at.outcome, "PROCEED", at.reason);
});

test("receipt 3 s before the challenge (inside tolerance) -> PROCEED", async (t) => {
  assert.equal((await world(t, { offsetMs: -3_000 })).outcome, "PROCEED");
});

test("receipt 8 s before the challenge -> REFUSE receipt_predates_challenge", async (t) => {
  const at = await world(t, { offsetMs: -8_000 });
  assert.equal(at.outcome, "REFUSE");
  assert.equal(at.stage, "challenge_binding");
  assert.equal(at.reason, "receipt_predates_challenge");
  assert.equal(at.binding.skewMs, 5_000);
});

test("receipt 10 min old -> REFUSE receipt_predates_challenge", async (t) => {
  assert.equal((await world(t, { offsetMs: -600_000 })).reason, "receipt_predates_challenge");
});

test("unparseable receipt timestamp -> REFUSE receipt_timestamp_invalid", async (t) => {
  assert.equal((await world(t, { rawTimestamp: "not-a-time" })).reason, "receipt_timestamp_invalid");
});

test("RED CONTROL: same 10-min-old receipt with the binding relaxed -> PROCEED (the gate is what refuses)", async (t) => {
  const at = await world(t, { offsetMs: -600_000, aOpts: { challengeBindingSkewMs: 3_600_000 } });
  assert.equal(at.outcome, "PROCEED");
});

test("binding also applies to a liveAcquisition:true response under the default verifier", async (t) => {
  const reg = await startRegistry();
  t.after(() => reg.close());
  const b = await startAgentB({ variant: "honest", agentId: "agent-b-claims-live", registryUrl: reg.url }, {
    evidenceProvider: async (request) => {
      const resp = agentBHandleEvidenceRequest(request, "valid").evidenceResponse;
      resp.source = { ...resp.source, liveAcquisition: true };
      return resp;
    },
  });
  t.after(() => b.close());
  const at = (await createAgentA({ registryUrl: reg.url }).run({ targetAgentId: "agent-b-claims-live" })).attempts[0];
  assert.equal(at.reason, "receipt_predates_challenge");
});

test("offline fixture path is untouched: default Agent A + fixture provider -> PROCEED, card says retained_fixture", async (t) => {
  const reg = await startRegistry();
  t.after(() => reg.close());
  const b = await startAgentB({ variant: "honest", registryUrl: reg.url });
  t.after(() => b.close());
  assert.equal(b.card.evidenceSource, FIXTURE_SOURCE_LABEL);
  const r = await createAgentA({ registryUrl: reg.url }).run({ targetAgentId: "agent-b-honest" });
  assert.equal(r.outcome, "PROCEED");
  assert.equal(r.attempts[0].advertisedEvidenceSource, "retained_fixture");
});

test("invalid binding tolerance is refused at construction", () => {
  for (const v of [-1, Number.NaN, "5000", null]) {
    assert.throws(() => createAgentA({ registryUrl: "http://127.0.0.1:1", challengeBindingSkewMs: v }), /challenge_binding_skew_invalid/);
  }
});
