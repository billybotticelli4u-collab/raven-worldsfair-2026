#!/usr/bin/env node
// LEGACY V2 COMPATIBILITY EXAMPLE. This file verifies the frozen POST /verify
// replayHash/officialAttestationHash envelope. It is not the current
// receipt-v1 customer recipe. New integrations use POST /receipt/v1,
// /receipt-v1-test-vector.json, and raven-receipt-verifier.
// Raven preflight gate — the whole pattern, with full receipt binding.
// Usage: RAVEN_KEY=... RAVEN_EXPECTED_KEY_ID=rvk_... RAVEN_EXPECTED_PUBLIC_KEY_BASE64=... node preflight-gate.mjs <mint> <tokenProgram>
// Exit code: 0 = proceed, 2 = escalate to human, 3 = block.
//
// Trust model: pin Raven's signer key INDEPENDENTLY (out-of-band) and supply it
// via RAVEN_EXPECTED_*. A valid signature establishes integrity and control of
// the signing key; your pin is what attributes the receipt to Raven. GET
// /pubkey is same-host discovery/cross-check material only — it can contradict
// your pin (an incident) but can never replace it.
//
// Binding model: NEVER act on a receipt field until you have proved the field
// is committed by the signed hashes. A signature over officialAttestationHash
// alone proves nothing about verdict/findings/gaps — those are bound one layer
// down. Run the canonical verification stages in order (recipe: the public
// canonical-JSON rule documented in /receipt-test-vector.json; the same
// consumer-side reconstruction the hosted verifier's own round-trip test uses):
//   L1  recompute replayHash from your request + the response fields
//   L2  recompute officialAttestationHash from replayHash + keyId + issuedAt
//   SIG verify ed25519 over the domain-separated v2 preimage
// Only after all three hold may you store the receipt or apply policy.
const [mint, program] = process.argv.slice(2);
const ACCEPTABLE_GAPS = ["deployer_outcomes"]; // YOUR policy: gaps you tolerate
const API = process.env.RAVEN_API_BASE ?? "https://raven-hosted-verifier.onrender.com";
const PIN_KEY_ID = process.env.RAVEN_EXPECTED_KEY_ID;
const PIN_PUB = process.env.RAVEN_EXPECTED_PUBLIC_KEY_BASE64;
if (!PIN_KEY_ID || !PIN_PUB) {
  console.error("pin the signer key out-of-band first: set RAVEN_EXPECTED_KEY_ID and RAVEN_EXPECTED_PUBLIC_KEY_BASE64");
  process.exit(2);
}

const res = await fetch(`${API}/verify`, {
  method: "POST",
  headers: { "x-api-key": process.env.RAVEN_KEY, "content-type": "application/json" },
  body: JSON.stringify({ mintAddress: mint, tokenProgramAddress: program }),
});
if (!res.ok) { console.error("verifier error", res.status, "- do not proceed; retry later"); process.exit(2); }
const receipt = await res.json();

// 1. the receipt must name YOUR pinned key — keyId equality is necessary, never sufficient
if (receipt.keyId !== PIN_KEY_ID) { console.error("UNKNOWN KEY — receipt keyId is not your pinned keyId — treat as incident"); process.exit(3); }

// 2. cross-check: same-host /pubkey must AGREE with the pin (discovery/cross-check only)
const pub = await (await fetch(`${API}/pubkey`)).json();
const served = (pub.keys ?? []).find((k) => k.keyId === PIN_KEY_ID);
if (!served || served.publicKeyBase64 !== PIN_PUB) { console.error("/pubkey cross-check MISMATCH — served key material disagrees with your pin — treat as incident"); process.exit(3); }

// Canonical JSON (keys sorted lexicographically, no whitespace, undefined
// properties omitted) + sha256 — the public recipe every stage below uses.
const { createHash, createPublicKey, verify: edVerify } = await import("node:crypto");
const canon = (v) => {
  if (v === null) return "null";
  const t = typeof v;
  if (t === "string" || t === "number" || t === "boolean") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  if (t === "object")
    return "{" + Object.keys(v).sort().filter((k) => v[k] !== undefined)
      .map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
  throw new Error("uncanonicalizable value of type " + t);
};
const sha = (s) => "sha256:" + createHash("sha256").update(s, "utf8").digest("hex");

