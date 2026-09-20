import crypto from 'node:crypto';
import fs from 'node:fs';
import { canonicalJson } from './canonicalJson.js';
import { checkReportIntegrity } from './replay.js';

export const KIND = 'raven-conformance-receipt/1';
export const DOMAIN = 'raven-conformance-receipt';
export const VERSION = '1';
export const NETWORK = 'solana-devnet';
export const KEY_ENV = 'RAVEN_CONFORMANCE_RECEIPT_KEYPAIR';
export const DISCLAIMER =
  'This conformance receipt binds a report digest only. It is not a prediction, recommendation, or declaration of safety.';

const HEX64 = /^[0-9a-f]{64}$/i;

export function sha256Hex(bytesOrString) {
  const h = crypto.createHash('sha256');
  h.update(
    typeof bytesOrString === 'string'
      ? Buffer.from(bytesOrString, 'utf8')
      : bytesOrString,
  );
  return h.digest('hex');
}

function ed25519Pkcs8FromSeed(seed32) {
  return Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'),
    seed32,
  ]);
}

export const REPORT_SCHEMA = 'raven-conformance-report/1';

/**
 * Central report validation (CODEX B1). Every issuance path (CLI, HTTP) and the
 * verifier MUST go through this before any key use. A report is accepted only if:
 *   - it is a plain object with schema raven-conformance-report/1;
 *   - its declared deterministic digest is 64 hex and appears in both top-level
 *     and binding positions;
 *   - checkReportIntegrity() recomputes the deterministic digest AND the
 *     report_content_digest from the body and both match the declared values.
 * Throws ReceiptValidationError (code INVALID_REPORT) otherwise. Never signs.
 */
export class ReceiptValidationError extends Error {
  constructor(message, reasons) {
    super(message);
    this.code = 'INVALID_REPORT';
    this.reasons = reasons;
  }
}

export function validateReportForReceipt(report) {
  const reasons = [];
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    throw new ReceiptValidationError('report must be a JSON object', ['report_not_object']);
  }
  if (report.schema !== REPORT_SCHEMA) reasons.push('report_schema_mismatch');
  const top = report.deterministic_report_sha256;
  const bound = report.binding?.deterministic_report_sha256;
  if (typeof top !== 'string' || !HEX64.test(top)) reasons.push('deterministic_digest_missing_or_malformed');
  if (top !== bound) reasons.push('deterministic_digest_binding_mismatch');
  const integrity = checkReportIntegrity(report);
  if (!integrity.ok) {
    for (const d of integrity.diffs) reasons.push(`integrity:${d.field}:${d.error}`);
  }
  if (reasons.length) {
    throw new ReceiptValidationError(`report rejected: ${reasons.join(', ')}`, reasons);
  }
  return { report, digest: top.toLowerCase() };
}

export function loadReport(path) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(path, 'utf8'));
  } catch (e) {
    throw new ReceiptValidationError(`report unreadable: ${e.message}`, ['report_unreadable']);
  }
  return validateReportForReceipt(parsed);
}

export function loadKeypair(envPath = process.env[KEY_ENV]) {
  if (!envPath) {
    const err = new Error(
      `${KEY_ENV} is unset. Refusing without a dedicated DEVNET keypair path.`,
    );
    err.code = 'MISSING_KEY';
    throw err;
  }
  const raw = fs.readFileSync(envPath, 'utf8');
  let secretKey;
  if (raw.trim().startsWith('-----BEGIN')) {
    const keyObject = crypto.createPrivateKey(raw);
    if (keyObject.asymmetricKeyType !== 'ed25519') {
      throw new Error('PEM key must be Ed25519');
    }
    const jwk = keyObject.export({ format: 'jwk' });
    const seed = Buffer.from(jwk.d, 'base64url');
    const pub = crypto.createPublicKey(keyObject).export({ format: 'jwk' });
    secretKey = Buffer.concat([seed, Buffer.from(pub.x, 'base64url')]);
  } else {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) secretKey = Buffer.from(parsed);
    else if (parsed.secretKey) secretKey = Buffer.from(parsed.secretKey, 'base64');
    else throw new Error('unsupported keypair JSON');
  }
  if (secretKey.length !== 64 && secretKey.length !== 32) {
    throw new Error(`keypair must be 32 or 64 bytes, got ${secretKey.length}`);
  }
  const seed = secretKey.subarray(0, 32);
  const privateKey = crypto.createPrivateKey({
    key: ed25519Pkcs8FromSeed(seed),
    format: 'der',
    type: 'pkcs8',
  });
  const publicKey = crypto.createPublicKey(privateKey);
  const pub32 = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url');
  const secretKey64 = Buffer.concat([seed, pub32]);
  const publicKeySpkiB64 = publicKey
    .export({ type: 'spki', format: 'der' })
    .toString('base64');
  return { seed, secretKey64, privateKey, publicKeySpkiB64, publicKey32: pub32 };
}

