/**
 * LIVE-SOLANA (Billy 1): fetch ONE fresh Raven receipt-v1 from the hosted
 * Raven API with the caller's own key, then verify it OFFLINE against the
 * repo's PINNED signer key and run Agent A's existing Day-2 policy on it.
 *
 * Boundaries (enforced in code, see LIVE-SOLANA.md):
 *  - the API key comes from the caller (CLI: RAVEN_API_KEY env only); it is
 *    sent only as the x-api-key header and never printed, logged or written;
 *  - exactly one endpoint: POST <base>/receipt/v1, where <base> is the hosted
 *    Raven origin or a loopback stub (allowlist). No /pubkey, no liquidity,
 *    no Solana RPC, no signing, no SOL spent;
 *  - default budget of DEFAULT_CALL_BUDGET calls per run, configurable up to
 *    the hard cap MAX_HTTP_CALLS_PER_RUN and never above; per-request timeout,
 *    at most one retry (only on timeout / network error / HTTP 5xx);
 *  - trust comes from the pinned key in vendor/raven-receipt-verifier, never
 *    from a key fetched at run time.
 *
 * This file contains no signer and no private key. Test-only signing lives in
 * live/test/testOnlySigner.js and is never imported from here.
 *
 * Credit: endpoint allowlist idea, token-program allowlist, rules-status gate
 * and "no redirects / body cap" limits follow Billy 2's dropped Feature-3
 * draft (branch billy2/archive-f3-dropped-20261011, 1e7a51f).
 */
import { createHash, createPublicKey, verify as ed25519Verify } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createClaimMessage, createEvidenceResponse } from "../src/lib/protocol.js";
import { applyDecisionPolicy, createEvidenceRequest } from "../src/lib/agentA.js";
import { BONK_SUBJECT, ravenVerifyEvidenceResponse } from "../src/lib/ravenVerify.js";
import {
  RAVEN_PRODUCTION_TRUST_ANCHOR,
  RECEIPT_BODY_FIELDS,
  RECEIPT_DOMAIN,
  RECEIPT_ID_PREFIX,
  RECEIPT_VERSION,
  canonicalJson,
  evaluateReceiptRules,
} from "../../../vendor/raven-receipt-verifier/packages/verify-js/src/index.ts";
import { isCanonicalSolanaAddress } from "../../../vendor/raven-receipt-verifier/packages/verify-js/src/solanaAddress.ts";

/** Hosted Raven API base, as published in apps/raven-site/agents.json and ravenattest.com. */
export const DEFAULT_API_BASE = "https://raven-hosted-verifier.onrender.com";
export const RECEIPT_PATH = "/receipt/v1";
/** Hard cap: no run may ever make more HTTP calls than this. */
export const MAX_HTTP_CALLS_PER_RUN = 20;
/** Default per-run budget (a normal run uses 1; 2 with the single retry). */
export const DEFAULT_CALL_BUDGET = 3;
export const MAX_RETRIES = 1;
export const DEFAULT_TIMEOUT_MS = 20_000;
export const MIN_TIMEOUT_MS = 100;
export const MAX_TIMEOUT_MS = 60_000;
export const MAX_RESPONSE_BYTES = 256 * 1024;
/** Freshness bound: receipt age must be <= min(this, receipt.maxAgeSeconds). */
export const FRESHNESS_MAX_AGE_SECONDS = 300;
/** A receipt issued further than this in the future (clock skew) is refused. */
export const FRESHNESS_MAX_FUTURE_SKEW_SECONDS = 60;
export const MIN_API_KEY_LENGTH = 8;
export const MAX_API_KEY_LENGTH = 512;
export const SOLANA_MAINNET = "solana-mainnet";
export const SPL_TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const ALLOWED_TOKEN_PROGRAMS = Object.freeze([SPL_TOKEN_PROGRAM, TOKEN_2022_PROGRAM]);
export const DEFAULT_SUBJECT = Object.freeze({ ...BONK_SUBJECT });
export const DEFAULT_REPORT_DIR = fileURLToPath(new URL("./runs/", import.meta.url));
export const LIVE_SOURCE_MODE = "live_hosted_api";

