/**
 * Hooks for the live-local exchange (see ../INTERFACE.md, sections 1 and 8).
 *
 *   import { createLiveEvidenceProvider, liveVerifyEvidence } from "../live/agentHooks.js";
 *   startAgentB(config, { evidenceProvider: createLiveEvidenceProvider({ apiKey: keyFromYourEnvironment }) });
 *   createAgentA({ registryUrl, verifyEvidence: liveVerifyEvidence });
 *
 * The provider fetches a fresh receipt-v1 for the subject Agent A requested
 * (never a default subject), through the same capped / timed / redacted
 * client as `npm run demo:live-solana`. One call budget (default 3, settable
 * via maxCalls up to the hard cap 20, never above) is shared by every request
 * the provider serves. It never decides PROCEED:
 * Agent A verifies with liveVerifyEvidence (pinned key + live gates at the
 * real clock) and the unchanged Day-2 applyDecisionPolicy decides.
 */
import { createEvidenceResponse } from "../src/lib/protocol.js";
import {
  LIVE_SOURCE_MODE,
  LiveError,
  SOLANA_MAINNET,
  createCallBudget,
  forgedBudgetError,
  isAuthenticCallBudget,
  prepareLiveConfig,
  requestReceipt,
  validateSubject,
  verifyLiveEvidenceResponse,
} from "./liveSolana.js";

/** The provider only ever fetches for the subject Agent A asked for. */
function isRequestedSubject(requested) {
  return Boolean(requested && requested.chain === SOLANA_MAINNET &&
    typeof requested.mintAddress === "string" && typeof requested.tokenProgramAddress === "string");
}

/**
 * @param {{ apiKey: string, apiBase?: string, timeoutMs?: number, maxCalls?: number,
 *           budget?: ReturnType<typeof createCallBudget>, fetchImpl?: typeof fetch }} opts
 * Throws LiveError (kind "config") BEFORE any network call if the key or base is unusable.
 */
export function createLiveEvidenceProvider(opts = {}) {
  const cfg = prepareLiveConfig({
    apiKey: opts.apiKey, apiBase: opts.apiBase, timeoutMs: opts.timeoutMs, maxCalls: opts.maxCalls,
  });
  // Integration fix (review 755269e4 F-2): only a createCallBudget budget is accepted.
  if (opts.budget !== undefined && opts.budget !== null && !isAuthenticCallBudget(opts.budget)) throw forgedBudgetError();
  const budget = opts.budget ?? createCallBudget(cfg.maxCalls);
  const source = Object.freeze({
    mode: LIVE_SOURCE_MODE,
    fixture: null,
    liveAcquisition: !cfg.loopback,
    loopbackStub: cfg.loopback,
  });

  async function liveEvidenceProvider(evidenceRequest) {
    const requested = evidenceRequest?.requirements?.subject;
    if (!isRequestedSubject(requested)) {
      return createEvidenceResponse(evidenceRequest, null, { unavailableReason: "subject_invalid", source });
    }
    let subject;
    try {
      subject = validateSubject({ mint: requested?.mintAddress, tokenProgram: requested?.tokenProgramAddress });
    } catch (e) {
      return createEvidenceResponse(evidenceRequest, null, { unavailableReason: e.code ?? "subject_invalid", source });
    }
    try {
      const { receipt } = await requestReceipt({
        apiBase: cfg.apiBase, apiKey: cfg.apiKey, subject, timeoutMs: cfg.timeoutMs, budget, fetchImpl: opts.fetchImpl,
      });
      return createEvidenceResponse(evidenceRequest, receipt, { source });
    } catch (e) {
      const code = e instanceof LiveError ? e.code : "internal_error";
      return createEvidenceResponse(evidenceRequest, null, { unavailableReason: code, source });
    }
  }
  Object.defineProperty(liveEvidenceProvider, "budget", { value: budget });
  // Live-source integration: Agent B's card advertises this instead of "retained_fixture".
  Object.defineProperty(liveEvidenceProvider, "evidenceSourceLabel", {
    value: cfg.loopback ? "hosted_receipt_api_loopback_stub" : "hosted_receipt_api_live",
  });
  return liveEvidenceProvider;
}

/** createAgentA({ verifyEvidence }) hook: pinned verifier + live gates at `now`. */
export const liveVerifyEvidence = verifyLiveEvidenceResponse;
