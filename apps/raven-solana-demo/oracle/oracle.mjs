/**
 * ORACLE — raven-solana-txversion-experimental/0
 *
 * Independent, spec-arithmetic implementation of the experimental profile.
 * Written directly from the profile rules + cited sources (Solana docs,
 * SIMD-0385 description, @solana/kit 8.3.0 v1 codec source). It never runs
 * or imports any target. Used to FREEZE corpus expected outcomes before
 * targets are measured (fixtures/build-corpus.mjs asserts agreement).
 *
 * Style note: declarative offset arithmetic with explicit failure objects,
 * deliberately different in structure from targets/SOL_CONFORMANT_REFERENCE.mjs
 * (cursor style). Both are Raven-authored — independence is structural and
 * cross-checked against @solana/kit's own decoder for ACCEPT vectors
 * (see fixtures/build-corpus.mjs), not authorship-independent.
 */

const REASON = {
  OK: "ok",
  MALFORMED_INPUT: "malformed_input",
  MALFORMED_BASE64: "malformed_base64",
  UNSUPPORTED_VERSION: "unsupported_version",
  NONCANONICAL_SHORTVEC: "non_canonical_shortvec",
  TRUNCATED: "truncated",
  TRAILING: "trailing_bytes",
  HEADER: "header_inconsistent",
  SIGCOUNT: "signature_count_mismatch",
  INDEX_OOB: "account_index_out_of_bounds",
  DUP_ACCOUNTS: "duplicate_static_accounts",
  CONFIG_MASK: "config_mask_invalid",
  HEAP: "config_heap_out_of_range",
  SIZE: "size_cap_exceeded",
};

function reject(reason, detail) {
  return { decision: "REJECT", version: null, reason: detail ? `${reason}:${detail}` : reason };
}
function accept(version) {
  return { decision: "ACCEPT", version, reason: `ok:${version}` };
}

/** Strict RFC 4648 base64 decode; null on failure. */
function decodeBase64(s) {
  if (typeof s !== "string" || s.length === 0 || s.length % 4 !== 0) return null;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s)) return null;
  if (s.includes("=") && !/=+$/.test(s.slice(-2))) return null;
  const buf = Buffer.from(s, "base64");
  // round-trip check: re-encoding must reproduce input modulo padding
  const re = buf.toString("base64");
  if (re !== s && re !== s.replace(/=+$/, "") && re + "=" !== s && re + "==" !== s) return null;
  if (re.replace(/=+$/, "") !== s.replace(/=+$/, "")) return null;
  return buf;
}

/**
 * Canonical short-vec (compact-u16) read at offset. Returns
 * { value, length } or throws { reason } — minimal encoding enforced.
 */
function readShortVec(buf, off) {
  let value = 0;
  let shift = 0;
  let len = 0;
  while (true) {
    if (off + len >= buf.length) throw reject(REASON.TRUNCATED, "shortvec");
    if (len === 3) throw reject(REASON.NONCANONICAL_SHORTVEC, "exceeds_u16");
    const b = buf[off + len];
    value |= (b & 0x7f) << shift;
    len++;
    if ((b & 0x80) === 0) break;
    shift += 7;
  }
  // minimality: a multi-byte encoding must have a non-zero final byte,
  // and single-byte range values must use one byte.
  if (len > 1 && buf[off + len - 1] === 0) throw reject(REASON.NONCANONICAL_SHORTVEC, "non_minimal");
  if (len === 1 && value > 0x7f) throw reject(REASON.NONCANONICAL_SHORTVEC, "impossible");
  if (value < 0x80 && len !== 1) throw reject(REASON.NONCANONICAL_SHORTVEC, "non_minimal");
  if (value < 0x4000 && len > 2) throw reject(REASON.NONCANONICAL_SHORTVEC, "non_minimal");
  return { value, length: len };
}

function need(buf, off, n, what) {
  if (off + n > buf.length) throw reject(REASON.TRUNCATED, what);
}

function checkHeader(numReqSig, numRoSigned, numRoUnsigned, accountCount) {
  if (numRoSigned > numReqSig) throw reject(REASON.HEADER, "ro_signed_gt_req");
  if (numReqSig > accountCount) throw reject(REASON.HEADER, "req_sig_gt_accounts");
  if (numReqSig - numRoSigned + numRoUnsigned > accountCount)
    throw reject(REASON.HEADER, "writable_unsigned_overflow");
}

