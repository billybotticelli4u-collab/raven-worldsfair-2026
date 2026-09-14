/**
 * Agent A — decision machine.
 * Refuses blind trust. Requests Raven evidence. PROCEED only if verified.
 */
import {
  BONK_FIXTURE_NOW,
  ravenVerifyReceiptForSubject,
} from "./ravenVerify.js";

/**
 * @typedef {object} AgentAInput
 * @property {{ chain: string; mintAddress: string; tokenProgramAddress: string; summary?: string; claimId?: string }} claim
 * @property {unknown} [evidence]
 * @property {boolean} [forceVerifierException]
 * @property {Date | string} [now]
 */

/**
 * @param {AgentAInput} input
 */
export async function agentADecide(input) {
  const timeline = [];

  timeline.push({
    state: "CLAIM_RECEIVED",
    detail: "Agent A received a Solana-grounded claim from Agent B.",
  });
  timeline.push({
    state: "REFUSE_BLIND_TRUST",
    detail: "Agent A will not trust Agent B's claim without independent Raven evidence.",
  });
  timeline.push({
    state: "EVIDENCE_REQUESTED",
    detail: "Agent A requested Raven receipt-v1 evidence bound to the claimed subject.",
  });

  if (input.forceVerifierException) {
    timeline.push({
      state: "EVIDENCE_RECEIVED",
      detail: "Exception probe engaged.",
    });
    timeline.push({ state: "VERIFYING", detail: "Invoking Raven verifier…" });
    try {
      throw new Error("controlled_verifier_exception");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      timeline.push({
        state: "VERIFICATION_FAILED",
        detail: `Verifier exception: ${message}`,
      });
      return {
        decision: "REFUSE",
        ravenState: "VERIFICATION_FAILED",
        reason: "verifier_exception",
        evidenceIdentity: null,
        axes: null,
        timeline,
        claim: input.claim,
      };
    }
  }

  if (input.evidence == null) {
    timeline.push({
      state: "EVIDENCE_MISSING",
      detail: "No Raven receipt was supplied.",
    });
    timeline.push({
      state: "REFUSE",
      detail: "Fail closed: missing evidence.",
    });
    return {
      decision: "REFUSE",
      ravenState: "VERIFICATION_FAILED",
      reason: "missing_evidence",
      evidenceIdentity: null,
      axes: null,
      timeline,
      claim: input.claim,
    };
  }

  timeline.push({
    state: "EVIDENCE_RECEIVED",
    detail: "Raven receipt evidence received; independent verify starting.",
  });
  timeline.push({ state: "VERIFYING", detail: "Raven verifying offline…" });

  let raven;
  try {
    const expectedSubject = {
      chain: "solana-mainnet",
      mintAddress: input.claim.mintAddress,
      tokenProgramAddress: input.claim.tokenProgramAddress,
    };
    // Defensive: claim chain must be the frozen namespace
    if (input.claim.chain !== "solana-mainnet") {
      timeline.push({
        state: "VERIFICATION_FAILED",
        detail: "Unsupported or malformed claimed chain.",
      });
      return {
        decision: "REFUSE",
        ravenState: "VERIFICATION_FAILED",
        reason: "unsupported_or_malformed_claim",
        evidenceIdentity: null,
        axes: null,
        timeline,
        claim: input.claim,
      };
    }

    raven = await ravenVerifyReceiptForSubject({
      receipt: input.evidence,
      expectedSubject,
      now: input.now ?? BONK_FIXTURE_NOW,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    timeline.push({
      state: "VERIFICATION_FAILED",
      detail: `Verifier exception: ${message}`,
    });
    return {
      decision: "REFUSE",
      ravenState: "VERIFICATION_FAILED",
      reason: "verifier_exception",
      evidenceIdentity: null,
      axes: null,
      timeline,
      claim: input.claim,
    };
  }

  if (raven.verified) {
    timeline.push({
      state: "VERIFIED",
      detail: "Raven verified integrity, trust, freshness, and subject binding.",
    });
    timeline.push({
      state: "PROCEED",
      detail: "Agent A proceeds — claim is backed by independently verifiable evidence.",
    });
    return {
      decision: "PROCEED",
      ravenState: "VERIFIED",
      reason: "verified",
      evidenceIdentity: raven.evidenceIdentity,
      axes: raven.axes,
      timeline,
      claim: input.claim,
    };
  }

  timeline.push({
    state: "VERIFICATION_FAILED",
    detail: "Raven failed closed (integrity/trust/subject/freshness).",
  });
  timeline.push({
    state: "REFUSE",
    detail: "Agent A refuses — downstream action must not proceed.",
  });
  return {
    decision: "REFUSE",
    ravenState: "VERIFICATION_FAILED",
    reason: classifyRefuseReason(raven.axes),
    evidenceIdentity: raven.evidenceIdentity,
    axes: raven.axes,
    timeline,
    claim: input.claim,
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