/** Signer cross-check published on ravenattest.com (product.html#verify). */
export const PUBLISHED_SIGNER_CROSS_CHECK = Object.freeze({
  keyId: "rvk_c2997e90215279c2",
  publicKeyBase64: "MCowBQYDK2VwAyEASGJt4Ilx2Z6g0BVC1VQIfaUcV0nr8WB1J45/8vfje6w=",
});

export class LiveError extends Error {
  /**
   * @param {string} code machine reason, e.g. "http_401"
   * @param {"config"|"http"|"cap"|"internal"} kind
   * @param {string} message human text; must never contain the key
   * @param {Record<string, unknown>} [extra]
   */
  constructor(code, kind, message, extra = {}) {
    super(message);
    this.name = "LiveError";
    this.code = code;
    this.kind = kind;
    Object.assign(this, extra);
  }
}

/* ------------------------------------------------------------------ keys */

/** keyId = "rvk_" + first 16 hex of sha256 over the base64 SPKI string. */
export function keyIdFor(publicKeyBase64) {
  return "rvk_" + createHash("sha256").update(publicKeyBase64, "utf8").digest("hex").slice(0, 16);
}

/**
 * The pinned signer: the repo verifier's production trust anchor, required to
 * equal the published cross-check. Fail closed on any drift.
 */
export function pinnedSigner() {
  const anchor = RAVEN_PRODUCTION_TRUST_ANCHOR.find(
    (k) => k.publicKeyBase64 === PUBLISHED_SIGNER_CROSS_CHECK.publicKeyBase64,
  );
  if (
    !anchor ||
    anchor.keyId !== PUBLISHED_SIGNER_CROSS_CHECK.keyId ||
    keyIdFor(anchor.publicKeyBase64) !== anchor.keyId
  ) {
    throw new LiveError("pinned_key_drift", "internal",
      "The repo's pinned Raven signer key does not match the published cross-check; refusing.");
  }
  return Object.freeze({ keyId: anchor.keyId, publicKeyBase64: anchor.publicKeyBase64 });
}

/* --------------------------------------------------------------- budget */

/**
 * Validate a per-run call budget: an integer 1..MAX_HTTP_CALLS_PER_RUN.
 * Anything above the hard cap (or malformed) is REFUSED, never clamped.
 */
export function validateMaxCalls(raw) {
  if (raw === undefined || raw === null || raw === "") return DEFAULT_CALL_BUDGET;
  const n = typeof raw === "number" ? raw : (/^[0-9]+$/.test(String(raw)) ? Number(raw) : Number.NaN);
  if (!Number.isSafeInteger(n) || n < 1 || n > MAX_HTTP_CALLS_PER_RUN) {
    throw new LiveError("call_budget_out_of_range", "config",
      `--max-calls must be an integer from 1 to ${MAX_HTTP_CALLS_PER_RUN} (hard cap); nothing was sent.`);
  }
  return n;
}

/** Budgets made by createCallBudget (module-private brand; see isAuthenticCallBudget). */
const AUTHENTIC_BUDGETS = new WeakSet();

/**
 * Per-run HTTP call counter. Default DEFAULT_CALL_BUDGET; may be set up to
 * the hard cap MAX_HTTP_CALLS_PER_RUN, never above (throws). take() throws
 * BEFORE a call would exceed it.
 */
export function createCallBudget(limit = DEFAULT_CALL_BUDGET) {
  const max = validateMaxCalls(limit);
  let used = 0;
  const budget = Object.freeze({
    get max() { return max; },
    get used() { return used; },
    take() {
      if (used >= max) {
        throw new LiveError("call_cap_exceeded", "cap",
          `HTTP call budget reached (${max} per run; hard cap ${MAX_HTTP_CALLS_PER_RUN}); no further calls made.`);
      }
      used += 1;
      return used;
    },
  });
  AUTHENTIC_BUDGETS.add(budget);
  return budget;
}

/*
 * Billy 2 integration fix for CODEX review 755269e4 F-2: a caller-supplied
 * budget is accepted only if createCallBudget made it (module-private brand),
 * so its max is 1..MAX_HTTP_CALLS_PER_RUN and take() is the real counter.
 * Lookalike objects ({max, used, take}) are refused before any request.
 */
/** True only for budgets created by createCallBudget in this module. */
export function isAuthenticCallBudget(budget) {
  return typeof budget === "object" && budget !== null && AUTHENTIC_BUDGETS.has(budget);
}

