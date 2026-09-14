/**
 * Agent A requests evidence, then applies its own policy to Raven's response.
 * Raven supplies evidence facts; Agent A alone owns PROCEED / REFUSE.
 */
import {
  BONK_FIXTURE_NOW,
  ravenVerifyEvidenceResponse,
} from "./ravenVerify.js";
import {
  PROTOCOL_VERSION,
  createClaimMessage,
  createEvidenceResponse,
  isProtocolMessage,
  messageId,
} from "./protocol.js";

export function createEvidenceRequest(claimMessage) {
  if (
    !isProtocolMessage(claimMessage, "solana.claim") ||
    claimMessage.from !== "agent-b" ||
    claimMessage.to !== "agent-a" ||
    !claimMessage.claim?.claimId ||
    !claimMessage.claim?.subject
  ) {
    throw new Error("invalid_claim_message");
  }

  return {
    protocolVersion: PROTOCOL_VERSION,
    type: "evidence.request",
    messageId: messageId("evidence-request", claimMessage.claim.claimId),
    from: "agent-a",
    to: "agent-b",
    replyTo: claimMessage.messageId,
    claimId: claimMessage.claim.claimId,
    requirements: {
      evidenceType: "raven.receipt-v1",
      subject: { ...claimMessage.claim.subject },
      verification: {
        integrity: "required",
        trustedSigner: "required",
        freshness: "required",
        subjectBinding: "required",
      },
    },
  };
}

export function applyDecisionPolicy({
  claimMessage,
  evidenceRequest,
  verificationResponse,
}) {
  const timeline = initialTimeline();

  if (!hasValidCorrelation(claimMessage, evidenceRequest, verificationResponse)) {
    return refuse({
      reason: "verification_correlation_failed",
      timeline,
      detail: "Fail closed: verification response did not match this claim and request.",
      claim: flattenClaim(claimMessage),
    });
  }

  const result = verificationResponse.result;
  if (!hasConsistentVerificationResult(result)) {
    const reason = result?.verified === true
      ? "verification_contract_failed"
      : (result?.reason ?? classifyRefuseReason(result?.axes));
    return refuse({
      reason,
      timeline,
      detail: "Agent A refuses because Raven's machine-readable requirements were not all satisfied.",
      claim: flattenClaim(claimMessage),
      result,
    });
  }

  timeline.push({
    state: "VERIFIED",
    detail: "Raven verified integrity, trust, freshness (against disclosed fixture evaluation time), and subject binding.",
  });
  timeline.push({
    state: "PROCEED",
    detail: "Agent A policy permits the downstream action from the verified response.",
  });
  return {
    decision: "PROCEED",
    ravenState: "VERIFIED",
    reason: "verified",
    evidenceIdentity: result.evidenceIdentity,
    axes: result.axes,
    disclosure: result.disclosure ?? null,
    timeline,
    claim: flattenClaim(claimMessage),
  };
}

function hasValidCorrelation(claim, request, verification) {
  const claimSubject = claim?.claim?.subject;
  const requestSubject = request?.requirements?.subject;
  return Boolean(
    isProtocolMessage(claim, "solana.claim") &&
      isProtocolMessage(request, "evidence.request") &&
      isProtocolMessage(verification, "evidence.verification") &&
      request.replyTo === claim.messageId &&
      request.claimId === claim.claim.claimId &&
      sameSubject(requestSubject, claimSubject) &&
      verification.requestId === request.messageId &&
      verification.claimId === claim.claim.claimId &&
      sameSubject(verification.subject, claimSubject) &&
      verification.to === "agent-a" &&
      verification.from === "raven",
  );
}

function sameSubject(left, right) {
  return Boolean(
    left &&
      right &&
      left.chain === right.chain &&
      left.mintAddress === right.mintAddress &&
      left.tokenProgramAddress === right.tokenProgramAddress,
  );
}

function hasConsistentVerificationResult(result) {
  return Boolean(
    result?.verified === true &&
      result.state === "VERIFIED" &&
      result.axes?.valid === true &&
      result.axes?.keyTrusted === true &&
      result.axes?.stale === false &&
      result.axes?.subjectMatches === true,
  );
}

function initialTimeline() {
  return [
    {
      state: "CLAIM_RECEIVED",
      detail: "Agent A received a machine-readable Solana claim from Agent B.",
    },
    {
      state: "REFUSE_BLIND_TRUST",
      detail: "Agent A will not trust Agent B's claim without independent Raven evidence.",
    },
    {
      state: "EVIDENCE_REQUESTED",
      detail: "Agent A sent requirements bound to the claim's Solana subject.",
    },
    {
      state: "VERIFYING",
      detail: "Agent A is consuming Raven's correlated verification response.",
    },
  ];
}

function refuse({ reason, timeline, detail, claim, result = null }) {
  timeline.push({ state: "VERIFICATION_FAILED", detail });
  timeline.push({
    state: "REFUSE",
    detail: "Agent A policy blocks the downstream action.",
  });
  return {
    decision: "REFUSE",
    ravenState: "VERIFICATION_FAILED",
    reason,
    evidenceIdentity: result?.evidenceIdentity ?? null,
    axes: result?.axes ?? null,
    disclosure: result?.disclosure ?? null,
    timeline,
    claim,
  };
}

function flattenClaim(message) {
  const claim = message?.claim ?? {};
  return {
    claimId: claim.claimId,
    chain: claim.subject?.chain,
    mintAddress: claim.subject?.mintAddress,
    tokenProgramAddress: claim.subject?.tokenProgramAddress,
    property: claim.property,
    summary: claim.summary,
  };
}

function classifyRefuseReason(axes) {
  if (!axes) return "verification_failed";
  if (axes.valid === false) return "integrity_or_malformed";
  if (axes.keyTrusted === false) return "untrusted_key";
  if (axes.stale === true) return "stale";
  if (axes.subjectMatches === false) return "subject_mismatch";
  if (axes.subjectMatches == null) return "subject_unavailable_or_invalid";
  return "verification_failed";
}

/** Backward-compatible adapter for callers that still provide claim + evidence. */
export async function agentADecide(input) {
  const claimMessage = createClaimMessage(input.claim);
  const evidenceRequest = createEvidenceRequest(claimMessage);
  const evidenceResponse = createEvidenceResponse(
    evidenceRequest,
    input.evidence ?? null,
  );
  const verificationResponse = await ravenVerifyEvidenceResponse({
    evidenceRequest,
    evidenceResponse,
    forceVerifierException: input.forceVerifierException === true,
    now: input.now ?? BONK_FIXTURE_NOW,
  });
  return applyDecisionPolicy({
    claimMessage,
    evidenceRequest,
    verificationResponse,
  });
}
