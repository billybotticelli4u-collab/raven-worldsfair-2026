#!/usr/bin/env node
/**
 * SOL_CONFORMANT_REFERENCE — correct raven-solana-txversion-experimental/0 target.
 * Raven-owned demo target. Cursor-style reader; deliberately different in
 * structure from oracle/oracle.mjs. Offline byte-structure admission only:
 * no signature verification, no network, no chain state.
 */

function fail(reason) {
  return { decision: "REJECT", version: null, reason };
}
function pass(version) {
  return { decision: "ACCEPT", version, reason: `ok:${version}` };
}

class Cursor {
  constructor(buf) {
    this.buf = buf;
    this.off = 0;
  }
  u8(what) {
    if (this.off + 1 > this.buf.length) throw fail(`truncated:${what}`);
    return this.buf[this.off++];
  }
  u16le(what) {
    if (this.off + 2 > this.buf.length) throw fail(`truncated:${what}`);
    const v = this.buf.readUInt16LE(this.off);
    this.off += 2;
    return v;
  }
  u32le(what) {
    if (this.off + 4 > this.buf.length) throw fail(`truncated:${what}`);
    const v = this.buf.readUInt32LE(this.off);
    this.off += 4;
    return v;
  }
  bytes(n, what) {
    if (this.off + n > this.buf.length) throw fail(`truncated:${what}`);
    const b = this.buf.subarray(this.off, this.off + n);
    this.off += n;
    return b;
  }
  shortvec(what) {
    const start = this.off;
    let value = 0;
    let shift = 0;
    for (let i = 0; i < 3; i++) {
      const b = this.u8(what);
      value |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) {
        const len = this.off - start;
        if (len > 1 && this.buf[this.off - 1] === 0) throw fail("non_canonical_shortvec:non_minimal");
        if (value < 0x80 && len !== 1) throw fail("non_canonical_shortvec:non_minimal");
        if (value < 0x4000 && len > 2) throw fail("non_canonical_shortvec:non_minimal");
        return value;
      }
      shift += 7;
    }
    throw fail("non_canonical_shortvec:exceeds_u16");
  }
  done() {
    if (this.off !== this.buf.length)
      throw fail(this.off < this.buf.length ? "trailing_bytes" : "truncated");
  }
}

function header(c, accountCount) {
  const numReq = c.u8("header");
  const numRoS = c.u8("header");
  const numRoU = c.u8("header");
  // SIMD-0385 / Agave sanitize: num_readonly_signed >= num_required_signatures
  // fails (equality would make the fee payer readonly).
  if (numRoS >= numReq) throw fail("header_inconsistent:ro_signed_gte_req");
  if (numReq > accountCount) throw fail("header_inconsistent:req_sig_gt_accounts");
  if (numReq - numRoS + numRoU > accountCount) throw fail("header_inconsistent:writable_unsigned_overflow");
  return { numReq, numRoS, numRoU };
}

function parseLegacyOrV0(buf, msgOff, sigCount, version) {
  const c = new Cursor(buf);
  c.off = msgOff;
  const { numReq } = header(c, Infinity); // account count not yet known; checked below
  const accountCount = c.shortvec("accounts");
  const accounts = c.bytes(accountCount * 32, "accounts");
  // header consistency vs account count
  const [numReqSig, numRoS, numRoU] = [buf[msgOff], buf[msgOff + 1], buf[msgOff + 2]];
  if (numRoS >= numReqSig) throw fail("header_inconsistent:ro_signed_gte_req");
  if (numReqSig > accountCount) throw fail("header_inconsistent:req_sig_gt_accounts");
  if (numReqSig - numRoS + numRoU > accountCount) throw fail("header_inconsistent:writable_unsigned_overflow");
  if (sigCount !== numReq) throw fail(`signature_count_mismatch:${sigCount}!=${numReq}`);
  c.bytes(32, "blockhash");
  const ixCount = c.shortvec("instructions");
  const indexes = [];
  for (let i = 0; i < ixCount; i++) {
    const prog = c.u8("ix_program");
    const nA = c.shortvec("ix_accounts");
    const accts = Array.from(c.bytes(nA, "ix_accounts"));
    const nD = c.shortvec("ix_data");
    c.bytes(nD, "ix_data");
    indexes.push({ prog, accts });
  }
  let addressable = accountCount;
  if (version === 0) {
    const lk = c.shortvec("lookup_tables");
    for (let i = 0; i < lk; i++) {
      c.bytes(32, "lookup_table_key");
      const w = c.shortvec("lookup_writable");
      c.bytes(w, "lookup_writable");
      const r = c.shortvec("lookup_readonly");
      c.bytes(r, "lookup_readonly");
      addressable += w + r;
    }
  }
  for (const ix of indexes) {
    if (ix.prog >= addressable) throw fail("account_index_out_of_bounds:program");
    for (const a of ix.accts) if (a >= addressable) throw fail("account_index_out_of_bounds:account");
  }
  c.done();
}

