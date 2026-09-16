#!/usr/bin/env node
/**
 * SOL_BROKEN_SUBTLE — Raven-owned demo of the stale pre-v1 parser defect class.
 *
 * Implements legacy/v0 envelope admission CORRECTLY for the formats that
 * existed before SIMD-0385 (2026-09-09 mainnet activation of transaction v1):
 * reads a short-vec signature count at offset zero, tolerates non-minimal
 * short-vec encodings (many real parsers do), and knows only the 0x80 message
 * prefix for v0. It has no knowledge of the v1 envelope, so it misreads every
 * v1 transaction's version byte 0x81 as a short-vec continuation byte.
 *
 * This is the failure mode the Solana docs warn about for consumers that did
 * not opt in to v1 ("Reading it is not [opt-in]"): not malicious, just stale.
 * Not a third-party vulnerability claim — Raven-owned fixture.
 */
import { readFileSync } from "node:fs";

function fail(reason) {
  return { decision: "REJECT", version: null, reason };
}
function pass(version) {
  return { decision: "ACCEPT", version, reason: `ok:${version}` };
}

// Stale short-vec reader: NO minimality check (continuation bytes tolerated).
function readShortVecStale(buf, off) {
  let value = 0;
  let shift = 0;
  let len = 0;
  while (true) {
    if (off + len >= buf.length) throw fail("truncated:shortvec");
    if (len === 3) throw fail("shortvec_too_long");
    const b = buf[off + len];
    value |= (b & 0x7f) << shift;
    len++;
    if ((b & 0x80) === 0) break;
    shift += 7;
  }
  return { value, length: len };
}

function parseMessageStale(buf, msgOff, sigCount, version) {
  if (msgOff + 3 > buf.length) throw fail("truncated:header");
  const numReq = buf[msgOff];
  const numRoS = buf[msgOff + 1];
  const numRoU = buf[msgOff + 2];
  let off = msgOff + 3;
  const acctCount = readShortVecStale(buf, off);
  off += acctCount.length;
  if (off + acctCount.value * 32 > buf.length) throw fail("truncated:accounts");
  off += acctCount.value * 32;
  if (numRoS > numReq) throw fail("header_inconsistent");
  if (numReq > acctCount.value) throw fail("header_inconsistent");
  if (numReq - numRoS + numRoU > acctCount.value) throw fail("header_inconsistent");
  if (sigCount !== numReq) throw fail("signature_count_mismatch");
  if (off + 32 > buf.length) throw fail("truncated:blockhash");
  off += 32;
  const ixCount = readShortVecStale(buf, off);
  off += ixCount.length;
  const idx = [];
  for (let i = 0; i < ixCount.value; i++) {
    if (off >= buf.length) throw fail("truncated:ix");
    const prog = buf[off++];
    const nA = readShortVecStale(buf, off);
    off += nA.length;
    if (off + nA.value > buf.length) throw fail("truncated:ix_accounts");
    const accts = Array.from(buf.subarray(off, off + nA.value));
    off += nA.value;
    const nD = readShortVecStale(buf, off);
    off += nD.length;
    if (off + nD.value > buf.length) throw fail("truncated:ix_data");
    off += nD.value;
    idx.push({ prog, accts });
  }
  let addressable = acctCount.value;
  if (version === 0) {
    const lk = readShortVecStale(buf, off);
    off += lk.length;
    for (let i = 0; i < lk.value; i++) {
      if (off + 32 > buf.length) throw fail("truncated:lookup");
      off += 32;
      const w = readShortVecStale(buf, off);
      off += w.length + w.value;
      const r = readShortVecStale(buf, off);
      off += r.length + r.value;
      addressable += w.value + r.value;
    }
  }
  for (const ix of idx) {
    if (ix.prog >= addressable) throw fail("index_oob");
    for (const a of ix.accts) if (a >= addressable) throw fail("index_oob");
  }
  if (off !== buf.length) throw fail(off < buf.length ? "trailing_bytes" : "truncated");
}

function strictB64(s) {
  if (typeof s !== "string" || s.length === 0 || s.length % 4 !== 0) return null;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s)) return null;
  const buf = Buffer.from(s, "base64");
  if (buf.toString("base64").replace(/=+$/, "") !== s.replace(/=+$/, "")) return null;
  return buf;
}

const raw = readFileSync(0, "utf8").trim();
let out;
try {
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw fail("malformed_input:not_object");
  const keys = Object.keys(parsed);
  if (keys.length !== 1 || keys[0] !== "tx_base64") throw fail("malformed_input:keys");
  const buf = strictB64(parsed.tx_base64);
  if (!buf) throw fail("malformed_base64");
  if (buf.length === 0) throw fail("truncated:empty");
  if (buf.length > 1232) throw fail("too_large");
  // STALE ENVELOPE: first byte is always a signature count. No v1 knowledge.
  const sigCount = readShortVecStale(buf, 0);
  const sigBytes = sigCount.length;
  if (sigBytes + sigCount.value * 64 > buf.length) throw fail("truncated:signatures");
  const msgStart = sigBytes + sigCount.value * 64;
  if (msgStart >= buf.length) throw fail("truncated:message");
  const m0 = buf[msgStart];
  if (m0 === 0x80) {
    parseMessageStale(buf, msgStart + 1, sigCount.value, 0);
    out = pass(0);
  } else if (m0 & 0x80) {
    throw fail(`unsupported_message_version:${m0 & 0x7f}`);
  } else {
    parseMessageStale(buf, msgStart, sigCount.value, "legacy");
    out = pass("legacy");
  }
} catch (e) {
  if (e && e.decision === "REJECT") out = e;
  else if (e instanceof SyntaxError) out = fail("malformed_input:json");
  else throw e;
}
process.stdout.write(JSON.stringify(out) + "\n");