export function buildBody({ digest, report }) {
  return {
    kind: KIND,
    network: NETWORK,
    reportDigest: digest,
    reportSchema: report.schema || 'raven-conformance-report/1',
    runId: report.run_id || report.runId || null,
    issuedAt: new Date().toISOString(),
    disclaimer: DISCLAIMER,
    binding: {
      profile_sha256: report.binding?.profile_sha256 || null,
      corpus_sha256: report.binding?.corpus_sha256 || null,
      target_entry_sha256: report.binding?.target_entry_sha256 || null,
      deterministic_report_sha256: digest,
    },
  };
}

export function signBody(body, key) {
  const payloadHash = `sha256:${sha256Hex(canonicalJson(body))}`;
  const receiptId = `${KIND}:${payloadHash}`;
  const envelope = canonicalJson({
    domain: DOMAIN,
    version: VERSION,
    payloadHash,
  });
  const signature = crypto
    .sign(null, Buffer.from(envelope, 'utf8'), key.privateKey)
    .toString('base64');
  return {
    ...body,
    payloadHash,
    receiptId,
    signature,
    signerPublicKey: key.publicKeySpkiB64,
  };
}

export function verifyReceipt(receipt, reportPath) {
  const reasons = [];
  if (receipt.kind !== KIND) reasons.push('kind_mismatch');
  if (receipt.network !== NETWORK) reasons.push('network_not_devnet');
  if (receipt.disclaimer !== DISCLAIMER) reasons.push('disclaimer_mismatch');
  let digest = null;
  try {
    ({ digest } = loadReport(reportPath));
  } catch (e) {
    for (const r of e.reasons || ['report_invalid']) reasons.push(`report_invalid:${r}`);
  }
  if (digest && receipt.reportDigest !== digest) reasons.push('report_digest_mismatch');

  const bodyOnly = {
    kind: receipt.kind,
    network: receipt.network,
    reportDigest: receipt.reportDigest,
    reportSchema: receipt.reportSchema,
    runId: receipt.runId,
    issuedAt: receipt.issuedAt,
    disclaimer: receipt.disclaimer,
    binding: receipt.binding,
  };
  const recomputed = `sha256:${sha256Hex(canonicalJson(bodyOnly))}`;
  if (recomputed !== receipt.payloadHash) reasons.push('payload_hash_mismatch');
  if (receipt.receiptId !== `${KIND}:${receipt.payloadHash}`) {
    reasons.push('receipt_id_mismatch');
  }
  try {
    const pub = crypto.createPublicKey({
      key: Buffer.from(receipt.signerPublicKey, 'base64'),
      format: 'der',
      type: 'spki',
    });
    if (pub.asymmetricKeyType !== 'ed25519') reasons.push('signer_not_ed25519');
    const envelope = canonicalJson({
      domain: DOMAIN,
      version: VERSION,
      payloadHash: receipt.payloadHash,
    });
    const ok = crypto.verify(
      null,
      Buffer.from(envelope, 'utf8'),
      pub,
      Buffer.from(receipt.signature, 'base64'),
    );
    if (!ok) reasons.push('signature_invalid');
  } catch {
    reasons.push('signature_check_failed');
  }
  return { ok: reasons.length === 0, reasons, digest };
}