function isDup(accounts) {
  const seen = new Set(accounts.map((a) => Buffer.from(a).toString("hex")));
  return seen.size !== accounts.length;
}

/** legacy/v0 message parse. msgOff = offset of message start. */
function parseLegacyV0Message(buf, msgOff, sigCount, version) {
  need(buf, msgOff, 3, "header");
  const [numReqSig, numRoSigned, numRoUnsigned] = [buf[msgOff], buf[msgOff + 1], buf[msgOff + 2]];
  let off = msgOff + 3;
  const acctCount = readShortVec(buf, off);
  off += acctCount.length;
  need(buf, off, acctCount.value * 32, "accounts");
  const accounts = [];
  for (let i = 0; i < acctCount.value; i++) {
    accounts.push(buf.subarray(off + i * 32, off + (i + 1) * 32));
  }
  off += acctCount.value * 32;
  checkHeader(numReqSig, numRoSigned, numRoUnsigned, acctCount.value);
  if (sigCount !== numReqSig) throw reject(REASON.SIGCOUNT, `${sigCount}!=${numReqSig}`);
  need(buf, off, 32, "blockhash");
  off += 32;
  const ixCount = readShortVec(buf, off);
  off += ixCount.length;
  // v0: account indexes may reference lookup-loaded addresses; compute after lookups parsed.
  const ixSpans = [];
  for (let i = 0; i < ixCount.value; i++) {
    need(buf, off, 1, "ix_program");
    const progIdx = buf[off];
    off += 1;
    const accts = readShortVec(buf, off);
    off += accts.length;
    need(buf, off, accts.value, "ix_accounts");
    const acctIdx = Array.from(buf.subarray(off, off + accts.value));
    off += accts.value;
    const data = readShortVec(buf, off);
    off += data.length;
    need(buf, off, data.value, "ix_data");
    off += data.value;
    ixSpans.push({ progIdx, acctIdx });
  }
  let totalAddressable = acctCount.value;
  if (version === 0) {
    const lkCount = readShortVec(buf, off);
    off += lkCount.length;
    for (let i = 0; i < lkCount.value; i++) {
      need(buf, off, 32, "lookup_table_key");
      off += 32;
      const w = readShortVec(buf, off);
      off += w.length;
      need(buf, off, w.value, "lookup_writable");
      // writable index values reference the table; not bound-checked offline
      off += w.value;
      const r = readShortVec(buf, off);
      off += r.length;
      need(buf, off, r.value, "lookup_readonly");
      off += r.value;
      totalAddressable += w.value + r.value;
    }
  }
  for (const ix of ixSpans) {
    if (ix.progIdx >= totalAddressable) throw reject(REASON.INDEX_OOB, "program");
    for (const a of ix.acctIdx) {
      if (a >= totalAddressable) throw reject(REASON.INDEX_OOB, "account");
    }
  }
  if (off !== buf.length) throw reject(off < buf.length ? REASON.TRAILING : REASON.TRUNCATED);
}

