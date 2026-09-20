#!/usr/bin/env node
// Re-verify the cleanest mints on record against the LIVE verifier with all
// current controls, and save the full signed receipts for human review.
//
// "Cleanest on record" = labeler baseline outcome `pass` with only
// venue.infrastructure_tier_immutable, AND outcome.unchanged with zero added
// codes across every completed revisit (T+1h, T+1d, T+7d). Selected from
// apps/raven-solana-labeler/data (baselines of 2026-05-22).
//
// Controls applied to every live response:
//   - HTTP 200 + ok:true
//   - unsigned is a top-level sibling only (never inside the receipt)
//   - receipt (body minus unsigned) validates against receipt-wire-schema.json
//   - ed25519 signature verifies via the published preimage recipe + /pubkey
//   - launch.* never in triggeringFindingCodes (Stage-3 informational-only)
//   - verdict + finding codes reported vs the May baseline (drift is
//     INFORMATION here, not failure — conditions and engine have moved)
//
// Run:   RAVEN_API_KEY=<key> node apps/raven-site/scripts/verify-clean-mints.mjs
// Out:   apps/raven-site/scripts/clean-receipts/<mint>.json  (+ SUMMARY.md)
// Paced to respect the per-key rate limit (burst 4, 10/min).
import { createPublicKey, verify as edVerify } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const API = process.env.RAVEN_API_BASE || "https://raven-hosted-verifier.onrender.com";
const KEY = process.env.RAVEN_API_KEY;
if (!KEY) {
  console.error("RAVEN_API_KEY not set. Run: RAVEN_API_KEY=<key> node verify-clean-mints.mjs");
  process.exit(2);
}

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "clean-receipts");
mkdirSync(outDir, { recursive: true });
const schema = JSON.parse(readFileSync(join(here, "..", "receipt-wire-schema.json"), "utf8"));

// Top 10 of the 122 qualifying mints (all SPL Tokenkeg, baseline 2026-05-22,
// pass + immutable-venue only + unchanged through T+7D).
const SPL = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const MINTS = [
  "9UjwQHUVbJtgdYhBSSpzBF4z9mBwFkBoT2RJroGwwray",
  "Ad8HHRs3bqpPPHemBEEp7ty19FRfpp5tmzmbiKiSpump",
  "Em2rKnZ2JYpoDbuTdty1LePezR5LWZjvF8nykfr92e4L",
  "5c4HyD2rSShqnTsf5z3SaoD2H3GE452u2CUuYjviBAGS",
  "3FWikV6rKWerJYux9sPE7i7XJ3qebQk13HLXVhUeNova",
  "2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv",
  "HAYmJarY4WoBdzCVWGGFNYZtcYWw7fpXvCsZ5Chvpump",
  "BqCC9L3cL3PCvBbVpkcz9WGyu5gJJiFdqZY7yFKZpump",
  "8x5c6Hcqhc4FwHn1KKpbmzAF6GgE3AjMYz5nomDBYPta",
  "Dt4p7RdSbKKj7NkGJ85VXevLqiRp3eUoaBquofijBAGS",
];
const BASELINE = { outcome: "pass", findingCodes: ["venue.infrastructure_tier_immutable"] };

const typeOk = (val, t) => {
  const ts = Array.isArray(t) ? t : [t];
  return ts.some((x) =>
    x === "null" ? val === null :
    x === "array" ? Array.isArray(val) :
    x === "integer" ? Number.isInteger(val) :
    x === "object" ? (typeof val === "object" && val !== null && !Array.isArray(val)) :
    typeof val === x);
};
const wireProblems = (r) => {
  const out = [];
  for (const f of schema.required ?? []) if (!(f in r)) out.push(`missing ${f}`);
  for (const [k, p] of Object.entries(schema.properties ?? {})) {
    if (p === false) { if (k in r) out.push(`forbidden ${k}`); continue; }
    if (!(k in r)) continue;
    if (p.type && !typeOk(r[k], p.type)) out.push(`${k}: type`);
    if (p.enum && !p.enum.includes(r[k])) out.push(`${k}: enum`);
    if ("const" in p && r[k] !== p.const) out.push(`${k}: const`);
    if (p.pattern && typeof r[k] === "string" && !new RegExp(p.pattern).test(r[k])) out.push(`${k}: pattern`);
  }
  return out;
};
const canonical = (obj) =>
  "{" + Object.keys(obj).sort().map((k) => JSON.stringify(k) + ":" + JSON.stringify(obj[k])).join(",") + "}";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const pub = await (await fetch(`${API}/pubkey`)).json();
