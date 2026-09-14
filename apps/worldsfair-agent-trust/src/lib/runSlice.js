/** Orchestrates a deterministic Agent A -> Agent B -> Raven exchange. */
import {
  agentBHandleEvidenceRequest,
  agentBMakeClaimMessage,
} from "./agentB.js";
import {
  applyDecisionPolicy,
  createEvidenceRequest,
} from "./agentA.js";
import {
  BONK_FIXTURE_NOW,
  ravenVerifyEvidenceResponse,
} from "./ravenVerify.js";
import { PROTOCOL_VERSION } from "./protocol.js";

export { PROTOCOL_VERSION };

const MODE_BY_PATH = {
  path_a_verified: "valid",
  path_b_tampered: "tampered",
  path_b_wrong_subject: "wrong_subject",
  path_b_missing: "missing",
  path_b_exception: "throw",
};

export async function runMachineExchange(path) {
  const mode = MODE_BY_PATH[path];
  if (!mode) throw new Error(`unknown_path:${path}`);

  const claimMessage = agentBMakeClaimMessage(mode);
  const evidenceRequest = createEvidenceRequest(claimMessage);
  const fromB = agentBHandleEvidenceRequest(evidenceRequest, mode);
  const verificationResponse = await ravenVerifyEvidenceResponse({
    evidenceRequest,
    evidenceResponse: fromB.evidenceResponse,
    forceVerifierException: fromB.forceVerifierException,
    now: BONK_FIXTURE_NOW,
  });
  const fromA = applyDecisionPolicy({
    claimMessage,
    evidenceRequest,
    verificationResponse,
  });

  return {
    protocolVersion: PROTOCOL_VERSION,
    path,
    exchange: [
      claimMessage,
      evidenceRequest,
      fromB.evidenceResponse,
      verificationResponse,
    ],
    agentB: {
      note: fromB.note,
      evidenceStatus: fromB.evidenceResponse.status === "supplied"
        ? "received"
        : "missing",
      claim: fromA.claim,
    },
    agentA: fromA,
    outcome: fromA.decision,
  };
}

export const runVerticalSlice = runMachineExchange;

export async function runDemoBundle() {
  const results = [];
  for (const path of Object.keys(MODE_BY_PATH)) {
    results.push(await runMachineExchange(path));
  }
  return results;
}