/** LiveError for a budget that did not come from createCallBudget. */
export function forgedBudgetError() {
  return new LiveError("call_budget_not_authentic", "config",
    `A call budget must come from createCallBudget (hard cap ${MAX_HTTP_CALLS_PER_RUN}); nothing was sent.`);
}

/* ------------------------------------------------------------ redaction */

/** Replace every occurrence of each secret with [REDACTED]. */
export function redact(text, secrets = []) {
  let out = String(text);
  for (const s of secrets) {
    if (typeof s === "string" && s.length > 0) out = out.split(s).join("[REDACTED]");
  }
  return out;
}

export function secretsFor(apiKey) {
  if (typeof apiKey !== "string" || apiKey.length === 0) return [];
  const trimmed = apiKey.trim();
  return [...new Set([apiKey, trimmed].filter((s) => s.length > 0))]
    .sort((a, b) => b.length - a.length);
}

/* ----------------------------------------------------------- validation */

export function validateApiKey(raw) {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new LiveError("api_key_missing", "config",
      "RAVEN_API_KEY is not set. Set it in your environment (see LIVE-SOLANA.md); nothing was sent.");
  }
  const key = raw.trim();
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x20\x7f]/.test(key) || key.length < MIN_API_KEY_LENGTH || key.length > MAX_API_KEY_LENGTH) {
    throw new LiveError("api_key_malformed", "config",
      "RAVEN_API_KEY looks malformed (length or characters). Nothing was sent; the key is not shown.");
  }
  return key;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
/** The only non-loopback origin the key may ever be sent to. */
export const ALLOWED_REMOTE_ORIGINS = Object.freeze([DEFAULT_API_BASE]);

/**
 * Base URL allowlist: exactly the hosted Raven origin (https), or plain http
 * to a loopback stub (127.0.0.1 / localhost / ::1). No credentials, path,
 * query or fragment. Anything else is refused before any request, so the key
 * is never sent. Returns { origin, loopback }.
 */
export function validateApiBase(raw) {
  const value = raw === undefined || raw === null || raw === "" ? DEFAULT_API_BASE : String(raw);
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new LiveError("api_base_invalid", "config", "RAVEN_API_BASE is not a valid URL; nothing was sent.");
  }
  if (url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    throw new LiveError("api_base_invalid", "config",
      "RAVEN_API_BASE / --api-base must be a bare origin (no credentials, path, query or fragment); nothing was sent.");
  }
  const remoteOk = ALLOWED_REMOTE_ORIGINS.includes(url.origin);
  const loopback = url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
  if (!remoteOk && !loopback) {
    throw new LiveError("api_base_not_allowlisted", "config",
      `RAVEN_API_BASE / --api-base is not allowed: only ${DEFAULT_API_BASE} or a local http://127.0.0.1 stub; nothing was sent.`);
  }
  return { origin: url.origin, loopback };
}

export function validateSubject({ mint, tokenProgram } = {}) {
  const mintAddress = mint ?? DEFAULT_SUBJECT.mintAddress;
  const tokenProgramAddress = tokenProgram ?? DEFAULT_SUBJECT.tokenProgramAddress;
  if (!isCanonicalSolanaAddress(mintAddress)) {
    throw new LiveError("mint_invalid", "config", "--mint is not a valid Solana address (base58, 32 bytes).");
  }
  if (!ALLOWED_TOKEN_PROGRAMS.includes(tokenProgramAddress)) {
    throw new LiveError("token_program_unsupported", "config",
      "--token-program must be the SPL Token program (Tokenkeg...) or Token-2022 (Tokenz...).");
  }
  return Object.freeze({ chain: SOLANA_MAINNET, mintAddress, tokenProgramAddress });
}

export function validateTimeoutMs(raw) {
  if (raw === undefined || raw === null || raw === "") return DEFAULT_TIMEOUT_MS;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isSafeInteger(n) || n < MIN_TIMEOUT_MS || n > MAX_TIMEOUT_MS) {
    throw new LiveError("timeout_invalid", "config",
      `--timeout-ms must be an integer between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS}.`);
  }
  return n;
}

/* ----------------------------------------------------------------- HTTP */

