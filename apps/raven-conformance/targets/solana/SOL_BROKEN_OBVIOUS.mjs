#!/usr/bin/env node
/**
 * SOL_BROKEN_OBVIOUS — intentional straightforward contract violation.
 * Accepts anything that base64-decodes; classifies by first byte only.
 * Raven-owned demo target (not a third-party system).
 */
import { readFileSync } from "node:fs";

const raw = readFileSync(0, "utf8").trim();
let out;
try {
  const parsed = JSON.parse(raw);
  const s = parsed && typeof parsed === "object" ? parsed.tx_base64 : undefined;
  const buf = typeof s === "string" ? Buffer.from(s, "base64") : null;
  if (!buf || buf.length === 0) {
    out = { decision: "REJECT", version: null, reason: "cannot_decode" };
  } else {
    const version = buf[0] === 0x81 ? 1 : "legacy";
    out = { decision: "ACCEPT", version, reason: `ok:${version}` };
  }
} catch {
  out = { decision: "REJECT", version: null, reason: "cannot_decode" };
}
process.stdout.write(JSON.stringify(out) + "\n");
