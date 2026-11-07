#!/usr/bin/env node
/*
 * ============================================================================
 *  TEMPLATE — CONNECT YOUR OWN TRANSACTION READER HERE
 * ============================================================================
 *  Copy this file (e.g. to readers/my-reader.mjs), then edit ONLY the
 *  function `classifyTransaction` below. Run:
 *
 *    node apps/raven-reader-check-kit/check-reader.mjs --reader apps/raven-reader-check-kit/readers/my-reader.mjs
 *
 *  Contract (one call per test case, enforced by Raven's existing runner):
 *   - stdin : ONE JSON line, normally {"tx_base64":"<base64 transaction bytes>"}.
 *             Some cases deliberately send malformed input; your reader must REJECT it.
 *   - stdout: ONE JSON line {"decision":"ACCEPT"|"REJECT","version":"legacy"|0|1|null,"reason":"<text>"}
 *             Only "decision" and "version" are compared. "reason" is shown to you but not scored.
 *   - exit code 0. Any other exit code is reported as TARGET_CRASH, not as a difference.
 *   - 3 seconds per case, 256 KiB stdout, 64 KiB stderr.
 *
 *  Reader requirements and execution controls:
 *   - Must be ONE self-contained JavaScript (ESM) file. Bundle dependencies into it
 *     (for example with your own bundler) before running the kit.
 *   - The reader must not depend on child processes, workers, writes, network,
 *     config files or secrets. Do not use paths relative to import.meta.url:
 *     execution uses a captured .mjs copy, not the original path.
 *   - Actual controls are probed and reported. Seatbelt denies network and writes
 *     to the captured reader, but permits broad reads, children/workers and temp
 *     writes. Node permissions deny writes/children/workers and allow reading
 *     only the captured entry; they do NOT deny network.
 *   - Filtered environment variables do not prove the host has no credentials.
 *     Run reviewed readers only in an approved environment without credentials.
 * ============================================================================
 */
import { readFileSync } from "node:fs";

function reject(reason) {
  return { decision: "REJECT", version: null, reason };
}

/**
 * >>> CONNECT YOUR READER HERE <<<
 * @param {Buffer} txBytes decoded transaction bytes
 * @returns {{decision:"ACCEPT"|"REJECT", version:"legacy"|0|1|null, reason:string}}
 */
function classifyTransaction(txBytes) {
  // Replace these two lines with a call into your own (bundled) reader, e.g.
  //   const parsed = myReader.parse(txBytes);
  //   return { decision: "ACCEPT", version: parsed.version, reason: "ok" };
  //   ...and return reject("<why>") when your reader refuses the bytes.
  process.stderr.write("TEMPLATE_NOT_CONNECTED: edit classifyTransaction() in this file\n");
  process.exit(64);
}

// ---- input/output boundary: normally no need to change below this line ----
let out;
try {
  const parsed = JSON.parse(readFileSync(0, "utf8").trim());
  const keys = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? Object.keys(parsed) : [];
  if (keys.length !== 1 || keys[0] !== "tx_base64" || typeof parsed.tx_base64 !== "string") {
    out = reject("malformed_input:keys");
  } else {
    const s = parsed.tx_base64;
    const buf = Buffer.from(s, "base64");
    // strict base64: reject anything that does not round-trip
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s) || buf.toString("base64").replace(/=+$/, "") !== s.replace(/=+$/, "")) {
      out = reject("malformed_base64");
    } else {
      out = classifyTransaction(buf);
    }
  }
} catch (e) {
  out = e instanceof SyntaxError ? reject("malformed_input:json") : reject(`reader_error:${e?.message || e}`);
}
process.stdout.write(JSON.stringify(out) + "\n");