async function readBodyLimited(res, limit) {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      try { await reader.cancel(); } catch { /* ignore */ }
      throw new LiveError("response_too_large", "http", `Raven API response exceeded ${limit} bytes; discarded.`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
}

function httpStatusError(status, attempts) {
  const extra = { httpStatus: status, attempts };
  if (status === 401 || status === 403) {
    return new LiveError(`http_${status}`, "http",
      `Raven API rejected the request: HTTP ${status}. Check that RAVEN_API_KEY is your current key (the key is not shown).`, extra);
  }
  if (status === 429) {
    return new LiveError("http_429", "http", "Raven API rate limit hit (HTTP 429). Wait a minute and run again.", extra);
  }
  if (status >= 500) {
    return new LiveError(`http_${status}`, "http", `Raven API server error: HTTP ${status} after ${attempts} attempt(s).`, extra);
  }
  if (status >= 300 && status < 400) {
    return new LiveError(`http_${status}`, "http",
      `Raven API answered with a redirect (HTTP ${status}); redirects are not followed so the key cannot leak.`, extra);
  }
  return new LiveError(`http_${status}`, "http",
    `Raven API did not issue a receipt: HTTP ${status}. (Raven refuses rather than guess when evidence cannot be established.)`, extra);
}

/**
 * POST <apiBase>/receipt/v1, retrying at most MAX_RETRIES times on a
 * timeout, network error or 5xx. Every attempt goes through budget.take().
 * Body is built from an allowlist: only mintAddress and tokenProgramAddress.
 */
export async function requestReceipt({ apiBase, apiKey, subject, timeoutMs, budget, fetchImpl }) {
  const doFetch = fetchImpl ?? globalThis.fetch;
  const url = apiBase + RECEIPT_PATH;
  const body = JSON.stringify({
    mintAddress: subject.mintAddress,
    tokenProgramAddress: subject.tokenProgramAddress,
  });
  if (!isAuthenticCallBudget(budget)) throw forgedBudgetError();
  let lastError = null;
  for (let attempt = 1; attempt <= 1 + MAX_RETRIES; attempt += 1) {
    budget.take();
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    let status;
    let text;
    try {
      const res = await doFetch(url, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "content-type": "application/json",
          accept: "application/json",
        },
        body,
        redirect: "manual",
        signal: controller.signal,
      });
      status = res.status;
      text = await readBodyLimited(res, MAX_RESPONSE_BYTES);
    } catch (err) {
      if (err instanceof LiveError) throw err;
      lastError = timedOut
        ? new LiveError("http_timeout", "http",
          `Raven API did not answer within ${timeoutMs} ms (attempt ${attempt} of ${1 + MAX_RETRIES}). The hosted service may be cold-starting; try again.`,
          { attempts: attempt })
        : new LiveError("network_error", "http",
          `Could not reach the Raven API (attempt ${attempt} of ${1 + MAX_RETRIES}).`, { attempts: attempt });
      continue;
    } finally {
      clearTimeout(timer);
    }
    if (status >= 500) {
      lastError = httpStatusError(status, attempt);
      continue;
    }
    if (status !== 200) throw httpStatusError(status, attempt);
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new LiveError("response_not_json", "http", "Raven API answered HTTP 200 but the body was not JSON.",
        { httpStatus: status, attempts: attempt });
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new LiveError("response_not_receipt_object", "http",
        "Raven API answered HTTP 200 but the body was not a receipt object.", { httpStatus: status, attempts: attempt });
    }
    return { receipt: parsed, httpStatus: status, attempts: attempt };
  }
  throw lastError;
}

/* --------------------------------------------------------- verification */

const STRICT_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function evaluationDate(now) {
  const d = now instanceof Date ? new Date(now.getTime()) : new Date(now);
  if (Number.isNaN(d.getTime())) {
    throw new LiveError("evaluation_time_invalid", "internal", "Evaluation time is invalid.");
  }
  return d;
}

export const LIVE_GATE_REASONS = Object.freeze([
  ["receiptIdentity", "live_receipt_identity_mismatch"],
  ["payloadHash", "live_payload_hash_mismatch"],
  ["pinnedSigner", "live_signer_not_pinned"],
  ["signatureByPinnedKey", "live_signature_invalid_for_pinned_key"],
  ["rulesSupportedValid", "live_rules_not_supported_valid"],
  ["chain", "live_chain_mismatch"],
  ["mintMatchesRequest", "live_mint_mismatch"],
  ["tokenProgramMatchesRequest", "live_token_program_mismatch"],
  ["notInFuture", "live_timestamp_in_future"],
  ["withinAgeBound", "live_receipt_stale"],
]);