/** Canonical Solana DEVNET genesis hash (cluster identity, not URL cosmetics). */
export const DEVNET_GENESIS_HASH = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
export const MAINNET_GENESIS_HASH = '5eykt4UsmbJNVoz9FYAsfiAMnv8pf8vR9yLHtwYg4gYs';

/** Soft URL heuristic only — never sufficient alone. */
export function assertDevnetRpcUrl(url) {
  const u = (url || '').toLowerCase();
  if (u.includes('mainnet')) {
    throw new Error(`Refusing mainnet-looking RPC URL: ${url}`);
  }
}

/**
 * Hard cluster gate: query genesis hash and require DEVNET.
 * This is what prevents "labelled devnet" URL tricks from touching mainnet.
 */
export async function assertDevnetCluster(connection, { rpcUrl } = {}) {
  if (rpcUrl) assertDevnetRpcUrl(rpcUrl);
  const genesisHash = await connection.getGenesisHash();
  if (genesisHash === MAINNET_GENESIS_HASH) {
    throw new Error(
      `Refusing MAINNET cluster (genesis ${genesisHash}). Anchor is DEVNET-only.`,
    );
  }
  if (genesisHash !== DEVNET_GENESIS_HASH) {
    throw new Error(
      `RPC genesis hash ${genesisHash} is not Solana DEVNET (${DEVNET_GENESIS_HASH}). Refusing.`,
    );
  }
  return genesisHash;
}

/** @deprecated Prefer assertDevnetCluster(connection). Kept as URL pre-check only. */
export function assertDevnetRpc(url) {
  assertDevnetRpcUrl(url);
  const u = (url || '').toLowerCase();
  if (!u.includes('devnet')) {
    throw new Error(
      `RPC URL must mention devnet before cluster probe (got ${url}). Refusing.`,
    );
  }
}

/* ------------------------------------------------------------------------ */
/* HTTP issuance guard (CODEX B2): default OFF; explicit local mode only.     */
/* ------------------------------------------------------------------------ */
export const HTTP_ISSUE_ENV = 'RAVEN_CONFORMANCE_RECEIPT_HTTP_ISSUE';

export function isLoopbackAddress(addr) {
  const a = String(addr || '').toLowerCase().replace(/^::ffff:/, '');
  return a === '127.0.0.1' || a === '::1' || a === 'localhost';
}

/**
 * Returns { allowed, reason }. Allowed only when ALL hold:
 *   env[HTTP_ISSUE_ENV] === 'local'      (explicit opt-in; default off)
 *   no VERCEL / NODE_ENV=production      (never in a hosted deployment)
 *   bound host is loopback               (server not listening publicly)
 *   remote peer address is loopback      (caller is on this machine)
 * A comment is not a guard; this function is, and it is unit-tested.
 */
export function receiptHttpIssueAllowed({ env = process.env, boundHost, remoteAddress } = {}) {
  if (env[HTTP_ISSUE_ENV] !== 'local') return { allowed: false, reason: 'http_issue_disabled' };
  if (env.VERCEL || env.VERCEL_ENV || env.NODE_ENV === 'production') {
    return { allowed: false, reason: 'http_issue_refused_in_production' };
  }
  if (!isLoopbackAddress(boundHost)) return { allowed: false, reason: 'http_issue_requires_loopback_bind' };
  if (!isLoopbackAddress(remoteAddress)) return { allowed: false, reason: 'http_issue_requires_loopback_peer' };
  return { allowed: true, reason: null };
}

/* ------------------------------------------------------------------------ */
/* Anchor verification (CODEX B3/B4): fail closed, exact proof.              */
/* ------------------------------------------------------------------------ */
export const MEMO_PROGRAM_ID = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const BASE58_SIG = /^[1-9A-HJ-NP-Za-km-z]{64,120}$/;

export function expectedMemoFor(digest) {
  return `${KIND}:${digest}`;
}

