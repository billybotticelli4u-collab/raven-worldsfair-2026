import assert from "node:assert/strict";
import test from "node:test";
import { runVerticalSlice } from "../src/lib/runSlice.js";
import { agentADecide } from "../src/lib/agentA.js";
import { agentBSupplyEvidence } from "../src/lib/agentB.js";
import {
  ravenVerifyReceiptForSubject,
  loadJsonFixture,
  BONK_SUBJECT,
  BONK_FIXTURE_NOW,
} from "../src/lib/ravenVerify.js";

test("valid evidence → Raven verified", async () => {
  const receipt = loadJsonFixture("bonk-valid-receipt.json");
  const raven = await ravenVerifyReceiptForSubject({
    receipt,
    expectedSubject: BONK_SUBJECT,
    now: BONK_FIXTURE_NOW,
  });
  assert.equal(raven.verified, true);
  assert.equal(raven.state, "VERIFIED");
  assert.equal(raven.axes.valid, true);
  assert.equal(raven.axes.keyTrusted, true);
  assert.equal(raven.axes.subjectMatches, true);
});

test("verified → Agent A PROCEED", async () => {
  const result = await runVerticalSlice("path_a_verified");
  assert.equal(result.outcome, "PROCEED");
  assert.equal(result.agentA.decision, "PROCEED");
  assert.equal(result.agentA.ravenState, "VERIFIED");
});

test("invalid (tampered) → Raven fail", async () => {
  const receipt = loadJsonFixture("bonk-tampered-receipt.json");
  const raven = await ravenVerifyReceiptForSubject({
    receipt,
    expectedSubject: BONK_SUBJECT,
    now: BONK_FIXTURE_NOW,
  });
  assert.equal(raven.verified, false);
  assert.equal(raven.state, "VERIFICATION_FAILED");
  assert.equal(raven.axes.valid, false);
});

test("fail → Agent A REFUSE (tampered path)", async () => {
  const result = await runVerticalSlice("path_b_tampered");
  assert.equal(result.outcome, "REFUSE");
  assert.equal(result.agentA.decision, "REFUSE");
  assert.equal(result.agentA.ravenState, "VERIFICATION_FAILED");
});

test("wrong subject → REFUSE", async () => {
  const result = await runVerticalSlice("path_b_wrong_subject");
  assert.equal(result.outcome, "REFUSE");
  assert.equal(result.agentA.reason, "subject_mismatch");
});

test("missing evidence → REFUSE", async () => {
  const result = await runVerticalSlice("path_b_missing");
  assert.equal(result.outcome, "REFUSE");
  assert.equal(result.agentA.reason, "missing_evidence");
});

test("verifier exception → REFUSE", async () => {
  const result = await runVerticalSlice("path_b_exception");
  assert.equal(result.outcome, "REFUSE");
  assert.equal(result.agentA.reason, "verifier_exception");
});

test("Agent A never proceeds on bare claim without evidence", async () => {
  const fromB = agentBSupplyEvidence("missing");
  const decision = await agentADecide({
    claim: fromB.claim,
    evidence: null,
  });
  assert.equal(decision.decision, "REFUSE");
  assert.ok(decision.timeline.some((t) => t.state === "REFUSE_BLIND_TRUST"));
  assert.ok(decision.timeline.some((t) => t.state === "EVIDENCE_REQUESTED"));
});