/**
 * Live-only gates, computed independently of the vendor verifier and of
 * Agent A's policy (defense in depth). Each check is reported separately.
 * `pinnedPublicKeyBase64` defaults to the production pin; only tests pass a
 * different one, and verifyLiveReceipt() / the hooks never forward it.
 */
export function evaluateLiveGates({ receipt, subject, now, pinnedPublicKeyBase64 }) {
  const pin = pinnedPublicKeyBase64 ?? pinnedSigner().publicKeyBase64;
  const nowMs = evaluationDate(now).getTime();
  const r = isPlainObject(receipt) ? receipt : {};
  const checks = {};

  checks.receiptIdentity =
    typeof r.payloadHash === "string" &&
    /^sha256:[0-9a-f]{64}$/.test(r.payloadHash) &&
    r.receiptId === RECEIPT_ID_PREFIX + r.payloadHash;

  try {
    const body = {};
    for (const f of RECEIPT_BODY_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(r, f)) throw new Error("missing");
      body[f] = r[f];
    }
    const recomputed = "sha256:" + createHash("sha256").update(canonicalJson(body), "utf8").digest("hex");
    checks.payloadHash = recomputed === r.payloadHash;
  } catch {
    checks.payloadHash = false;
  }

  checks.pinnedSigner = r.signerPublicKey === pin;

  try {
    if (typeof r.signature !== "string" || !STRICT_BASE64.test(r.signature)) throw new Error("sig");
    const signed = canonicalJson({ domain: RECEIPT_DOMAIN, version: RECEIPT_VERSION, payloadHash: r.payloadHash });
    const key = createPublicKey({ key: Buffer.from(pin, "base64"), format: "der", type: "spki" });
    checks.signatureByPinnedKey = ed25519Verify(null, Buffer.from(signed, "utf8"), key, Buffer.from(r.signature, "base64"));
  } catch {
    checks.signatureByPinnedKey = false;
  }

  let rules = { rulesVersion: null, rulesStatus: null };
  try {
    // Rules conformance is its own axis: evaluated on the content as if core
    // integrity held, so it never masks / duplicates the signature checks.
    rules = evaluateReceiptRules(r, true);
  } catch { /* stays null */ }
  checks.rulesSupportedValid = rules.rulesStatus === "supported_valid";

  checks.chain = r.chain === SOLANA_MAINNET;
  checks.mintMatchesRequest = r.mintAddress === subject?.mintAddress;
  checks.tokenProgramMatchesRequest = r.tokenProgramAddress === subject?.tokenProgramAddress;

  const issuedMs = typeof r.timestamp === "string" ? Date.parse(r.timestamp) : Number.NaN;
  const ageSeconds = Number.isFinite(issuedMs) ? (nowMs - issuedMs) / 1000 : null;
  const receiptMaxAge = Number.isSafeInteger(r.maxAgeSeconds) && r.maxAgeSeconds > 0 ? r.maxAgeSeconds : null;
  const boundSeconds = receiptMaxAge === null ? null : Math.min(FRESHNESS_MAX_AGE_SECONDS, receiptMaxAge);
  checks.notInFuture = ageSeconds !== null && ageSeconds >= -FRESHNESS_MAX_FUTURE_SKEW_SECONDS;
  checks.withinAgeBound = ageSeconds !== null && boundSeconds !== null && ageSeconds <= boundSeconds;

  const failed = LIVE_GATE_REASONS.filter(([k]) => checks[k] !== true).map(([, reason]) => reason);
  return {
    ok: failed.length === 0,
    checks,
    failed,
    rules: { rulesVersion: rules.rulesVersion ?? null, rulesStatus: rules.rulesStatus ?? null },
    freshness: {
      timestamp: typeof r.timestamp === "string" ? r.timestamp : null,
      evaluationTime: new Date(nowMs).toISOString(),
      ageSeconds,
      boundSeconds,
      boundRule: `age <= min(${FRESHNESS_MAX_AGE_SECONDS}s, receipt.maxAgeSeconds) and not more than ${FRESHNESS_MAX_FUTURE_SKEW_SECONDS}s in the future`,
      slot: Number.isSafeInteger(r.slot) ? r.slot : null,
      slotAgeChecked: false,
      slotNote: "Observed slot is reported, not compared to the chain tip (no Solana RPC is called).",
    },
  };
}

