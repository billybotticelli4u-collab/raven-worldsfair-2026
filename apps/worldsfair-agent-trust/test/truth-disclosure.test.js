import assert from "node:assert/strict";
import test from "node:test";
import {
  BONK_FIXTURE_NOW,
  ravenVerifyEvidenceResponse,
} from "../src/lib/ravenVerify.js";
import { runMachineExchange } from "../src/lib/runSlice.js";
import { applyDecisionPolicy } from "../src/lib/agentA.js";

test("verification disclosure matches BONK_FIXTURE_NOW supplied to the verifier", async () => {
  const result = await runMachineExchange("path_a_verified");
  const response = result.exchange.find((m) => m.type === "evidence.response");
  const verification = result.exchange.find((m) => m.type === "evidence.verification");
  const d = verification.result.disclosure;

  assert.ok(d, "disclosure present on verification result");
  assert.equal(d.liveAcquisition, false);
  assert.equal(d.evaluationTime, BONK_FIXTURE_NOW);
  assert.equal(d.evaluationTimeKind, "deterministic_fixture_demo_time");
  assert.match(
    d.evaluationTimeLabel,
    /Deterministic fixture\/demo evaluation time/,
  );
  assert.match(d.evaluationTimeLabel, /not wall clock/i);
  assert.match(d.evaluationTimeLabel, /not current Solana freshness/i);
  assert.equal(d.evidenceSource.liveAcquisition, false);
  assert.equal(d.evidenceSource.mode, response.source.mode);
  assert.equal(d.evidenceSource.fixture, response.source.fixture);

  // Agent A surfaces the same disclosure for the judge UI
  assert.equal(result.agentA.disclosure.evaluationTime, BONK_FIXTURE_NOW);
  assert.equal(result.agentA.disclosure.liveAcquisition, false);
});

test("disclosed evaluationTime equals the now value passed into ravenVerifyEvidenceResponse", async () => {
  const base = await runMachineExchange("path_a_verified");
  const [, request, response] = base.exchange;
  const customNow = "2026-06-26T11:46:31.000Z";

  const verification = await ravenVerifyEvidenceResponse({
    evidenceRequest: request,
    evidenceResponse: response,
    now: customNow,
  });

  assert.equal(verification.result.disclosure.evaluationTime, customNow);
  assert.equal(
    verification.result.disclosure.evaluationTime,
    new Date(customNow).toISOString(),
  );
  assert.equal(verification.result.disclosure.liveAcquisition, false);
  assert.equal(
    verification.result.disclosure.evaluationTimeKind,
    "deterministic_fixture_demo_time",
  );
});

test("missing-evidence path still discloses non-live fixture evaluation time", async () => {
  const result = await runMachineExchange("path_b_missing");
  const verification = result.exchange.at(-1);
  const d = verification.result.disclosure;

  assert.equal(verification.result.verified, false);
  assert.equal(d.liveAcquisition, false);
  assert.equal(d.evaluationTime, BONK_FIXTURE_NOW);
  assert.equal(d.evaluationTimeKind, "deterministic_fixture_demo_time");
  assert.equal(result.agentA.disclosure.evaluationTime, BONK_FIXTURE_NOW);
});

test("all five Day-2 paths keep fail-closed outcomes with disclosure present", async () => {
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

test("policy still refuses broken correlation even when disclosure is present", async () => {
  const result = await runMachineExchange("path_a_verified");
  const [claim, request, , verification] = result.exchange;
  assert.ok(verification.result.disclosure);

  const decision = applyDecisionPolicy({
    claimMessage: claim,
    evidenceRequest: request,
    verificationResponse: {
      ...verification,
      requestId: "request:unrelated-claim",
    },
  });
  assert.equal(decision.decision, "REFUSE");
  assert.equal(decision.reason, "verification_correlation_failed");
});
