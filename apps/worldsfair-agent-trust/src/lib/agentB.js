/**
 * Agent B — claim machine.
 * Makes ONE Solana-grounded claim and may supply Raven receipt evidence.
 */
import {
  BONK_SUBJECT,
  loadJsonFixture,
} from "./ravenVerify.js";
import {
  createClaimMessage,
  createEvidenceResponse,
  isProtocolMessage,
} from "./protocol.js";

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

function claimForMode(mode) {
  const claim = makeBonkClaim();
  if (mode !== "wrong_subject") return claim;
  return {
    ...claim,
    mintAddress: "So11111111111111111111111111111111111111112",
    summary: "Agent B claims wSOL mint has this BONK receipt (subject mismatch).",
    claimId: "wf2026-day1-wrong-subject",
  };
}

export function agentBMakeClaimMessage(mode) {
  return createClaimMessage(claimForMode(mode));
}

/**
 * @param {"valid" | "tampered" | "wrong_subject" | "missing" | "throw"} mode
 */
export function agentBSupplyEvidence(mode) {
  const claim = claimForMode(mode);

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
    return {
      claim,
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

/**
 * Agent B's machine boundary. It accepts an evidence.request and returns a
 * correlated evidence.response; it never decides whether Agent A should act.
 *
 * @param {unknown} request
 * @param {"valid" | "tampered" | "wrong_subject" | "missing" | "throw"} mode
 */
export function agentBHandleEvidenceRequest(request, mode) {
  if (
    !isProtocolMessage(request, "evidence.request") ||
    request.from !== "agent-a" ||
    request.to !== "agent-b" ||
    typeof request.claimId !== "string"
  ) {
    throw new Error("invalid_evidence_request");
  }

  const supplied = agentBSupplyEvidence(mode);
  return {
    evidenceResponse: createEvidenceResponse(request, supplied.evidence, {
      unavailableReason:
        mode === "throw" ? "controlled_verifier_exception_probe" : "not_supplied",
      source: evidenceSourceForMode(mode),
    }),
    note: supplied.note,
    forceVerifierException: supplied.forceVerifierException === true,
  };
}

function evidenceSourceForMode(mode) {
  if (mode === "valid" || mode === "wrong_subject") {
    return {
      mode: "deterministic_fixture",
      fixture: "bonk-valid-receipt.json",
      liveAcquisition: false,
    };
  }
  if (mode === "tampered") {
    return {
      mode: "controlled_fixture",
      fixture: "bonk-tampered-receipt.json",
      liveAcquisition: false,
    };
  }
  return {
    mode: mode === "throw" ? "controlled_probe" : "none",
    fixture: null,
    liveAcquisition: false,
  };
}
