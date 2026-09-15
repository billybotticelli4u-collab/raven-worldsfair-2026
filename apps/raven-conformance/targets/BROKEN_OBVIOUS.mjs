#!/usr/bin/env node
/**
 * BROKEN_OBVIOUS — intentional straightforward contract violation.
 * Always ACCEPTS any parseable JSON object (ignores schema/digest/keys).
 * Raven-owned demo target — not a third-party vulnerability.
 */
import { readFileSync } from "node:fs";

function readInput() {
  if (process.argv[2]) return readFileSync(process.argv[2], "utf8");
  return readFileSync(0, "utf8");
}

const raw = readInput().trim();
let parsed;
try {
  parsed = JSON.parse(raw);
} catch {
  process.stdout.write(JSON.stringify({ decision: "REJECT", reason: "invalid_json" }) + "\n");
  process.exit(0);
}
if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
  process.stdout.write(JSON.stringify({ decision: "REJECT", reason: "envelope_not_object" }) + "\n");
  process.exit(0);
}
// Intentional divergence: accept without checking schema, digest, or allowed keys.
process.stdout.write(JSON.stringify({ decision: "ACCEPT", reason: "broken_obvious_unconditional_accept" }) + "\n");