/**
 * Decode a fetched transaction's message into { programIds: string[] per ix, data: Buffer per ix }.
 * Supports legacy and v0 messages as returned by web3.js getTransaction
 * (both expose staticAccountKeys + compiledInstructions). Programs resolved via
 * address-lookup tables are NOT supported: such an instruction is reported with
 * programId null so the caller fails closed.
 */
export function decodeMessageInstructions(message) {
  if (!message || !Array.isArray(message.compiledInstructions) || !Array.isArray(message.staticAccountKeys)) {
    throw new Error('unsupported_transaction_message_shape');
  }
  const keys = message.staticAccountKeys.map((k) => (typeof k === 'string' ? k : k.toBase58()));
  return message.compiledInstructions.map((ix) => ({
    programId: Number.isInteger(ix.programIdIndex) && ix.programIdIndex < keys.length ? keys[ix.programIdIndex] : null,
    data: Buffer.from(ix.data || []),
  }));
}

/**
 * Verify an anchor record against an independently fetched cluster + transaction.
 * `connection` must provide getGenesisHash() and getTransaction(sig, opts).
 * Every failure (including thrown RPC errors) yields ok:false with a reason.
 */
export async function verifyAnchor(receipt, anchor, { connection, rpcUrl } = {}) {
  const reasons = [];
  const detail = { genesisHash: null, txFound: false, txSucceeded: null, memoProgram: false, memoExact: false };
  if (!anchor || typeof anchor !== 'object') return { ok: false, reasons: ['anchor_not_object'], detail };
  if (anchor.reportDigest !== receipt.reportDigest) reasons.push('anchor_digest_mismatch');
  if (anchor.network !== NETWORK || anchor.labeled !== 'DEVNET') reasons.push('anchor_not_labeled_devnet');
  if (anchor.genesisHash !== DEVNET_GENESIS_HASH) reasons.push('anchor_genesis_not_devnet');
  if (typeof anchor.signature !== 'string' || !BASE58_SIG.test(anchor.signature)) reasons.push('anchor_signature_malformed');
  const memo = expectedMemoFor(receipt.reportDigest);
  if (anchor.memo !== undefined && anchor.memo !== memo) reasons.push('anchor_memo_mismatch');
  if (reasons.length) return { ok: false, reasons, detail };

  try {
    if (rpcUrl) assertDevnetRpcUrl(rpcUrl);
    if (!connection) throw new Error('no_connection');
    const genesis = await connection.getGenesisHash();
    detail.genesisHash = genesis;
    if (genesis === MAINNET_GENESIS_HASH) return { ok: false, reasons: ['cluster_is_mainnet'], detail };
    if (genesis !== DEVNET_GENESIS_HASH) return { ok: false, reasons: ['cluster_genesis_not_devnet'], detail };
    if (anchor.genesisHash !== genesis) return { ok: false, reasons: ['anchor_genesis_disagrees_with_cluster'], detail };

    const tx = await connection.getTransaction(anchor.signature, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
    });
    if (!tx) return { ok: false, reasons: ['anchor_tx_not_found'], detail };
    detail.txFound = true;
    if (!tx.meta || tx.meta.err !== null) {
      detail.txSucceeded = false;
      return { ok: false, reasons: ['anchor_tx_failed_or_meta_missing'], detail };
    }
    detail.txSucceeded = true;
    const ixs = decodeMessageInstructions(tx.transaction?.message);
    const memoIxs = ixs.filter((ix) => ix.programId === MEMO_PROGRAM_ID);
    if (memoIxs.length === 0) return { ok: false, reasons: ['anchor_no_memo_program_instruction'], detail };
    detail.memoProgram = true;
    const exact = memoIxs.some((ix) => ix.data.equals(Buffer.from(memo, 'utf8')));
    if (!exact) return { ok: false, reasons: ['anchor_memo_bytes_mismatch'], detail };
    detail.memoExact = true;
    return { ok: true, reasons: [], detail };
  } catch (e) {
    return { ok: false, reasons: [`anchor_rpc_error:${String(e && e.message ? e.message : e)}`], detail };
  }
}
