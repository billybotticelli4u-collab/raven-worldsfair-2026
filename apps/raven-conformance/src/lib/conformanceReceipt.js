import crypto from 'node:crypto';
import fs from 'node:fs';
import { canonicalJson } from './canonicalJson.js';

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

export function loadReport(path) {
  const report = JSON.parse(fs.readFileSync(path, 'utf8'));
  const digest =
    report.deterministic_report_sha256 ||
    report.binding?.deterministic_report_sha256 ||
    null;
  if (!digest || !HEX64.test(digest)) {
    throw new Error('report missing deterministic_report_sha256 (64 hex)');
  }
  return { report, digest: digest.toLowerCase() };
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
  const { digest } = loadReport(reportPath);
  if (receipt.reportDigest !== digest) reasons.push('report_digest_mismatch');

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
