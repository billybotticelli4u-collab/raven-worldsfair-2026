/**
 * Orchestrates PATH A (verified) and PATH B (refused) vertical slices.
 */
import { agentBSupplyEvidence } from "./agentB.js";
import { agentADecide } from "./agentA.js";

/**
 * @param {"path_a_verified" | "path_b_tampered" | "path_b_wrong_subject" | "path_b_missing" | "path_b_exception"} path
 */
export async function runVerticalSlice(path) {
  const modeByPath = {
    path_a_verified: "valid",
    path_b_tampered: "tampered",
    path_b_wrong_subject: "wrong_subject",
    path_b_missing: "missing",
    path_b_exception: "throw",
  };
  const mode = modeByPath[path];
  if (!mode) {
    throw new Error(`unknown_path:${path}`);
  }

  const fromB = agentBSupplyEvidence(mode);
  const fromA = await agentADecide({
    claim: fromB.claim,
    evidence: fromB.evidence,
    forceVerifierException: fromB.forceVerifierException === true,
  });

  return {
    path,
    agentB: {
      note: fromB.note,
      evidenceStatus: fromB.evidenceStatus,
      claim: fromB.claim,
    },
    agentA: fromA,
    outcome: fromA.decision,
  };
}

export async function runDemoBundle() {
  const paths = [
    "path_a_verified",
    "path_b_tampered",
    "path_b_wrong_subject",
    "path_b_missing",
    "path_b_exception",
  ];
  const results = [];
  for (const p of paths) {
    results.push(await runVerticalSlice(p));
  }
  return results;
}
