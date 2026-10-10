// Integration of the LIVE-SOLANA module with Billy 2's live-local exchange
// (INTERFACE.md): createLiveEvidenceProvider -> startAgentB, liveVerifyEvidence
// -> createAgentA. Loopback stub only; dummy test key only.
import assert from "node:assert/strict";
import test from "node:test";

import { startRegistry } from "../../src/live/registryServer.js";
import { startAgentB } from "../../src/live/agentBServer.js";
import { createAgentA } from "../../src/live/agentACore.js";
import { createLiveEvidenceProvider, liveVerifyEvidence } from "../agentHooks.js";
import { createCallBudget } from "../liveSolana.js";
import { startStub } from "./stubServer.js";
import { makeTestOnlySignedReceipt } from "./testOnlySigner.js";
import { FIXTURE, FIXTURE_BYTES, TAMPERED_BYTES, TEST_API_KEY, at, replay } from "./helpers.js";

/** Agent A's transport clock stays real; only receipt evaluation time is pinned. */
const verifyAt = (clock) => (args) => liveVerifyEvidence({ ...args, now: clock() });

async function world(t, respond, { verifyEvidence = verifyAt(at(5)), budget } = {}) {
  const stub = await startStub(t, respond);
  const reg = await startRegistry();
  t.after(() => reg.close());
  const evidenceProvider = createLiveEvidenceProvider({ apiKey: TEST_API_KEY, apiBase: stub.base, budget });
  const b = await startAgentB({ variant: "honest", registryUrl: reg.url }, { evidenceProvider });
  t.after(() => b.close());
  const a = createAgentA({ registryUrl: reg.url, verifyEvidence });
  return { stub, a, evidenceProvider, b };
}

test("provider refuses to construct without a key (before any call)", () => {
  assert.throws(() => createLiveEvidenceProvider({}), { code: "api_key_missing" });
  assert.throws(() => createLiveEvidenceProvider({ apiKey: TEST_API_KEY, apiBase: "http://example.com" }),
    { code: "api_base_insecure" });
});

test("Agent B with the live provider + Agent A live verifier -> PROCEED over the live-local exchange", async (t) => {
  const { stub, a } = await world(t, replay(FIXTURE_BYTES));
  const r = await a.run({ targetAgentId: "agent-b-honest" });
  assert.equal(r.outcome, "PROCEED", JSON.stringify(r.attempts[0]?.reason));
  const [, request, response, verification] = r.attempts[0].exchange;
  assert.equal(response.source.mode, "live_hosted_api");
  assert.equal(response.source.loopbackStub, true);
  assert.equal(response.source.liveAcquisition, false, "a stub is never labeled live");
  assert.equal(verification.result.disclosure.evaluationTimeKind, "wall_clock");
  assert.equal(verification.result.disclosure.liveGates.ok, true);
  assert.equal(stub.requests.length, 1);
  assert.deepEqual(JSON.parse(stub.requests[0].body), {
    mintAddress: request.requirements.subject.mintAddress,
    tokenProgramAddress: request.requirements.subject.tokenProgramAddress,
  });
  assert.equal(stub.requests[0].apiKeyHeader, TEST_API_KEY);
  assert.ok(!JSON.stringify(r).includes(TEST_API_KEY), "key never enters the transcript");
});

test("tampered live receipt -> REFUSE integrity_or_malformed", async (t) => {
  const { a } = await world(t, replay(TAMPERED_BYTES));
  const r = await a.run({ targetAgentId: "agent-b-honest" });
  assert.equal(r.outcome, "REFUSE");
  assert.equal(r.attempts[0].reason, "integrity_or_malformed");
});

test("test-only signer -> REFUSE untrusted_key at the real clock", async (t) => {
  const { receipt } = makeTestOnlySignedReceipt(FIXTURE, { timestamp: new Date().toISOString() });
  const { a } = await world(t, replay(JSON.stringify(receipt)), { verifyEvidence: liveVerifyEvidence });
  const r = await a.run({ targetAgentId: "agent-b-honest" });
  assert.equal(r.attempts[0].reason, "untrusted_key");
});

