// TEST-ONLY SIGNER. Never imported by product code (live/*.js).
// The Ed25519 key pair is generated in memory per call and never written to
// disk. It is NOT the Raven key; the product path must REFUSE what it signs.
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import {
  RECEIPT_BODY_FIELDS,
  RECEIPT_DOMAIN,
  RECEIPT_ID_PREFIX,
  RECEIPT_VERSION,
  canonicalJson,
} from "../../../../vendor/raven-receipt-verifier/packages/verify-js/src/index.ts";

function bodyOf(receipt) {
  const body = {};
  for (const f of RECEIPT_BODY_FIELDS) body[f] = receipt[f];
  return body;
}

function hashOf(body) {
  return "sha256:" + createHash("sha256").update(canonicalJson(body), "utf8").digest("hex");
}

/** Fresh receipt signed by an ephemeral TEST-ONLY key. */
export function makeTestOnlySignedReceipt(template, overrides = {}) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const body = { ...bodyOf(template), ...overrides };
  const payloadHash = hashOf(body);
  const signature = sign(
    null,
    Buffer.from(canonicalJson({ domain: RECEIPT_DOMAIN, version: RECEIPT_VERSION, payloadHash }), "utf8"),
    privateKey,
  ).toString("base64");
  const testOnlyPublicKeyBase64 = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  return {
    receipt: {
      ...body,
      payloadHash,
      receiptId: RECEIPT_ID_PREFIX + payloadHash,
      signature,
      signerPublicKey: testOnlyPublicKeyBase64,
    },
    testOnlyPublicKeyBase64,
  };
}

/** Change a body field and recompute payloadHash + receiptId WITHOUT re-signing. */
export function rehashWithoutResigning(receipt, overrides) {
  const body = { ...bodyOf(receipt), ...overrides };
  const payloadHash = hashOf(body);
  return {
    ...body,
    payloadHash,
    receiptId: RECEIPT_ID_PREFIX + payloadHash,
    signature: receipt.signature,
    signerPublicKey: receipt.signerPublicKey,
  };
}