const keys = pub.keys ?? [];
console.log(`pubkey keyIds: ${keys.map((k) => k.keyId).join(",")}\n`);

const LIMIT = Math.max(1, parseInt(process.env.CLEAN_MINTS_LIMIT || "10", 10) || 10);
const rows = [];
for (const mint of MINTS.slice(0, LIMIT)) {
  let res, body;
  for (let attempt = 1; attempt <= 3; attempt++) {
    res = await fetch(`${API}/verify`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": KEY },
      body: JSON.stringify({ mintAddress: mint, tokenProgramAddress: SPL }),
    });
    if (res.status !== 429) break;
    console.log(`  429 on ${mint.slice(0, 8)}… waiting 30s (attempt ${attempt})`);
    await sleep(30000);
  }
  if (!res.ok) {
    rows.push({ mint, status: res.status, controls: "N/A", verdict: "HTTP_" + res.status, drift: "-" });
    console.log(`FAIL ${mint} -> HTTP ${res.status}`);
    await sleep(8000);
    continue;
  }
  body = await res.json();
  const { unsigned, ...receipt } = body;

  const controls = [];
  if (!(typeof unsigned === "object" && unsigned !== null && !("unsigned" in receipt))) controls.push("unsigned-boundary");
  const wp = wireProblems(receipt);
  if (wp.length) controls.push("wire-schema(" + wp.join("|") + ")");
  const k = keys.find((x) => x.keyId === receipt.keyId);
  if (!k) controls.push("keyId-unknown");
  else {
    const preimage = canonical({
      domain: "raven-official-attestation",
      issuedAt: receipt.issuedAt,
      keyId: receipt.keyId,
      officialAttestationHash: receipt.officialAttestationHash,
      version: "v2",
    });
    const key = createPublicKey({ key: Buffer.from(k.publicKeyBase64, "base64"), format: "der", type: "spki" });
    if (!edVerify(null, Buffer.from(preimage, "utf8"), key, Buffer.from(receipt.signature, "base64"))) controls.push("signature");
  }
  if ((receipt.triggeringFindingCodes ?? []).some((c) => c.startsWith("launch."))) controls.push("launch-in-triggering");

  const added = (receipt.findingCodes ?? []).filter((c) => !BASELINE.findingCodes.includes(c));
  const removed = BASELINE.findingCodes.filter((c) => !(receipt.findingCodes ?? []).includes(c));
  const drift = added.length || removed.length ? `+[${added.join(",")}] -[${removed.join(",")}]` : "none";

  writeFileSync(join(outDir, `${mint}.json`), JSON.stringify(body, null, 2));
  rows.push({ mint, status: 200, controls: controls.length ? "FAIL: " + controls.join(",") : "ALL PASS", verdict: receipt.verdict, drift });
  console.log(`${controls.length ? "FAIL" : "ok  "} ${mint.slice(0, 12)}… verdict=${receipt.verdict} controls=${controls.length ? controls.join(",") : "all pass"} drift=${drift}`);
  await sleep(8000); // pace under 10/min per-key limit
}

const md = [
  "# Clean-Mints Re-Verification — " + new Date().toISOString(),
  "",
  "Baseline (2026-05-22): outcome `pass`, findings `venue.infrastructure_tier_immutable` only, unchanged through T+7D revisits.",
  "Drift vs baseline is information, not failure — engine vocabulary and on-chain conditions have both moved since May.",
  "",
  "| Mint | HTTP | Controls | Live verdict | Finding drift vs baseline |",
  "|---|---|---|---|---|",
  ...rows.map((r) => `| ${r.mint} | ${r.status} | ${r.controls} | ${r.verdict} | ${r.drift} |`),
  "",
  "Full signed receipts: ./clean-receipts/<mint>.json — each independently re-verifiable via the public test-vector recipe.",
].join("\n");
writeFileSync(join(outDir, "SUMMARY.md"), md);
console.log(`\nSaved ${rows.filter((r) => r.status === 200).length} receipts + SUMMARY.md to ${outDir}`);
