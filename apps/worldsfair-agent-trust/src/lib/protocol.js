export const PROTOCOL_VERSION = "raven-agent-trust/1";

export function messageId(type, claimId) {
  return `${PROTOCOL_VERSION}:${type}:${claimId}`;
}

export function isProtocolMessage(value, type) {
  return Boolean(
    value &&
      typeof value === "object" &&
      value.protocolVersion === PROTOCOL_VERSION &&
      value.type === type &&
      typeof value.messageId === "string",
  );
}

export function createClaimMessage(claim) {
  const subject = {
    chain: claim.chain,
    mintAddress: claim.mintAddress,
    tokenProgramAddress: claim.tokenProgramAddress,
  };
  return {
    protocolVersion: PROTOCOL_VERSION,
    type: "solana.claim",
    messageId: messageId("claim", claim.claimId),
    from: "agent-b",
    to: "agent-a",
    claim: {
      claimId: claim.claimId,
      subject,
      property: claim.property,
      summary: claim.summary,
    },
  };
}

export function createEvidenceResponse(evidenceRequest, evidence, options = {}) {
  const supplied = evidence != null;
  return {
    protocolVersion: PROTOCOL_VERSION,
    type: "evidence.response",
    messageId: messageId("evidence-response", evidenceRequest.claimId),
    from: "agent-b",
    to: "agent-a",
    replyTo: evidenceRequest.messageId,
    claimId: evidenceRequest.claimId,
    status: supplied ? "supplied" : "unavailable",
    unavailableReason: supplied
      ? null
      : (options.unavailableReason ?? "not_supplied"),
    source: options.source ?? null,
    evidence,
  };
}