/**
 * Wall-clock verification in the exact evidence.verification shape that
 * Agent A's applyDecisionPolicy consumes: the repo's pinned verifier
 * (ravenVerifyEvidenceResponse at `now`) AND the live gates. If any live gate
 * fails, the result is VERIFICATION_FAILED with that gate's reason.
 * Usable directly as Billy 2's createAgentA({ verifyEvidence }).
 */
export async function verifyLiveEvidenceResponse({ evidenceRequest, evidenceResponse, now }) {
  const evaluation = evaluationDate(now ?? new Date());
  const base = await ravenVerifyEvidenceResponse({
    evidenceRequest,
    evidenceResponse,
    now: evaluation.toISOString(),
  });
  const subject = evidenceRequest?.requirements?.subject ?? null;
  const supplied = evidenceResponse?.status === "supplied" && evidenceResponse?.evidence != null;
  const liveGates = supplied ? evaluateLiveGates({ receipt: evidenceResponse.evidence, subject, now: evaluation }) : null;
  const source = evidenceResponse?.source ?? null;
  const disclosure = {
    ...(base.result.disclosure ?? {}),
    liveAcquisition: source?.mode === LIVE_SOURCE_MODE && source?.liveAcquisition === true && source?.loopbackStub !== true,
    evaluationTime: evaluation.toISOString(),
    evaluationTimeKind: "wall_clock",
    evaluationTimeLabel: "Real wall-clock time at verification (live receipt)",
    pinnedSigner: pinnedSigner().keyId,
    liveGates,
  };
  const gatesOk = liveGates?.ok === true;
  const verified = base.result.verified === true && gatesOk;
  let reason = base.result.reason;
  if (base.result.verified === true && !gatesOk) reason = liveGates ? liveGates.failed[0] : "missing_evidence";
  return {
    ...base,
    verifier: "raven-receipt-v1-offline+live-gates",
    result: {
      ...base.result,
      verified,
      state: verified ? "VERIFIED" : "VERIFICATION_FAILED",
      reason: verified ? "verified" : reason,
      disclosure,
    },
  };
}

/**
 * Verify one receipt for the requested subject at `now` by running the full
 * Agent A exchange: claim -> evidence.request -> evidence.response ->
 * verifyLiveEvidenceResponse -> applyDecisionPolicy (unchanged Day-2 policy).
 */
export async function verifyLiveReceipt({ receipt, subject, now, loopbackStub = false }) {
  const evaluation = evaluationDate(now ?? new Date());
  const claimMessage = createClaimMessage({
    claimId: `live-solana:${subject.mintAddress}`,
    chain: subject.chain,
    mintAddress: subject.mintAddress,
    tokenProgramAddress: subject.tokenProgramAddress,
    property: "Has a fresh, valid Raven receipt-v1 from the hosted Raven API, signed by the pinned key.",
    summary: "Live claim: this mint under this token program has a fresh Raven receipt.",
  });
  const evidenceRequest = createEvidenceRequest(claimMessage);
  const evidenceResponse = createEvidenceResponse(evidenceRequest, receipt, {
    source: { mode: LIVE_SOURCE_MODE, fixture: null, liveAcquisition: loopbackStub !== true, loopbackStub: loopbackStub === true },
  });
  const verificationResponse = await verifyLiveEvidenceResponse({ evidenceRequest, evidenceResponse, now: evaluation });
  const agentA = applyDecisionPolicy({ claimMessage, evidenceRequest, verificationResponse });
  const liveGates = verificationResponse.result.disclosure.liveGates
    ?? evaluateLiveGates({ receipt, subject, now: evaluation });
  const decision = agentA.decision === "PROCEED" && liveGates.ok ? "PROCEED" : "REFUSE";
  return {
    decision,
    reason: decision === "PROCEED" ? "verified" : (agentA.reason === "verified" ? liveGates.failed[0] : agentA.reason),
    ravenState: decision === "PROCEED" ? "VERIFIED" : "VERIFICATION_FAILED",
    evaluationTime: evaluation.toISOString(),
    agentA: { decision: agentA.decision, reason: agentA.reason, axes: agentA.axes },
    liveGates,
  };
}