// 3. L1: recompute replayHash from YOUR request + the response fields. This is
// what binds verdict, findings, coverageGaps and the observed slot: if any of
// them were altered in transit, the recomputed hash will not match.
const replayInput = {
  schema: "raven-replay-v4",
  request: {
    mintAddress: mint,
    tokenProgramAddress: program,
    metadataAddress: null, // this example sends neither optional address
    poolAddress: null,
    commitment: "finalized", // the /verify default when the request omits it
  },
  engineVersion: String(receipt.engineVersion ?? "unknown"),
  ravenVersion: String(receipt.raven_version ?? "unknown"),
  observedSlot: receipt.rpc && typeof receipt.rpc === "object" ? (receipt.rpc.observedSlot ?? null) : null,
  scan: {
    verdict: receipt.verdict,
    engineOutcome: receipt.engineOutcome ?? null,
    reason: receipt.reason,
    recommendation: receipt.recommendation ?? null,
    findingCodes: receipt.findingCodes ?? [],
    triggeringFindingCodes: receipt.triggeringFindingCodes ?? [],
    findings: receipt.findings ?? [],
    scanContext: receipt.scanContext ?? null,
    // launchAcquisitionNote is deliberately NOT bound (unsigned enrichment).
  },
  coverageGaps: receipt.coverageGaps ?? [],
};
if (sha(canon(replayInput)) !== receipt.replayHash) {
  console.error("REPLAY HASH MISMATCH — response fields are not committed by the signed replay hash — treat as incident");
  process.exit(3);
}

// 4. L2: recompute officialAttestationHash — binds replayHash + keyId + issuedAt + service.
const official = sha(canon({
  schema: "raven-official-attestation-v2",
  replayHash: receipt.replayHash,
  keyId: receipt.keyId,
  issuedAt: receipt.issuedAt,
  service: "raven-hosted-verifier",
}));
if (official !== receipt.officialAttestationHash) {
  console.error("OFFICIAL HASH MISMATCH — keyId/issuedAt/replayHash are not committed by the signed official hash — treat as incident");
  process.exit(3);
}

// 5. SIG: verify the ed25519 signature over the documented v2 preimage (recipe: /receipt-test-vector.json)
const preimage = canon({
  domain: "raven-official-attestation",
  issuedAt: receipt.issuedAt,
  keyId: receipt.keyId,
  officialAttestationHash: receipt.officialAttestationHash,
  version: "v2",
});
const key = createPublicKey({ key: Buffer.from(PIN_PUB, "base64"), format: "der", type: "spki" });
if (!edVerify(null, Buffer.from(preimage, "utf8"), key, Buffer.from(receipt.signature, "base64"))) {
  console.error("SIGNATURE INVALID — treat as incident");
  process.exit(3);
}

// 6. store the exact receipt (append-only; later receipts are new evidence)
const { mkdirSync, writeFileSync } = await import("node:fs");
const dir = `receipts/solana/mainnet/${mint}`;
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/${receipt.replayHash.replace("sha256:", "")}.json`, JSON.stringify(receipt, null, 1));

// 7. decide by policy (decision-policy.json)
const gaps = receipt.coverageGaps ?? [];
const unacceptable = gaps.filter((g) => !ACCEPTABLE_GAPS.includes(g));
console.log(`verdict=${receipt.verdict} gaps=[${gaps.join(",")}] slot=${receipt.rpc?.observedSlot}`);
if (receipt.verdict === "risk") { console.log("BLOCK"); process.exit(3); }
if (receipt.verdict === "warning" || receipt.verdict === "unknowable") { console.log("ESCALATE to human"); process.exit(2); }
if (unacceptable.length) { console.log(`not enough evidence for a full pass — unaccepted gaps: ${unacceptable.join(", ")} — ESCALATE`); process.exit(2); }
console.log("PROCEED (no risk findings on checked surfaces; gaps accepted by policy)");
