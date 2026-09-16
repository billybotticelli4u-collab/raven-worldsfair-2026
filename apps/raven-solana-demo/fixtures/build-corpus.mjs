/**
 * Corpus builder — raven-solana-txversion-experimental/0
 *
 * Derives the demo corpus from fixtures/base-fixtures.json (real kit-generated
 * bytes) plus documented single-field surgery for negative vectors. Freezes
 * expected outcomes by running oracle/oracle.mjs — NEVER any target.
 *
 *   node fixtures/build-corpus.mjs                 # write corpus JSON
 *   node fixtures/build-corpus.mjs --kit-check     # additionally cross-check
 *                                                  # ACCEPT vectors against
 *                                                  # @solana/kit's decoder
 *                                                  # (requires devDependency)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { evaluate } from "../oracle/oracle.mjs";

const base = JSON.parse(readFileSync(new URL("./base-fixtures.json", import.meta.url), "utf8"));
const L = Buffer.from(base.fixtures.legacy_ok, "hex");
const Z = Buffer.from(base.fixtures.v0_ok, "hex");
const O = Buffer.from(base.fixtures.v1_ok, "hex");

// payer/dest raw bytes, from the v1 fixture's static account section (@42, 2x32)
const PAYER = O.subarray(42, 74);
const DEST = O.subarray(74, 106);

function replaceOnce(buf, from, to, label) {
  const hex = buf.toString("hex");
  const f = Buffer.from(from).toString("hex");
  const first = hex.indexOf(f);
  if (first === -1 || first !== hex.lastIndexOf(f))
    throw new Error(`surgery anchor not unique: ${label}`);
  return Buffer.from(hex.replace(f, Buffer.from(to).toString("hex")), "hex");
}

const b64 = (buf) => buf.toString("base64");

// offset of the 0x80 message prefix inside v0_ok: [0]=sigcount(01), sigs @1..64 → @65
if (Z[65] !== 0x80) throw new Error("v0 layout assumption broken");
if (Z[0] !== 0x01 || L[0] !== 0x01 || O[0] !== 0x81) throw new Error("envelope assumptions broken");
// v1 heap value is the last config value: u32 LE @154..157 in this fixture (mask=0b11111)
if (O.readUInt32LE(154) !== 65536) throw new Error("v1 config layout assumption broken");

const legacyDup = replaceOnce(L, DEST, PAYER, "legacy_dupacct");
const v1Dup = replaceOnce(O, DEST, PAYER, "v1_dupacct");
const v1BadHeap = Buffer.from(O);
v1BadHeap.writeUInt32LE(16384, 154);
// v0_ok ends with an empty lookup-table section (single 0x00 count byte at @216)
if (Z[216] !== 0x00) throw new Error("v0 lookup-tail assumption broken");
const v0Alt = Buffer.concat([
  Z.subarray(0, 216), // strip the empty lookup count
  Buffer.from([0x01]), // lookup count 1
  Buffer.alloc(32, 0x33), // synthetic table address
  Buffer.from([0x01, 0x00]), // writable indexes: [0]
  Buffer.from([0x00]), // readonly indexes: []
]);
const msgVer3 = Buffer.from(Z);
msgVer3[65] = 0x83;
const sigInflated = Buffer.from(L);
sigInflated[0] = 0x02;

const VECTORS = [
  {
    id: "V01_valid_legacy",
    input: { tx_base64: b64(L) },
    requirement: "R4/R5/R8 legacy happy path",
    rationale: "Valid real legacy transfer (kit-generated) must ACCEPT as legacy.",
    provenance: "real: kit-generated offline, synthetic keys",
    codec_check: "decode_ok",
  },
  {
    id: "V02_valid_v0",
    input: { tx_base64: b64(Z) },
    requirement: "R4/R5/R8 v0 happy path",
    rationale: "Valid real v0 transfer (message prefix 0x80 after signatures) must ACCEPT as v0.",
    provenance: "real: kit-generated offline, synthetic keys",
    codec_check: "decode_ok",
  },
  {
    id: "V03_valid_v1",
    input: { tx_base64: b64(O) },
    requirement: "R3/R9 v1 happy path",
    rationale:
      "Valid real v1 transfer (version byte 0x81 at offset zero, SIMD-0385; mainnet since 2026-09-09 per Solana Compass) must ACCEPT as v1. A pre-v1 parser misreads 0x81 as a short-vec continuation byte.",
    provenance: "real: kit-generated offline, synthetic keys",
    codec_check: "decode_ok",
  },
  {
    id: "V04_valid_v0_with_lookup_table",
    input: { tx_base64: b64(v0Alt) },
    requirement: "R8 v0 lookup section",
    rationale:
      "v0 with one address-lookup-table entry must ACCEPT as v0; parsers that end the v0 message at the instruction list reject it as trailing bytes.",
    provenance: "synthetic: real v0 fixture + documented lookup section appended (Solana docs v0 layout)",
    codec_check: "decode_ok",
  },
  {
    id: "V05_valid_legacy_duplicate_account",
    input: { tx_base64: b64(legacyDup) },
    requirement: "R8 legacy duplicates allowed (docs version matrix)",
    rationale:
      "Legacy transactions permit duplicate account addresses (only v1 rejects them). Contrast vector with V12: same mutation, opposite verdict by version.",
    provenance: "derived: dest account bytes replaced by payer bytes in real legacy fixture",
    codec_check: "decode_ok",
  },
  {
    id: "V06_truncated_legacy",
    input: { tx_base64: b64(L.subarray(0, 120)) },
    requirement: "R11 truncated",
    rationale: "Legacy fixture cut mid-accounts must REJECT.",
    provenance: "derived: truncation of real fixture",
    codec_check: "decode_fail",
  },
  {
    id: "V07_trailing_bytes_v0",
    input: { tx_base64: b64(Buffer.concat([Z, Buffer.alloc(5, 0xaa)])) },
    requirement: "R11 exact consumption",
    rationale:
      "Five garbage bytes appended after a valid v0 transaction must REJECT (trailing_bytes). NOTE: @solana/kit 8.3.0's own decoder tolerates trailing bytes — this vector demonstrates that codec-level decode success is not admission hygiene.",
    provenance: "derived: real v0 fixture + 5 trailing 0xAA",
    codec_check: "decode_ok_but_profile_rejects",
  },
  {
    id: "V08_unsupported_tx_version_2",
    input: { tx_base64: b64(Buffer.concat([Buffer.from([0x82]), O.subarray(1)])) },
    requirement: "R3 unsupported_version",
    rationale:
      "Version byte 0x82 (version 2) at offset zero is reserved/unsupported; must REJECT, not optimistic-accept a future format.",
    provenance: "derived: v1 fixture version byte flipped 0x81→0x82",
    codec_check: "decode_fail",
  },
  {
    id: "V09_unsupported_message_version_3",
    input: { tx_base64: b64(msgVer3) },
    requirement: "R5 message-level version",
    rationale: "Message prefix 0x83 (message version 3) after a valid signature section must REJECT.",
    provenance: "derived: v0 fixture message prefix 0x80→0x83",
    codec_check: "decode_fail",
  },
  {
    id: "V10_noncanonical_shortvec_sigcount",
    input: { tx_base64: b64(Buffer.concat([Buffer.from([0x81, 0x00]), L.subarray(1)])) },
    requirement: "R3/R4 canonical short-vec + envelope precedence",
    rationale:
      "Signature count 1 encoded non-canonically as 81 00. Under the post-SIMD-0385 envelope convention a leading 0x81 IS the v1 version byte, so this is a malformed v1 transaction; a stale pre-v1 parser reads it as count=1 and ACCEPTs. Catches non-minimal-encoding tolerance and version ambiguity together.",
    provenance: "derived: legacy fixture sig-count byte replaced by non-minimal two-byte encoding",
    codec_check: "decode_fail",
  },
  {
    id: "V11_inflated_sigcount",
    input: { tx_base64: b64(sigInflated) },
    requirement: "R4/R7 signature section consistency",
    rationale: "Signature count edited 1→2 without adding a signature must REJECT.",
    provenance: "derived: legacy fixture count byte 0x01→0x02",
    codec_check: "decode_fail",
  },
  {
    id: "V12_v1_duplicate_accounts",
    input: { tx_base64: b64(v1Dup) },
    requirement: "R9 v1 duplicate rejection (docs version matrix)",
    rationale:
      "v1 rejects duplicate static account addresses; legacy/v0 allow them (V05). Parsers that apply one rule set to all versions diverge here.",
    provenance: "derived: dest account bytes replaced by payer bytes in real v1 fixture",
    codec_check: "decode_ok_but_profile_rejects",
  },
  {
    id: "V13_v1_heap_out_of_range",
    input: { tx_base64: b64(v1BadHeap) },
    requirement: "R10 heap bounds (docs: sanitization failure)",
    rationale:
      "v1 heapSize 16384 is below the 32 KiB minimum — a sanitization failure per Solana docs. kit 8.3.0 refuses to BUILD this (client-side validation), so bytes are derived by single-field surgery on the real fixture.",
    provenance: "derived: heap value 65536→16384 in real v1 fixture (kit refuses to emit this)",
    codec_check: "decode_ok_but_profile_rejects",
  },
  {
    id: "V14_malformed_base64",
    input: { tx_base64: "!!!not-base64!!!" },
    requirement: "R2 strict base64",
    rationale: "Non-base64 input must REJECT, not coerce or accept.",
    provenance: "synthetic",
    codec_check: "not_applicable",
  },
  {
    id: "V15_malformed_input_shape",
    input: { wrong_key: "AA==" },
    requirement: "R1 input shape",
    rationale: "Object without exactly the tx_base64 key must REJECT (error-vs-refusal hygiene).",
    provenance: "synthetic",
    codec_check: "not_applicable",
  },
];

// Freeze expected outcomes from the oracle (never from a target).
const vectors = VECTORS.map((v) => {
  const expected = evaluate(v.input);
  return { ...v, expected: { decision: expected.decision, version: expected.version, reason: expected.reason } };
});

// Optional cross-check: kit's decoder must fully decode (envelope AND compiled
// message) every ACCEPT vector's bytes.
if (process.argv.includes("--kit-check")) {
  const { getTransactionDecoder, getCompiledTransactionMessageDecoder } = await import("@solana/kit");
  const txDec = getTransactionDecoder();
  const msgDec = getCompiledTransactionMessageDecoder();
  for (const v of vectors) {
    if (v.codec_check === "not_applicable") continue;
    let ok = false;
    try {
      const tx = txDec.decode(Buffer.from(v.input.tx_base64, "base64"));
      msgDec.decode(tx.messageBytes);
      ok = true;
    } catch {}
    const want = v.codec_check.startsWith("decode_ok");
    if (ok !== want) throw new Error(`kit cross-check FAILED ${v.id}: decoded=${ok} want=${want}`);
  }
  console.log(`kit cross-check OK (${vectors.filter((v) => v.codec_check !== "not_applicable").length} byte vectors)`);
}

const corpus = {
  id: "raven-solana-txversion-demo-corpus/1",
  version: "1.0.0",
  profile: "raven-solana-txversion-experimental/0",
  description:
    "Raven-owned EXPERIMENTAL demo corpus: envelope-level admission of serialized Solana transactions (legacy/v0/v1). Expected outcomes frozen by oracle/oracle.mjs before any target ran. Not an accepted Raven protocol; establishes no on-chain behavior.",
  vectors,
};
const forDigest = {
  id: corpus.id,
  version: corpus.version,
  profile: corpus.profile,
  description: corpus.description,
  vectors: corpus.vectors,
};
corpus.content_digest_sha256 = createHash("sha256")
  .update(JSON.stringify(forDigest, null, 2) + "\n")
  .digest("hex");

writeFileSync(
  new URL("../corpus/raven-solana-txversion-demo-corpus-1.json", import.meta.url),
  JSON.stringify(corpus, null, 2) + "\n"
);
console.log(`wrote ${vectors.length} vectors, digest ${corpus.content_digest_sha256}`);
for (const v of vectors) console.log(` ${v.id}: ${v.expected.decision} ${v.expected.version ?? ""} (${v.expected.reason})`);