/** Local one-field tamper (no re-signing): observed slot + 1. */
export function tamperOneField(receipt) {
  const copy = structuredClone(receipt);
  const from = isPlainObject(copy) && Number.isSafeInteger(copy.slot) ? copy.slot : 0;
  if (isPlainObject(copy)) copy.slot = from + 1;
  return { receipt: copy, field: "slot", from, to: from + 1 };
}

/* --------------------------------------------------------------- report */

function receiptSummary(receipt) {
  if (!isPlainObject(receipt)) return null;
  const pin = pinnedSigner();
  return {
    receiptId: typeof receipt.receiptId === "string" ? receipt.receiptId : null,
    payloadHash: typeof receipt.payloadHash === "string" ? receipt.payloadHash : null,
    mintAddress: typeof receipt.mintAddress === "string" ? receipt.mintAddress : null,
    tokenProgramAddress: typeof receipt.tokenProgramAddress === "string" ? receipt.tokenProgramAddress : null,
    slot: Number.isSafeInteger(receipt.slot) ? receipt.slot : null,
    timestamp: typeof receipt.timestamp === "string" ? receipt.timestamp : null,
    maxAgeSeconds: Number.isSafeInteger(receipt.maxAgeSeconds) ? receipt.maxAgeSeconds : null,
    rulesVersion: typeof receipt.rulesVersion === "string" ? receipt.rulesVersion : null,
    signerKeyId: receipt.signerPublicKey === pin.publicKeyBase64 ? pin.keyId : "not-the-pinned-key",
  };
}

function buildReport({ startedAt, finishedAt, apiBase, loopback, subject, receipt, verification, tamperControl,
  decision, reason, error, budget, timeoutMs, httpStatus }) {
  return {
    reportType: "raven-agent-trust-live-solana-run",
    reportVersion: 1,
    unsigned: true,
    notice: "Unsigned local run report. Not a receipt, not a signature, not an authorization to act.",
    startedAt,
    finishedAt,
    api: { base: apiBase, path: RECEIPT_PATH, loopbackStub: loopback === true },
    request: subject ? { ...subject } : null,
    receipt: receiptSummary(receipt),
    verification: verification
      ? {
        result: verification.ravenState,
        reason: verification.reason,
        evaluationTime: verification.evaluationTime,
        agentA: verification.agentA,
        liveGates: verification.liveGates,
        pinnedSigner: pinnedSigner().keyId,
      }
      : null,
    decision,
    reason,
    tamperControl,
    error: error ? { code: error.code, kind: error.kind } : null,
    http: {
      calls: budget.used,
      cap: budget.max,
      hardCap: MAX_HTTP_CALLS_PER_RUN,
      maxRetries: MAX_RETRIES,
      timeoutMs,
      finalStatus: httpStatus ?? null,
    },
    runtime: { node: process.version },
  };
}

/**
 * Write the report as JSON (mode 0600) into `dir` (default live/runs/, which
 * is gitignored). The serialized text is redacted against the key first.
 */
export function writeRunReport(report, { dir = DEFAULT_REPORT_DIR, apiKey } = {}) {
  mkdirSync(dir, { recursive: true });
  const stamp = String(report.startedAt ?? new Date().toISOString()).replace(/[:.]/g, "-");
  const file = path.join(dir, `live-solana-${stamp}-${process.pid}.json`);
  const text = redact(JSON.stringify(report, null, 2) + "\n", secretsFor(apiKey));
  writeFileSync(file, text, { mode: 0o600, flag: "wx" });
  return file;
}

/* ------------------------------------------------------------ main API */

/** Validate everything that must hold before any network call. */
export function prepareLiveConfig(opts = {}) {
  const apiKey = validateApiKey(opts.apiKey);
  const { origin: apiBase, loopback } = validateApiBase(opts.apiBase);
  const subject = validateSubject({ mint: opts.mint, tokenProgram: opts.tokenProgram });
  const timeoutMs = validateTimeoutMs(opts.timeoutMs);
  const maxCalls = validateMaxCalls(opts.maxCalls);
  pinnedSigner();
  return { apiKey, apiBase, loopback, subject, timeoutMs, maxCalls };
}

