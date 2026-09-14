/**
 * Agent B — claim machine.
 * Makes ONE Solana-grounded claim and may supply Raven receipt evidence.
 */
import {
  BONK_SUBJECT,
  loadJsonFixture,
} from "./ravenVerify.js";

export function makeBonkClaim() {
  return {
    agent: "B",
    claimId: "wf2026-day1-bonk-receipt-valid",
    chain: BONK_SUBJECT.chain,
    mintAddress: BONK_SUBJECT.mintAddress,
    tokenProgramAddress: BONK_SUBJECT.tokenProgramAddress,
    property:
      "Has a valid Raven receipt-v1 for measured freeze_authority, mint_authority, and token_program_tier scope.",
    summary:
      "BONK (DezX…PB263) under SPL Token has a valid Raven receipt for the measured authority/program properties.",
  };
}

/**
 * @param {"valid" | "tampered" | "wrong_subject" | "missing" | "throw"} mode
 */
export function agentBSupplyEvidence(mode) {
  const claim = makeBonkClaim();

  if (mode === "missing") {
    return {
      claim,
      evidence: null,
      evidenceStatus: "missing",
      note: "Agent B supplied claim only — no Raven receipt attached.",
    };
  }

  if (mode === "throw") {
    return {
      claim,
      evidence: null,
      evidenceStatus: "exception_probe",
      forceVerifierException: true,
      note: "Controlled probe: verifier will be forced to throw.",
    };
  }

  if (mode === "wrong_subject") {
    const receipt = loadJsonFixture("bonk-valid-receipt.json");
    const wrongClaim = {
      ...claim,
      mintAddress: "So11111111111111111111111111111111111111112",
      summary:
        "Agent B claims wSOL mint has this BONK receipt (subject mismatch).",
      claimId: "wf2026-day1-wrong-subject",
    };
    return {
      claim: wrongClaim,
      evidence: receipt,
      evidenceStatus: "received",
      note: "Valid BONK receipt bytes presented against a mismatched claimed mint.",
    };
  }

  if (mode === "tampered") {
    return {
      claim,
      evidence: loadJsonFixture("bonk-tampered-receipt.json"),
      evidenceStatus: "received",
      note: "Receipt finding code altered without resigning — integrity must fail.",
    };
  }

  // valid
  return {
    claim,
    evidence: loadJsonFixture("bonk-valid-receipt.json"),
    evidenceStatus: "received",
    note: "Production BONK receipt-v1 fixture attached.",
  };
}
