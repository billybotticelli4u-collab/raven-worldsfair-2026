/**
 * Adversarial live-flow cases 4, 5, 6, 7, 8 — identity, directory and
 * verification layer. Every case must end in REFUSE with the named code;
 * matching red controls live in red-controls.mjs.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { startRegistry } from "../../src/live/registryServer.js";
import { startAgentB } from "../../src/live/agentBServer.js";
import { createAgentA } from "../../src/live/agentACore.js";
import { agentBHandleEvidenceRequest, agentBMakeClaimMessage } from "../../src/lib/agentB.js";
import { createEvidenceResponse } from "../../src/lib/protocol.js";
import { BONK_SUBJECT } from "../../src/lib/ravenVerify.js";
import { makeCard } from "../../src/live/cards.js";
import { EVIDENCE_CAPABILITY, VERIFIER_PIN } from "../../src/live/constants.js";
import { loadVendorReceipt, registerCard, SOL_SUBJECT, startRogueB } from "./helpers.mjs";

async function world(t) {
  const reg = await startRegistry();
  t.after(() => reg.close());
  return { reg, a: (opts = {}) => createAgentA({ registryUrl: reg.url, ...opts }) };
}
const run1 = (a, id, opts) => a.run({ targetAgentId: id, ...opts }).then((r) => r.attempts[0]);
const bonkCard = (agentId, endpoint) => makeCard({
  agentId,
  role: "evidence-provider",
  endpoint,
  capabilities: [EVIDENCE_CAPABILITY],
  verifierPin: VERIFIER_PIN,
  subjects: [{ ...BONK_SUBJECT }],
  evidenceSource: "retained_fixture",
});

// ---------------------------------------------------------------- case 4
test("case 4a: receipt signed by the wrong key -> REFUSE untrusted_key", async (t) => {
  const { reg, a } = await world(t);
  const wrongKeyReceipt = loadVendorReceipt("wrong-key.json");
  const b = await startAgentB({ variant: "honest", agentId: "agent-b-wrong-key", registryUrl: reg.url }, {
    evidenceProvider: async (request) =>
      createEvidenceResponse(request, wrongKeyReceipt, { source: { mode: "vendor_fixture", fixture: "wrong-key.json", liveAcquisition: false } }),
  });
  t.after(() => b.close());
  const at = await run1(a(), "agent-b-wrong-key");
  assert.equal(at.outcome, "REFUSE");
  assert.equal(at.stage, "verification");
  assert.equal(at.reason, "untrusted_key");
});

test("case 4b: key substituted in the agent card (verifier pin swapped) -> REFUSE verifier_pin_mismatch, never contacted", async (t) => {
  const { reg, a } = await world(t);
  const b = await startAgentB({ variant: "bad-pin", registryUrl: reg.url });
  t.after(() => b.close());
  let contacted = 0;
  const origFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = origFetch; });
  globalThis.fetch = (...args) => {
    if (typeof args[0] === "string" && args[0].includes(b.url)) contacted++;
    return origFetch(...args);
  };
  const at = await run1(a(), "agent-b-bad-pin");
  assert.equal(at.outcome, "REFUSE");
  assert.equal(at.stage, "discovery");
  assert.equal(at.reason, "verifier_pin_mismatch");
  assert.equal(contacted, 0, "a pin-mismatched card must never be contacted");
});

// ---------------------------------------------------------------- case 5
for (const [name, tamper] of [
  ["capability", { capabilities: ["evidence.request:other.attestation"] }],
  ["endpoint", { endpoint: "http://127.0.0.1:1" }],
  ["verifier-key-pin", { verifierPin: "raven-receipt-verifier@0000000000000000000000000000000000000000" }],
]) {
  test(`case 5 (${name}): card field changed after listing -> REFUSE endpoint_card_mismatch`, async (t) => {
    const { reg, a } = await world(t);
    const rogue = await startRogueB(t, {
      agentId: `agent-b-tampered-card-${name}`,
      registryUrl: reg.url,
      behavior: "honest",
      cardTamper: tamper,
    });
    const at = await run1(a(), rogue.agentId);
    assert.equal(at.outcome, "REFUSE", "a post-listing card change must never PROCEED");
    assert.equal(at.stage, "card_check");
    assert.equal(at.reason, "endpoint_card_mismatch");
  });
}

// ---------------------------------------------------------------- case 6
test("case 6a: directory points to an impostor agent -> REFUSE endpoint_card_mismatch", async (t) => {
  const { reg, a } = await world(t);
  const honest = await startAgentB({ variant: "honest", registryUrl: reg.url });
  t.after(() => honest.close());
  // self-asserted impostor listing: claims its own id, serves honest's endpoint
  const res = await registerCard(reg.url, bonkCard("agent-b-impostor-self", honest.url));
  assert.equal(res.status, 201, "the directory stores claims without vouching");
  const at = await run1(a(), "agent-b-impostor-self");
  assert.equal(at.outcome, "REFUSE");
  assert.equal(at.stage, "card_check");
  assert.equal(at.reason, "endpoint_card_mismatch");
  assert.equal(at.servedAgentId, "agent-b-honest");
});

test("case 6b: duplicate agent id in the directory -> second registration 409, listing never duplicates", async (t) => {
  const { reg } = await world(t);
  const port1 = "http://127.0.0.1:1";
  const card = bonkCard("agent-b-dupe", port1);
  const first = await registerCard(reg.url, card);
  assert.equal(first.status, 201);
  const second = await registerCard(reg.url, { ...card, endpoint: "http://127.0.0.1:2" });
  assert.equal(second.status, 409, "duplicate id must be refused");
  assert.equal(second.json?.error, "agent_id_taken");
  const list = await registerList(reg.url);
  assert.equal(list.filter((e) => e.card.agentId === "agent-b-dupe").length, 1, "directory must never list a duplicate id");
});

async function registerList(registryUrl) {
  const { status, json } = await import("../../src/live/http.js").then((m) => m.loopbackJson(`${registryUrl}/v0/agents`));
  assert.equal(status, 200);
  return json.agents;
}

// ---------------------------------------------------------------- case 7
test("case 7: one receipt field changed without re-signing -> REFUSE integrity_or_malformed", async (t) => {
  const { reg, a } = await world(t);
  const rogue = await startRogueB(t, { agentId: "agent-b-field-flip", registryUrl: reg.url, behavior: "field-flip" });
  const at = await run1(a(), rogue.agentId);
  assert.equal(at.outcome, "REFUSE");
  assert.equal(at.stage, "verification");
  assert.equal(at.reason, "integrity_or_malformed");
});

// ---------------------------------------------------------------- case 8
test("case 8: mint mismatch between the requested subject and the receipt -> REFUSE subject_mismatch", async (t) => {
  const { reg, a } = await world(t);
  // Agent B genuinely offers the wSOL subject and genuinely answers, but its
  // evidence is the BONK receipt: the receipt subject cannot match the request.
  const b = await startAgentB({ variant: "honest", agentId: "agent-b-mint-liar", registryUrl: reg.url, subject: SOL_SUBJECT }, {
    claimProvider: () => agentBMakeClaimMessage("wrong_subject"),
    evidenceProvider: async (request) => agentBHandleEvidenceRequest(request, "valid").evidenceResponse,
  });
  t.after(() => b.close());
  const at = await run1(a(), "agent-b-mint-liar", { subject: SOL_SUBJECT });
  assert.equal(at.outcome, "REFUSE");
  assert.equal(at.stage, "verification");
  assert.equal(at.reason, "subject_mismatch");
});
