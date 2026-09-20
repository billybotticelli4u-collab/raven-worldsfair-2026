#!/usr/bin/env node
// LEGACY V2 COMPATIBILITY EXAMPLE for /receipt-schema.json. This is not the
// current receipt-v1 storage contract. Store receipt-v1 as exact response
// bytes plus the separate local verification result.
// Usage: node store-receipt.mjs receipt.json [namespace]
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
const raw = JSON.parse(readFileSync(process.argv[2], "utf8"));
const ns = process.argv[3] || "raven/default/agent/prod";
const stored = {
  schemaVersion: "raven-stored-receipt/1",
  receiptType: "raven_token_verification",
  mintAddress: raw.rpc?.mintAddress, tokenProgramAddress: raw.rpc?.tokenProgramAddress ?? null,
  request: { mintAddress: raw.rpc?.mintAddress }, verdict: raw.verdict,
  findingCodes: raw.findingCodes, coverageGaps: raw.coverageGaps,
  observedSlot: raw.rpc?.observedSlot ?? null, engineVersion: raw.engineVersion,
  keyId: raw.keyId, replayHash: raw.replayHash,
  officialAttestationHash: raw.officialAttestationHash, signature: raw.signature,
  createdAt: new Date().toISOString(), source: "hosted_api",
  namespace: ns, rawResponse: raw, // raw receipt = source of truth, unmodified
};
const path = `receipts/solana/mainnet/${stored.mintAddress}/${raw.replayHash.replace("sha256:", "")}.json`;
if (existsSync(path)) { console.log("already stored (append-only: never overwrite):", path); process.exit(0); }
mkdirSync(path.substring(0, path.lastIndexOf("/")), { recursive: true });
writeFileSync(path, JSON.stringify(stored, null, 1));
console.log("stored:", path);