/**
 * Integration entrypoint (also used by the CLI).
 *
 * @param {object} opts
 * @param {string} [opts.apiBase]  default DEFAULT_API_BASE
 * @param {string} opts.apiKey     caller's key; never returned or logged
 * @param {string} [opts.mint]     default BONK fixture mint
 * @param {string} [opts.tokenProgram] default fixture token program
 * @param {number|string} [opts.timeoutMs]
 * @param {number|string} [opts.maxCalls] per-run budget, default 3, 1..20 (hard cap)
 * @param {() => Date} [opts.clock] evaluation clock (default wall clock)
 * @param {typeof fetch} [opts.fetchImpl]
 * @param {ReturnType<typeof createCallBudget>} [opts.budget] share a cap across calls; must come from
 *   createCallBudget, anything else is refused (call_budget_not_authentic) before any call
 * @returns {Promise<{ok:boolean, decision:"PROCEED"|"REFUSE", reason:string,
 *   receipt:object|null, verification:object|null, tamperControl:object|null,
 *   report:object|null, error:{code:string,kind:string,message:string}|null, httpCalls:number}>}
 */
export async function fetchAndVerifyLiveReceipt(opts = {}) {
  const clock = typeof opts.clock === "function" ? opts.clock : () => new Date();
  let budget = opts.budget ?? null;
  const secrets = secretsFor(opts.apiKey);
  const startedAt = clock().toISOString();
  const fail = (err, extra = {}) => ({
    ok: false,
    decision: "REFUSE",
    reason: err.code,
    receipt: null,
    verification: null,
    tamperControl: null,
    report: null,
    error: { code: err.code, kind: err.kind, message: redact(err.message, secrets) },
    httpCalls: budget ? budget.used : 0,
    ...extra,
  });

  if (budget !== null && !isAuthenticCallBudget(budget)) {
    budget = null;
    return fail(forgedBudgetError());
  }

  let cfg;
  try {
    cfg = prepareLiveConfig(opts);
  } catch (err) {
    if (err instanceof LiveError) return fail(err);
    return fail(new LiveError("internal_error", "internal", "Unexpected error during setup."));
  }
  const { apiKey, apiBase, loopback, subject, timeoutMs } = cfg;
  if (!budget) budget = createCallBudget(cfg.maxCalls);

  let fetched;
  try {
    fetched = await requestReceipt({ apiBase, apiKey, subject, timeoutMs, budget, fetchImpl: opts.fetchImpl });
  } catch (err) {
    const e = err instanceof LiveError ? err : new LiveError("internal_error", "internal", "Unexpected HTTP error.");
    const report = buildReport({
      startedAt, finishedAt: clock().toISOString(), apiBase, loopback, subject, receipt: null, verification: null,
      tamperControl: null, decision: "REFUSE", reason: e.code, error: e, budget, timeoutMs, httpStatus: e.httpStatus,
    });
    return fail(e, { report });
  }

  const verification = await verifyLiveReceipt({ receipt: fetched.receipt, subject, now: clock(), loopbackStub: loopback });
  const tampered = tamperOneField(fetched.receipt);
  const tamperVerification = await verifyLiveReceipt({ receipt: tampered.receipt, subject, now: clock(), loopbackStub: loopback });
  const tamperControl = {
    field: tampered.field,
    from: tampered.from,
    to: tampered.to,
    decision: tamperVerification.decision,
    reason: tamperVerification.reason,
  };
  const report = buildReport({
    startedAt, finishedAt: clock().toISOString(), apiBase, loopback, subject, receipt: fetched.receipt, verification,
    tamperControl, decision: verification.decision, reason: verification.reason, error: null, budget, timeoutMs,
    httpStatus: fetched.httpStatus,
  });
  return {
    ok: verification.decision === "PROCEED" && tamperControl.decision === "REFUSE",
    decision: verification.decision,
    reason: verification.reason,
    receipt: fetched.receipt,
    verification,
    tamperControl,
    report,
    error: null,
    httpCalls: budget.used,
  };
}
