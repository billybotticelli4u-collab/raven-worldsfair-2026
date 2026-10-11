/**
 * Adversarial live-path cases 11 and 12 — the challenge-binding gate and
 * the card evidence-source label, exercised over the wire against rogues.
 *
 * Case 11: a rogue that CLAIMS live acquisition (source.liveAcquisition:true)
 * must satisfy the live-path challenge binding: the receipt-v1 signed-body
 * timestamp must not precede challenge.issuedAt by more than the 5 s skew.
 * Case 12: a provider whose card says retained_fixture but whose evidence
 * claims live acquisition must not pass as a fixture exchange — the attempt
 * transcript must expose the disagreement (advertisedEvidenceSource vs
 * evidenceSource), and the tampered receipt must still fail closed.
 * Matching red controls live in red-controls.mjs.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { startRegistry } from "../../src/live/registryServer.js";
import { startAgentB } from "../../src/live/agentBServer.js";
import { createAgentA } from "../../src/live/agentACore.js";
import { agentBHandleEvidenceRequest } from "../../src/lib/agentB.js";
import { startRogueB } from "./helpers.mjs";

async function world(t) {
  const reg = await startRegistry();
  t.after(() => reg.close());
  return { reg, a: (opts = {}) => createAgentA({ registryUrl: reg.url, ...opts }) };
}
const run1 = (a, id) => a.run({ targetAgentId: id }).then((r) => r.attempts[0]);

// --------------------------------------------------------------- case 11
test("case 11a: live-path receipt signed 60 s before the challenge -> REFUSE receipt_predates_challenge", async (t) => {
  const { reg, a } = await world(t);
  const rogue = await startRogueB(t, { agentId: "agent-b-predated-live-rogue", registryUrl: reg.url, behavior: "live-predated-receipt" });
  const at = await run1(a(), rogue.agentId);
  assert.equal(at.outcome, "REFUSE");
  assert.equal(at.reason, "receipt_predates_challenge");
  assert.equal(at.stage, "challenge_binding");
  assert.equal(at.binding.receiptTimestamp < at.binding.challengeIssuedAt, true, "the predated receipt must be the refused evidence");
});

test("case 11b: live-path receipt with unparseable timestamp -> REFUSE receipt_timestamp_invalid", async (t) => {
  const { reg, a } = await world(t);
  const rogue = await startRogueB(t, { agentId: "agent-b-badts-live-rogue", registryUrl: reg.url, behavior: "live-invalid-receipt-timestamp" });
  const at = await run1(a(), rogue.agentId);
  assert.equal(at.outcome, "REFUSE");
  assert.equal(at.reason, "receipt_timestamp_invalid");
  assert.equal(at.stage, "challenge_binding");
});

// --------------------------------------------------------------- case 12
test("case 12: card says retained_fixture but evidence claims live acquisition -> REFUSE (tampered receipt) and the transcript exposes the mismatch", async (t) => {
  const { reg, a } = await world(t);
  // The rogue's card advertises the fixture label while its evidence claims
  // live acquisition. The timestamp is moved just AFTER the challenge so the
  // binding gate cannot mask the case; the moved (re-signed-invalid) receipt
  // must then fail verification.
  const rogue = await startRogueB(t, { agentId: "agent-b-fixture-card-live-rogue", registryUrl: reg.url, behavior: "fixture-card-claims-live" });
  const at = await run1(a(), rogue.agentId);
  assert.equal(at.outcome, "REFUSE");
  assert.equal(at.reason, "integrity_or_malformed");
  assert.equal(at.stage, "verification");
  // the transcript must expose the disagreement instead of silently conflating
  assert.equal(at.advertisedEvidenceSource, "retained_fixture");
  assert.equal(at.evidenceSource?.liveAcquisition, true,
    "evidence claiming live acquisition must not be recorded as a fixture exchange");
});

test("control: an honest Agent B with a plugged-in live provider never advertises retained_fixture (provider-label regression)", async (t) => {
  const { reg } = await world(t);
  const b = await startAgentB({ variant: "honest", agentId: "agent-b-live-provider", registryUrl: reg.url }, {
    evidenceProvider: async (request) => agentBHandleEvidenceRequest(request, "valid").evidenceResponse,
  });
  t.after(() => b.close());
  assert.notEqual(b.card.evidenceSource, "retained_fixture",
    "a live evidence provider must never be advertised as retained_fixture");
  assert.equal(b.card.evidenceSource, "custom_evidence_provider");
});
