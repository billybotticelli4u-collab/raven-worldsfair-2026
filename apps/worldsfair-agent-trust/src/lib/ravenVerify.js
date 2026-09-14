/**
 * Raven independent verification for Fair Day-2.
 * Consumes public raven-receipt-verifier submodule — no toy verifier.
 *
 * PRE-EXISTING RAVEN FOUNDATION — NOT CRYPTO WORLD'S FAIR WORK
 * Linked from public billybotticelli4u-collab/raven-receipt-verifier
 * pinned commit 1b04356a275742752fb7afd8dfcc4269d462a778
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  PROTOCOL_VERSION,
  isProtocolMessage,
  messageId,
} from "./protocol.js";

// PRE-EXISTING RAVEN FOUNDATION — NOT CRYPTO WORLD'S FAIR WORK
// Linked from public billybotticelli4u-collab/raven-receipt-verifier@1b04356a275742752fb7afd8dfcc4269d462a778
const VERIFY_JS_ENTRY = fileURLToPath(
  new URL(
    "../../../../vendor/raven-receipt-verifier/packages/verify-js/src/index.ts",
    import.meta.url,
  ),
);

/** @type {Record<string, unknown> | null} */
let cached = null;

async function loadVerifier() {
  if (cached) return cached;
  cached = await import(VERIFY_JS_ENTRY);
  return cached;
}

/**
 * @typedef {object} RavenVerifyInput
 * @property {unknown} receipt
 * @property {{ chain: "solana-mainnet"; mintAddress: string; tokenProgramAddress: string }} expectedSubject
 * @property {Date | string | number} [now]
 */

/**
 * @param {RavenVerifyInput} input
 */
export async function ravenVerifyReceiptForSubject(input) {
  const {
    verifyReceiptV1ForSubject,
    ravenProductionTrustedKeys,
  } = await loadVerifier();

  const trustedKeys = ravenProductionTrustedKeys();
  const options = {
    trustedKeys,
  };
  if (input.now !== undefined) {
    options.now = input.now instanceof Date ? input.now : new Date(input.now);
  }

  const result = verifyReceiptV1ForSubject(
    input.receipt,
    input.expectedSubject,
    options,
  );

  const integrityOk = result.valid === true;
  const trustOk = result.keyTrusted === true;
  const subjectOk = result.subjectMatches === true;
  const notStale = result.stale !== true;
  const verified = integrityOk && trustOk && subjectOk && notStale;

  return {
    verified,
    state: verified ? "VERIFIED" : "VERIFICATION_FAILED",
    axes: {
      valid: result.valid,
      keyTrusted: result.keyTrusted,
      stale: result.stale,
      subjectMatches: result.subjectMatches,
      reasons: result.reasons ?? [],
      subjectReasons: result.subjectReasons ?? [],
    },
    evidenceIdentity: summarizeEvidenceIdentity(input.receipt),
  };
}

/**
 * Raven's machine boundary. The response reports verification facts and never
 * a downstream PROCEED / REFUSE verdict.
 */
export async function ravenVerifyEvidenceResponse({
  evidenceRequest,
  evidenceResponse,
  forceVerifierException = false,
  now = BONK_FIXTURE_NOW,
}) {
  const claimId = typeof evidenceRequest?.claimId === "string"
    ? evidenceRequest.claimId
    : "invalid";
  const base = {
    protocolVersion: PROTOCOL_VERSION,
    type: "evidence.verification",
    messageId: messageId("verification", claimId),
    from: "raven",
    to: "agent-a",
    replyTo: evidenceResponse?.messageId ?? null,
    requestId: evidenceRequest?.messageId ?? null,
    claimId,
    subject: evidenceRequest?.requirements?.subject ?? null,
    verifier: "raven-receipt-v1-offline",
  };

  const parsedNow = parseEvaluationTime(now);
  if (!parsedNow.ok) {
    return failedVerification(base, "invalid_evaluation_time", {
      evaluationTime: null,
      evidenceSource: evidenceResponse?.source ?? null,
    });
  }
  const evaluationTime = parsedNow.iso;

  if (
    !isProtocolMessage(evidenceRequest, "evidence.request") ||
    !isProtocolMessage(evidenceResponse, "evidence.response") ||
    evidenceResponse.replyTo !== evidenceRequest.messageId ||
    evidenceResponse.claimId !== evidenceRequest.claimId
  ) {
    return failedVerification(base, "invalid_evidence_response", {
      evaluationTime,
      evidenceSource: evidenceResponse?.source ?? null,
    });
  }

  if (evidenceResponse.status !== "supplied" || evidenceResponse.evidence == null) {
    return failedVerification(
      base,
      forceVerifierException ? "verifier_exception" : "missing_evidence",
      {
        evaluationTime,
        evidenceSource: evidenceResponse.source ?? null,
      },
    );
  }

  try {
    if (forceVerifierException) {
      throw new Error("controlled_verifier_exception");
    }
    const verified = await ravenVerifyReceiptForSubject({
      receipt: evidenceResponse.evidence,
      expectedSubject: evidenceRequest.requirements.subject,
      now: evaluationTime,
    });
    return {
      ...base,
      result: {
        verified: verified.verified,
        state: verified.state,
        reason: verified.verified ? "verified" : classifyFailure(verified.axes),
        axes: verified.axes,
        evidenceIdentity: verified.evidenceIdentity,
        disclosure: buildVerificationDisclosure({
          evaluationTime,
          evidenceSource: evidenceResponse.source ?? null,
        }),
      },
    };
  } catch {
    return failedVerification(base, "verifier_exception", {
      evaluationTime,
      evidenceSource: evidenceResponse?.source ?? null,
    });
  }
}