/** v1 parse (SIMD-0385 layout as implemented by @solana/kit 8.3.0). */
function parseV1(buf) {
  if (buf.length > 4096) throw reject(REASON.SIZE, "v1>4096");
  need(buf, 0, 1 + 3 + 4 + 32 + 1 + 1, "v1_head");
  // [0] = 0x81 already established
  const [numReqSig, numRoSigned, numRoUnsigned] = [buf[1], buf[2], buf[3]];
  const mask = buf.readUInt32LE(4);
  if ((mask & 3) === 1 || (mask & 3) === 2) throw reject(REASON.CONFIG_MASK, "partial_fee_bits");
  if (mask & ~0b11111) throw reject(REASON.CONFIG_MASK, "unknown_bits");
  let off = 8;
  off += 32; // lifetimeToken
  const numInstructions = buf[off];
  off += 1;
  const numStatic = buf[off];
  off += 1;
  need(buf, off, numStatic * 32, "v1_static_accounts");
  const accounts = [];
  for (let i = 0; i < numStatic; i++) accounts.push(buf.subarray(off + i * 32, off + (i + 1) * 32));
  off += numStatic * 32;
  checkHeader(numReqSig, numRoSigned, numRoUnsigned, numStatic);
  if (isDup(accounts)) throw reject(REASON.DUP_ACCOUNTS);
  // config values: positional, field order [fee u64][cu u32][loaded u32][heap u32]
  let heap = null;
  if (mask & 3) {
    need(buf, off, 8, "config_fee");
    off += 8;
  }
  if (mask & 4) {
    need(buf, off, 4, "config_cu");
    off += 4;
  }
  if (mask & 8) {
    need(buf, off, 4, "config_loaded");
    off += 4;
  }
  if (mask & 16) {
    need(buf, off, 4, "config_heap");
    heap = buf.readUInt32LE(off);
    off += 4;
  }
  if (heap !== null && (heap < 32768 || heap > 262144 || heap % 1024 !== 0))
    throw reject(REASON.HEAP, String(heap));
  for (let i = 0; i < numInstructions; i++) {
    need(buf, off, 4, "v1_ix_header");
    const progIdx = buf[off];
    const numAcct = buf[off + 1];
    const numData = buf.readUInt16LE(off + 2);
    off += 4;
    need(buf, off, numAcct, "v1_ix_accounts");
    const acctIdx = Array.from(buf.subarray(off, off + numAcct));
    off += numAcct;
    need(buf, off, numData, "v1_ix_data");
    off += numData;
    if (progIdx >= numStatic) throw reject(REASON.INDEX_OOB, "program");
    for (const a of acctIdx) if (a >= numStatic) throw reject(REASON.INDEX_OOB, "account");
  }
  const sigs = { value: numReqSig }; // v1 tail: sig count is implicit = header.num_required_signatures
  need(buf, off, sigs.value * 64, "v1_signatures");
  off += sigs.value * 64;
  if (off !== buf.length) throw reject(off < buf.length ? REASON.TRAILING : REASON.TRUNCATED);
}

/** Main entry: parsed input object → { decision, version, reason }. */
export function evaluate(input) {
  try {
    if (!input || typeof input !== "object" || Array.isArray(input))
      return reject(REASON.MALFORMED_INPUT, "not_object");
    const keys = Object.keys(input);
    if (keys.length !== 1 || keys[0] !== "tx_base64")
      return reject(REASON.MALFORMED_INPUT, "keys");
    const buf = decodeBase64(input.tx_base64);
    if (!buf) return reject(REASON.MALFORMED_BASE64);
    if (buf.length === 0) return reject(REASON.TRUNCATED, "empty");

    if (buf[0] === 0x81) {
      parseV1(buf);
      return accept(1);
    }
    if (buf[0] >= 0x80) {
      return reject(REASON.UNSUPPORTED_VERSION, `tx_offset0_${buf[0] & 0x7f}`);
    }
    // legacy/v0 family: sig-count-first envelope
    if (buf.length > 1232) return reject(REASON.SIZE, "legacy_v0>1232");
    const sigCount = readShortVec(buf, 0);
    const msgOff = sigCount.length;
    need(buf, msgOff, sigCount.value * 64, "signatures");
    const msgStart = msgOff + sigCount.value * 64;
    need(buf, msgStart, 1, "message");
    const m0 = buf[msgStart];
    if (m0 === 0x80) {
      parseLegacyV0Message(buf, msgStart + 1, sigCount.value, 0);
      return accept(0);
    }
    if (m0 & 0x80) return reject(REASON.UNSUPPORTED_VERSION, `msg_${m0 & 0x7f}`);
    parseLegacyV0Message(buf, msgStart, sigCount.value, "legacy");
    return accept("legacy");
  } catch (e) {
    if (e && e.decision === "REJECT") return e;
    throw e;
  }
}

// CLI: read one JSON line on stdin, print oracle verdict (for freezing/debug).
if (import.meta.url === `file://${process.argv[1]}`) {
  const raw = (await import("node:fs")).readFileSync(0, "utf8");
  process.stdout.write(JSON.stringify(evaluate(JSON.parse(raw.trim()))) + "\n");
}
