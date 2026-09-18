#!/usr/bin/env node
/**
 * BROKEN_SUBTLE — historically realistic verifier-class defect demo.
 * Accepts unexpected top-level fields (non-canonical key acceptance /
 * unexpected top-level field tolerance — #212-class behavior as a
 * Raven-owned demo target). Still checks schema, id, payload, digest.
 * Do NOT characterize as a vulnerability in third-party systems.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const SCHEMA = "raven-canonical-envelope/1";

function canonicalJson(value) {
  return JSON.stringify(sortKeys(value));
}
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out = Object.create(null);
    for (const key of Object.keys(value).sort()) out[key] = sortKeys(value[key]);
    return out;
  }
  return value;
}
function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function decide(envelope) {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    return { decision: "REJECT", reason: "envelope_not_object" };
  }
  // DEFECT: does NOT reject unexpected top-level fields.
  for (const req of ["schema", "id", "payload", "digest"]) {
    if (!(req in envelope)) return { decision: "REJECT", reason: `missing_required:${req}` };
  }
  if (envelope.schema !== SCHEMA) return { decision: "REJECT", reason: "schema_mismatch" };
  if (typeof envelope.id !== "string" || envelope.id.length === 0) {
    return { decision: "REJECT", reason: "id_invalid" };
  }
  if (!envelope.payload || typeof envelope.payload !== "object" || Array.isArray(envelope.payload)) {
    return { decision: "REJECT", reason: "payload_not_object" };
  }
  const expected = sha256Hex(canonicalJson(envelope.payload));
  if (envelope.digest !== expected) return { decision: "REJECT", reason: "digest_mismatch" };
  return { decision: "ACCEPT", reason: "subtle_accepts_extra_fields" };
}

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
process.stdout.write(JSON.stringify(decide(parsed)) + "\n");
