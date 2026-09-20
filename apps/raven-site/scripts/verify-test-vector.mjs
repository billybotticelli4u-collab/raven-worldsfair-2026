#!/usr/bin/env node
// Clean-room test-vector verification. Uses ONLY what the public vector
// publishes: pubkey_response, the receipt fields, and expected.*. If this
// passes, a third-party verifier built from the vector alone will verify
// production receipts. No secrets, no network unless a URL is passed.
//
// Usage: node verify-test-vector.mjs [path-or-url]   (default: ../receipt-test-vector.json)
import { createPublicKey, verify as edVerify } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const src = process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), "..", "receipt-test-vector.json");
// The canary invokes this verifier against an approved exact site origin. A
// redirect would turn that one reviewed origin into an implicit second target,
// so remote vectors and their sibling schema fail closed instead of following.
const fetchExact = (url) => fetch(url, { redirect: "error" });
const vector = src.startsWith("http")
  ? await (await fetchExact(src)).json()
  : JSON.parse(readFileSync(src, "utf8"));

let fail = 0;
const check = (name, ok, detail = "") => {
  console.log((ok ? "PASS" : "FAIL") + " - " + name + (ok || !detail ? "" : " -> " + detail));
  if (!ok) fail++;
};

const r = vector.receipt;
const exp = vector.expected;

// 1) keyId in the receipt must exist in the published key set.
const pub = (vector.pubkey_response.keys ?? []).find((k) => k.keyId === r.keyId);
check("keyId matches pubkey_response", Boolean(pub), `unknown keyId ${r.keyId}`);

// 2) Build the preimage from the documented recipe ONLY: canonical JSON
//    (keys sorted lexicographically, no whitespace) of the five fields.
const canonical = (obj) =>
  "{" + Object.keys(obj).sort().map((k) => JSON.stringify(k) + ":" + JSON.stringify(obj[k])).join(",") + "}";
const preimage = canonical({
  domain: "raven-official-attestation",
  issuedAt: r.issuedAt,
  keyId: r.keyId,
  officialAttestationHash: r.officialAttestationHash,
  version: "v2",
});

// 3) The recipe output must byte-match the published exact preimage.
check("recipe output byte-matches expected.signature_preimage_utf8",
  preimage === exp.signature_preimage_utf8,
  "recipe and published preimage differ — instructions are wrong");

// 4) ed25519 verify over the preimage with the published key.
const key = createPublicKey({ key: Buffer.from(pub.publicKeyBase64, "base64"), format: "der", type: "spki" });
const sigOk = edVerify(null, Buffer.from(preimage, "utf8"), key, Buffer.from(r.signature, "base64"));
check("ed25519 signature verifies over preimage", sigOk);

// 5) Published hash/verdict expectations match the receipt fields.
check("replayHash matches expected", r.replayHash === exp.replayHash);
check("officialAttestationHash matches expected", r.officialAttestationHash === exp.officialAttestationHash);
check("verdict matches expected", r.verdict === exp.verdict);
check("coverageGaps non-empty as expected", (r.coverageGaps ?? []).length > 0 === exp.coverageGaps_nonempty);

// 6) Trust-boundary shape: unsigned (if present) is a TOP-LEVEL sibling,
//    never inside the signed receipt.
check("no receipt.unsigned (unsigned is top-level only)", !("unsigned" in r));
check("unsigned is a top-level sibling of receipt", typeof vector.unsigned === "object" && vector.unsigned !== null);

// 7) Wire-schema validation (minimal, zero-dep): the receipt object must
//    validate against the published wire schema (/receipt-wire-schema.json).
//    Supports the subset the schema uses: required, type, enum, const,
//    pattern, and `false` property prohibitions. Schema load is best-effort:
//    sibling URL when the vector came from a URL, local file otherwise.
const schemaSrc = src.startsWith("http")
  ? src.replace(/[^/]*$/, "receipt-wire-schema.json")
  : join(dirname(fileURLToPath(import.meta.url)), "..", "receipt-wire-schema.json");
try {
  const schema = schemaSrc.startsWith("http")
    ? await (await fetchExact(schemaSrc)).json()
    : JSON.parse(readFileSync(schemaSrc, "utf8"));
  const typeOk = (val, t) => {
    const ts = Array.isArray(t) ? t : [t];
    return ts.some((x) =>
      x === "null" ? val === null :
      x === "array" ? Array.isArray(val) :
      x === "integer" ? Number.isInteger(val) :
      x === "object" ? (typeof val === "object" && val !== null && !Array.isArray(val)) :
      typeof val === x);
  };
  const problems = [];
  for (const f of schema.required ?? []) if (!(f in r)) problems.push(`missing required ${f}`);
  for (const [k, p] of Object.entries(schema.properties ?? {})) {
    if (p === false) { if (k in r) problems.push(`forbidden property ${k}`); continue; }
    if (!(k in r)) continue;
    if (p.type && !typeOk(r[k], p.type)) problems.push(`${k}: wrong type`);
    if (p.enum && !p.enum.includes(r[k])) problems.push(`${k}: not in enum`);
    if ("const" in p && r[k] !== p.const) problems.push(`${k}: != const ${p.const}`);
    if (p.pattern && typeof r[k] === "string" && !new RegExp(p.pattern).test(r[k])) problems.push(`${k}: pattern mismatch`);
  }
  check("receipt validates against receipt-wire-schema.json", problems.length === 0, problems.join("; "));
} catch (e) {
  check("receipt validates against receipt-wire-schema.json", false, `schema unavailable: ${e.message}`);
}

console.log(fail === 0 ? "\nALL CHECKS PASSED" : `\n${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