function failedVerification(base, reason, disclosureExtras = {}) {
  const evaluationTime = Object.prototype.hasOwnProperty.call(
    disclosureExtras,
    "evaluationTime",
  )
    ? disclosureExtras.evaluationTime
    : BONK_FIXTURE_NOW;
  return {
    ...base,
    result: {
      verified: false,
      state: "VERIFICATION_FAILED",
      reason,
      axes: null,
      evidenceIdentity: null,
      disclosure: buildVerificationDisclosure({
        evaluationTime,
        evidenceSource: disclosureExtras.evidenceSource ?? null,
      }),
    },
  };
}

/**
 * Validate evaluation time separately from disclosure formatting.
 * Fail closed on empty / null / malformed / unusable input — never substitute
 * BONK_FIXTURE_NOW (callers must supply a valid instant; the Day-2 default
 * parameter supplies BONK_FIXTURE_NOW only when `now` is omitted).
 * Normalize to ISO-8601 only AFTER validity is established.
 * @param {Date | string | number | null | undefined} value
 * @returns {{ ok: true, iso: string } | { ok: false }}
 */
function parseEvaluationTime(value) {
  if (value === undefined || value === null || value === "") {
    return { ok: false };
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return { ok: false };
    return { ok: true, iso: value.toISOString() };
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return { ok: false };
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return { ok: false };
    return { ok: true, iso: d.toISOString() };
  }
  if (typeof value === "string") {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return { ok: false };
    return { ok: true, iso: d.toISOString() };
  }
  return { ok: false };
}

/**
 * Machine-readable truth disclosure for judges / Agent A consumers.
 * Does not change verify/policy semantics — facts only.
 */
function buildVerificationDisclosure({ evaluationTime, evidenceSource }) {
  const source = evidenceSource && typeof evidenceSource === "object"
    ? {
        mode: evidenceSource.mode ?? null,
        fixture: evidenceSource.fixture ?? null,
        liveAcquisition: evidenceSource.liveAcquisition === true,
      }
    : {
        mode: null,
        fixture: null,
        liveAcquisition: false,
      };

  return {
    liveAcquisition: false,
    evidenceSource: source,
    evaluationTime,
    evaluationTimeKind: "deterministic_fixture_demo_time",
    evaluationTimeLabel:
      "Deterministic fixture/demo evaluation time — not wall clock; not current Solana freshness",
  };
}

function classifyFailure(axes) {
  if (!axes) return "verification_failed";
  if (axes.valid === false) return "integrity_or_malformed";
  if (axes.keyTrusted === false) return "untrusted_key";
  if (axes.stale === true) return "stale";
  if (axes.subjectMatches === false) return "subject_mismatch";
  if (axes.subjectMatches == null) return "subject_unavailable_or_invalid";
  return "verification_failed";
}

function summarizeEvidenceIdentity(receipt) {
  if (!receipt || typeof receipt !== "object") {
    return { receiptId: null, mintAddress: null, signerPublicKey: null, slot: null };
  }
  const r = /** @type {Record<string, unknown>} */ (receipt);
  return {
    receiptId: typeof r.receiptId === "string" ? r.receiptId : null,
    mintAddress: typeof r.mintAddress === "string" ? r.mintAddress : null,
    tokenProgramAddress:
      typeof r.tokenProgramAddress === "string" ? r.tokenProgramAddress : null,
    signerPublicKey:
      typeof r.signerPublicKey === "string" ? r.signerPublicKey : null,
    slot: typeof r.slot === "number" ? r.slot : null,
    timestamp: typeof r.timestamp === "string" ? r.timestamp : null,
  };
}

export function loadJsonFixture(name) {
  const p = path.join(
    fileURLToPath(new URL("../../fixtures/", import.meta.url)),
    name,
  );
  return JSON.parse(readFileSync(p, "utf8"));
}

/** Measurement time near BONK capture so freshness axis is not falsely stale. */
export const BONK_FIXTURE_NOW = "2026-06-26T11:46:31.000Z";

export const BONK_SUBJECT = {
  chain: /** @type {"solana-mainnet"} */ ("solana-mainnet"),
  mintAddress: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
  tokenProgramAddress: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
};