function parseV1(buf) {
  if (buf.length > 4096) throw fail("size_cap_exceeded:v1>4096");
  const c = new Cursor(buf);
  c.off = 1; // version byte consumed by envelope
  const numReq = c.u8("header");
  const numRoS = c.u8("header");
  const numRoU = c.u8("header");
  const mask = c.u32le("config_mask");
  if ((mask & 3) === 1 || (mask & 3) === 2) throw fail("config_mask_invalid:partial_fee_bits");
  if (mask & ~0b11111) throw fail("config_mask_invalid:unknown_bits");
  c.bytes(32, "lifetime_token");
  const numIx = c.u8("num_instructions");
  const numStatic = c.u8("num_static_accounts");
  // SIMD-0385 Transaction Constraints (v1)
  if (numReq > 12) throw fail("constraint_cap_exceeded:signatures>12");
  if (numStatic > 64) throw fail("constraint_cap_exceeded:addresses>64");
  if (numIx > 64) throw fail("constraint_cap_exceeded:instructions>64");
  const accounts = [];
  for (let i = 0; i < numStatic; i++) accounts.push(c.bytes(32, "static_accounts").toString("hex"));
  if (numRoS >= numReq) throw fail("header_inconsistent:ro_signed_gte_req");
  if (numReq > numStatic) throw fail("header_inconsistent:req_sig_gt_accounts");
  if (numReq - numRoS + numRoU > numStatic) throw fail("header_inconsistent:writable_unsigned_overflow");
  if (new Set(accounts).size !== accounts.length) throw fail("duplicate_static_accounts");
  if (mask & 3) c.bytes(8, "config_fee");
  if (mask & 4) c.u32le("config_cu");
  if (mask & 8) c.u32le("config_loaded");
  if (mask & 16) {
    const heap = c.u32le("config_heap");
    if (heap < 32768 || heap > 262144 || heap % 1024 !== 0) throw fail(`config_heap_out_of_range:${heap}`);
  }
  // GROUPED layout (SIMD-0385): all InstructionHeaders first ...
  const headers = [];
  for (let i = 0; i < numIx; i++) {
    const prog = c.u8("ix_header_program");
    const nA = c.u8("ix_header_num_accounts");
    const nD = c.u16le("ix_header_num_data_bytes");
    if (prog >= numStatic) throw fail("account_index_out_of_bounds:program");
    headers.push({ nA, nD });
  }
  // ... then all InstructionPayloads concatenated
  for (const h of headers) {
    const accts = Array.from(c.bytes(h.nA, "ix_accounts"));
    c.bytes(h.nD, "ix_data");
    for (const a of accts) if (a >= numStatic) throw fail("account_index_out_of_bounds:account");
  }
  // signature tail: exactly numReq x 64 bytes, count implicit in header
  c.bytes(numReq * 64, "v1_signatures");
  c.done();
}

export function decide(buf) {
  if (buf.length === 0) throw fail("truncated:empty");
  const b0 = buf[0];
  if (b0 === 0x81) {
    parseV1(buf);
    return pass(1);
  }
  if (b0 >= 0x80) return fail(`unsupported_version:tx_offset0_${b0 & 0x7f}`);
  if (buf.length > 1232) throw fail("size_cap_exceeded:legacy_v0>1232");
  const c = new Cursor(buf);
  const sigCount = c.shortvec("signature_count");
  c.bytes(sigCount * 64, "signatures");
  const m0 = c.u8("message_prefix");
  if (m0 === 0x80) {
    parseLegacyOrV0(buf, c.off, sigCount, 0);
    return pass(0);
  }
  if (m0 & 0x80) return fail(`unsupported_version:msg_${m0 & 0x7f}`);
  parseLegacyOrV0(buf, c.off - 1, sigCount, "legacy");
  return pass("legacy");
}

function strictB64(s) {
  if (typeof s !== "string" || s.length === 0 || s.length % 4 !== 0) return null;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s)) return null;
  const buf = Buffer.from(s, "base64");
  if (buf.toString("base64").replace(/=+$/, "") !== s.replace(/=+$/, "")) return null;
  return buf;
}

import { readFileSync } from "node:fs";
const raw = readFileSync(0, "utf8").trim();
let out;
try {
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw fail("malformed_input:not_object");
  const keys = Object.keys(parsed);
  if (keys.length !== 1 || keys[0] !== "tx_base64") throw fail("malformed_input:keys");
  const buf = strictB64(parsed.tx_base64);
  if (!buf) throw fail("malformed_base64");
  out = decide(buf);
} catch (e) {
  if (e && e.decision === "REJECT") out = e;
  else if (e instanceof SyntaxError) out = fail("malformed_input:json");
  else throw e;
}
process.stdout.write(JSON.stringify(out) + "\n");
