import assert from "node:assert/strict";
import test from "node:test";
import {
  BONK_FIXTURE_NOW,
  ravenVerifyEvidenceResponse,
} from "../src/lib/ravenVerify.js";
import { runMachineExchange } from "../src/lib/runSlice.js";
import { applyDecisionPolicy } from "../src/lib/agentA.js";

async function verifiedExchangeParts() {
  const base = await runMachineExchange("path_a_verified");
  const [claim, request, response] = base.exchange;
  return { claim, request, response };
}

async function decideWithNow(now) {
  const { claim, request, response } = await verifiedExchangeParts();
  const verification = await ravenVerifyEvidenceResponse({
    evidenceRequest: request,
    evidenceResponse: response,
    now,
  });
  const decision = applyDecisionPolicy({
    claimMessage: claim,
    evidenceRequest: request,
    verificationResponse: verification,
  });
  return { verification, decision };
}

test("1 valid BONK_FIXTURE_NOW → VERIFIED/PROCEED", async () => {
  const { verification, decision } = await decideWithNow(BONK_FIXTURE_NOW);
  assert.equal(verification.result.verified, true);
  assert.equal(verification.result.state, "VERIFIED");
  assert.equal(decision.decision, "PROCEED");
  assert.equal(verification.result.disclosure.evaluationTime, BONK_FIXTURE_NOW);
});

test("2 disclosure time equals exact verification time (normalized ISO)", async () => {
  const { claim, request, response } = await verifiedExchangeParts();
  // Equivalent instant, non-canonical input form — verify + disclose same ISO
  const inputNow = new Date(BONK_FIXTURE_NOW);
  const verification = await ravenVerifyEvidenceResponse({
    evidenceRequest: request,
    evidenceResponse: response,
    now: inputNow,
  });
  const expectedIso = inputNow.toISOString();
  assert.equal(verification.result.disclosure.evaluationTime, expectedIso);
  assert.equal(expectedIso, BONK_FIXTURE_NOW);
  assert.equal(verification.result.verified, true);

  // Custom valid time: disclosure must equal the normalized value used for verify
  const custom = "2026-06-26T11:46:31.000Z";
  const v2 = await ravenVerifyEvidenceResponse({
    evidenceRequest: request,
    evidenceResponse: response,
    now: custom,
  });
  assert.equal(v2.result.disclosure.evaluationTime, new Date(custom).toISOString());
  assert.equal(v2.result.disclosure.evaluationTime, custom);
});

test("3 empty evaluation time → REFUSE (never fixture fallback)", async () => {
  const { verification, decision } = await decideWithNow("");
  assert.equal(verification.result.verified, false);
  assert.equal(verification.result.reason, "invalid_evaluation_time");
  assert.equal(verification.result.disclosure.evaluationTime, null);
  assert.notEqual(verification.result.disclosure.evaluationTime, BONK_FIXTURE_NOW);
  assert.equal(decision.decision, "REFUSE");
});

test("4 invalid date string → REFUSE", async () => {
  const { verification, decision } = await decideWithNow("not-a-date");
  assert.equal(verification.result.verified, false);
  assert.equal(verification.result.reason, "invalid_evaluation_time");
  assert.equal(verification.result.disclosure.evaluationTime, null);
  assert.equal(decision.decision, "REFUSE");
});

test("5 invalid Date object → REFUSE", async () => {
  const { verification, decision } = await decideWithNow(new Date("invalid"));
  assert.equal(verification.result.verified, false);
  assert.equal(verification.result.reason, "invalid_evaluation_time");
  assert.equal(verification.result.disclosure.evaluationTime, null);
  assert.equal(decision.decision, "REFUSE");
});