test("genuine but old receipt at the real clock -> REFUSE stale", async (t) => {
  const { a } = await world(t, replay(FIXTURE_BYTES), { verifyEvidence: liveVerifyEvidence });
  const r = await a.run({ targetAgentId: "agent-b-honest" });
  assert.equal(r.attempts[0].reason, "stale");
});

test("future-dated receipt -> REFUSE via live gate even though the Day-2 verifier would pass", async (t) => {
  const { a } = await world(t, replay(FIXTURE_BYTES), { verifyEvidence: verifyAt(at(-120)) });
  const r = await a.run({ targetAgentId: "agent-b-honest" });
  assert.equal(r.outcome, "REFUSE");
  assert.equal(r.attempts[0].reason, "live_timestamp_in_future");
});

test("hosted API 401 -> evidence unavailable -> REFUSE missing_evidence", async (t) => {
  const { a } = await world(t, () => ({ status: 401, body: "{}" }));
  const r = await a.run({ targetAgentId: "agent-b-honest" });
  assert.equal(r.outcome, "REFUSE");
  assert.equal(r.attempts[0].reason, "missing_evidence");
  assert.equal(r.attempts[0].exchange[2].unavailableReason, "http_401");
});

test("provider shares one call budget: hard cap 20 across requests", async (t) => {
  const stub = await startStub(t, replay(FIXTURE_BYTES));
  const budget = createCallBudget();
  const provider = createLiveEvidenceProvider({ apiKey: TEST_API_KEY, apiBase: stub.base, budget });
  const request = {
    protocolVersion: "raven-agent-trust/1", type: "evidence.request", messageId: "m", claimId: "c",
    requirements: { subject: { chain: "solana-mainnet", mintAddress: FIXTURE.mintAddress, tokenProgramAddress: FIXTURE.tokenProgramAddress } },
  };
  const results = [];
  for (let i = 0; i < 21; i += 1) results.push(await provider(request));
  assert.equal(stub.requests.length, 20);
  assert.equal(results.filter((x) => x.status === "supplied").length, 20);
  assert.equal(results[20].status, "unavailable");
  assert.equal(results[20].unavailableReason, "call_cap_exceeded");
  assert.equal(provider.budget.used, 20);
});

test("provider never defaults the subject: invalid requested subject -> unavailable, no call", async (t) => {
  const stub = await startStub(t, replay(FIXTURE_BYTES));
  const provider = createLiveEvidenceProvider({ apiKey: TEST_API_KEY, apiBase: stub.base });
  const res = await provider({
    protocolVersion: "raven-agent-trust/1", type: "evidence.request", messageId: "m", claimId: "c",
    requirements: {},
  });
  assert.equal(res.status, "unavailable");
  assert.equal(stub.requests.length, 0);
  const wsol = await provider({
    protocolVersion: "raven-agent-trust/1", type: "evidence.request", messageId: "m", claimId: "c",
    requirements: { subject: { chain: "solana-mainnet", mintAddress: "So11111111111111111111111111111111111111112", tokenProgramAddress: FIXTURE.tokenProgramAddress } },
  });
  assert.equal(wsol.status, "supplied");
  assert.equal(JSON.parse(stub.requests[0].body).mintAddress, "So11111111111111111111111111111111111111112");
});

test("integration (Billy 2): card advertises the live source, never retained_fixture", async (t) => {
  const { a, b } = await world(t, replay(FIXTURE_BYTES));
  assert.equal(b.card.evidenceSource, "hosted_receipt_api_loopback_stub");
  const r = await a.run({ targetAgentId: "agent-b-honest" });
  assert.equal(r.discovery[0].advertisedEvidenceSource, "hosted_receipt_api_loopback_stub");
  assert.equal(r.attempts[0].advertisedEvidenceSource, "hosted_receipt_api_loopback_stub");
});
