import assert from "node:assert/strict";
import test from "node:test";
import {
  runMachineExchange,
} from "../src/lib/runSlice.js";
import { applyDecisionPolicy } from "../src/lib/agentA.js";
import { PROTOCOL_VERSION } from "../src/lib/protocol.js";
import { ravenVerifyEvidenceResponse } from "../src/lib/ravenVerify.js";

test("Agent A and Agent B exchange correlated machine-readable messages", async () => {
  const result = await runMachineExchange("path_a_verified");

  assert.equal(result.protocolVersion, PROTOCOL_VERSION);
  assert.deepEqual(
    result.exchange.map((message) => message.type),
    [
      "solana.claim",
      "evidence.request",
      "evidence.response",
      "evidence.verification",
    ],
  );

  const [claim, request, response, verification] = result.exchange;
  assert.equal(request.replyTo, claim.messageId);
  assert.equal(response.replyTo, request.messageId);
  assert.equal(response.source.mode, "deterministic_fixture");
  assert.equal(response.source.liveAcquisition, false);
  assert.equal(verification.result.disclosure.liveAcquisition, false);
  assert.equal(verification.result.disclosure.evaluationTime, "2026-06-26T11:46:31.000Z");
  assert.equal(
    verification.result.disclosure.evaluationTimeKind,
    "deterministic_fixture_demo_time",
  );
  assert.equal(verification.replyTo, response.messageId);
  assert.equal(verification.requestId, request.messageId);
  assert.deepEqual(request.requirements.subject, claim.claim.subject);
  assert.equal(verification.result.verified, true);
  assert.equal(result.outcome, "PROCEED");
});

test("Agent A policy refuses a verification response with broken correlation", async () => {
  const result = await runMachineExchange("path_a_verified");
  const [claim, request, , verification] = result.exchange;

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

test("Agent A policy refuses a request subject swapped under the same claim id", async () => {
  const result = await runMachineExchange("path_b_wrong_subject");
  const [claim, request, response] = result.exchange;
  const swappedRequest = {
    ...request,
    requirements: {
      ...request.requirements,
      subject: {
        chain: "solana-mainnet",
        mintAddress: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
        tokenProgramAddress: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      },
    },
  };
  const verification = await ravenVerifyEvidenceResponse({
    evidenceRequest: swappedRequest,
    evidenceResponse: response,
  });
  assert.equal(verification.result.verified, true, "attack precondition");

  const decision = applyDecisionPolicy({
    claimMessage: claim,
    evidenceRequest: swappedRequest,
    verificationResponse: verification,
  });
  assert.equal(decision.decision, "REFUSE");
  assert.equal(decision.reason, "verification_correlation_failed");
});

test("tampered evidence causally produces FAILED then REFUSE", async () => {
  const result = await runMachineExchange("path_b_tampered");
  const verification = result.exchange.at(-1);

  assert.equal(verification.type, "evidence.verification");
  assert.equal(verification.result.verified, false);
  assert.equal(verification.result.axes.valid, false);
  assert.equal(result.outcome, "REFUSE");
  assert.equal(result.agentA.reason, "integrity_or_malformed");
});

test("missing evidence is an explicit response and fails closed", async () => {
  const result = await runMachineExchange("path_b_missing");
  const response = result.exchange[2];
  const verification = result.exchange[3];

  assert.equal(response.status, "unavailable");
  assert.equal(response.evidence, null);
  assert.equal(response.source.mode, "none");
  assert.equal(response.source.liveAcquisition, false);
  assert.equal(verification.result.verified, false);
  assert.equal(verification.result.reason, "missing_evidence");
  assert.equal(result.outcome, "REFUSE");
});