test("6 omitted now uses Day-2 default fixture (API does not require explicit time)", async () => {
  const { claim, request, response } = await verifiedExchangeParts();
  const verification = await ravenVerifyEvidenceResponse({
    evidenceRequest: request,
    evidenceResponse: response,
    // now omitted → default BONK_FIXTURE_NOW
  });
  assert.equal(verification.result.verified, true);
  assert.equal(verification.result.disclosure.evaluationTime, BONK_FIXTURE_NOW);
  const decision = applyDecisionPolicy({
    claimMessage: claim,
    evidenceRequest: request,
    verificationResponse: verification,
  });
  assert.equal(decision.decision, "PROCEED");

  // Explicit null is NOT a missing default — fail closed (strengthen vs parent)
  const nullCase = await decideWithNow(null);
  assert.equal(nullCase.verification.result.reason, "invalid_evaluation_time");
  assert.equal(nullCase.decision.decision, "REFUSE");
});

test("7 malformed never becomes fixture time in disclosure", async () => {
  for (const bad of ["", "not-a-date", "totally-bogus", new Date(NaN), null]) {
    const { verification } = await decideWithNow(bad);
    assert.equal(
      verification.result.disclosure.evaluationTime,
      null,
      `disclosure must not invent fixture for ${String(bad)}`,
    );
    assert.notEqual(
      verification.result.disclosure.evaluationTime,
      BONK_FIXTURE_NOW,
    );
  }
});

test("8 malformed never PROCEED", async () => {
  for (const bad of ["", "not-a-date", new Date("nope"), null, Number.NaN]) {
    const { decision, verification } = await decideWithNow(bad);
    assert.equal(decision.decision, "REFUSE", String(bad));
    assert.equal(verification.result.verified, false, String(bad));
    assert.notEqual(decision.decision, "PROCEED", String(bad));
  }
});

test("9 five existing Day-2 paths unchanged", async () => {
  const expected = {
    path_a_verified: "PROCEED",
    path_b_tampered: "REFUSE",
    path_b_wrong_subject: "REFUSE",
    path_b_missing: "REFUSE",
    path_b_exception: "REFUSE",
  };
  for (const [path, outcome] of Object.entries(expected)) {
    const result = await runMachineExchange(path);
    assert.equal(result.outcome, outcome, path);
    const verification = result.exchange.find((m) => m.type === "evidence.verification");
    assert.equal(verification.result.disclosure.liveAcquisition, false, path);
    assert.equal(
      verification.result.disclosure.evaluationTime,
      BONK_FIXTURE_NOW,
      path,
    );
  }
});

test("10 liveAcquisition:false + deterministic-fixture disclosure remain truthful", async () => {
  const result = await runMachineExchange("path_a_verified");
  const verification = result.exchange.find((m) => m.type === "evidence.verification");
  const d = verification.result.disclosure;
  assert.equal(d.liveAcquisition, false);
  assert.equal(d.evidenceSource.liveAcquisition, false);
  assert.equal(d.evaluationTimeKind, "deterministic_fixture_demo_time");
  assert.match(d.evaluationTimeLabel, /not wall clock/i);
  assert.match(d.evaluationTimeLabel, /not current Solana freshness/i);
  assert.equal(d.evaluationTime, BONK_FIXTURE_NOW);
  assert.equal(result.agentA.disclosure.liveAcquisition, false);
  assert.equal(result.agentA.disclosure.evaluationTime, BONK_FIXTURE_NOW);
});

test("malformed-clock restore/strengthen vs parent 56761aa fail-closed", async () => {
  // Parent refused empty/invalid string/invalid Date via verifier axes.
  // a103647 fail-opened those to PROCEED via BONK_FIXTURE_NOW substitution.
  // This repair restores refuse and strengthens null (parent treated null as epoch).
  const cases = [
    ["empty", ""],
    ["invalid_string", "not-a-date"],
    ["invalid_date", new Date("invalid")],
    ["null_strengthen", null],
  ];
  for (const [label, now] of cases) {
    const { verification, decision } = await decideWithNow(now);
    assert.equal(verification.result.verified, false, label);
    assert.equal(verification.result.reason, "invalid_evaluation_time", label);
    assert.equal(decision.decision, "REFUSE", label);
    assert.equal(verification.result.disclosure.evaluationTime, null, label);
  }
});
