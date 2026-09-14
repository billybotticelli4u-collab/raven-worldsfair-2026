/**
 * Raven independent verification for Fair Day-1.
 * Consumes public raven-receipt-verifier submodule — no toy verifier.
 *
 * PRE-EXISTING RAVEN FOUNDATION — NOT CRYPTO WORLD'S FAIR WORK
 * Linked from public billybotticelli4u-collab/raven-receipt-verifier
 * pinned commit 1b04356a275742752fb7afd8dfcc4269d462a778
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

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
