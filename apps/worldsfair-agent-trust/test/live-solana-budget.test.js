// Regression for CODEX review 755269e4 (d223799f) F-2: a caller-forged call
// budget must not bypass the hard cap of 20 (written by Billy 2 against
// Billy 1's live-Solana module; loopback stub only, dummy key, no hosted call).
import assert from "node:assert/strict";
import test from "node:test";

import { createLiveEvidenceProvider } from "../live/agentHooks.js";
import { MAX_HTTP_CALLS_PER_RUN, createCallBudget, fetchAndVerifyLiveReceipt, isAuthenticCallBudget, requestReceipt } from "../live/liveSolana.js";
import { FIXTURE, FIXTURE_BYTES, TEST_API_KEY, replay } from "../live/test/helpers.js";
import { startStub } from "../live/test/stubServer.js";

const subjectRequest = {
  protocolVersion: "raven-agent-trust/1", type: "evidence.request", messageId: "m", claimId: "c",
  requirements: { subject: { chain: "solana-mainnet", mintAddress: FIXTURE.mintAddress, tokenProgramAddress: FIXTURE.tokenProgramAddress } },
};

function forgedBudget() {
  let used = 0;
  return { max: 999, get used() { return used; }, take() { used += 1; return used; } };
}

test("hard cap is 20 and an authentic shared budget stops at the 21st call", async (t) => {
  assert.equal(MAX_HTTP_CALLS_PER_RUN, 20);
  const stub = await startStub(t, replay(FIXTURE_BYTES));
  const provider = createLiveEvidenceProvider({ apiKey: TEST_API_KEY, apiBase: stub.base, budget: createCallBudget(20) });
  const results = [];
  for (let i = 0; i < 25; i += 1) results.push(await provider(subjectRequest));
  assert.equal(stub.requests.length, 20);
  assert.equal(results[20].status, "unavailable");
  assert.equal(results[20].unavailableReason, "call_cap_exceeded");
});

test("a forged budget object is refused by the provider before any call", async (t) => {
  const stub = await startStub(t, replay(FIXTURE_BYTES));
  assert.throws(() => createLiveEvidenceProvider({ apiKey: TEST_API_KEY, apiBase: stub.base, budget: forgedBudget() }),
    { code: "call_budget_not_authentic" });
  assert.equal(stub.requests.length, 0);
});

test("a forged budget object is refused by fetchAndVerifyLiveReceipt before any call", async (t) => {
  const stub = await startStub(t, replay(FIXTURE_BYTES));
  for (let i = 0; i < 25; i += 1) {
    const r = await fetchAndVerifyLiveReceipt({ apiKey: TEST_API_KEY, apiBase: stub.base, budget: forgedBudget(), fetchImpl: fetch });
    assert.equal(r.decision, "REFUSE");
    assert.equal(r.reason, "call_budget_not_authentic");
    assert.equal(r.httpCalls, 0);
  }
  assert.equal(stub.requests.length, 0);
});

test("requestReceipt refuses a forged or derived budget, and lookalikes are not authentic", async (t) => {
  const stub = await startStub(t, replay(FIXTURE_BYTES));
  const real = createCallBudget(20);
  const derived = Object.create(real); // prototype-inherits the real getters/take
  for (const b of [forgedBudget(), derived, { ...real }, null]) {
    assert.equal(isAuthenticCallBudget(b), false);
    await assert.rejects(requestReceipt({ apiBase: stub.base, apiKey: TEST_API_KEY,
      subject: { mintAddress: FIXTURE.mintAddress, tokenProgramAddress: FIXTURE.tokenProgramAddress }, timeoutMs: 5_000, budget: b, fetchImpl: fetch }),
      { code: "call_budget_not_authentic" });
  }
  assert.equal(isAuthenticCallBudget(real), true);
  assert.equal(stub.requests.length, 0);
  assert.throws(() => createCallBudget(21), { code: "call_budget_out_of_range" });
});
