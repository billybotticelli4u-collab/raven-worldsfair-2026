import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const ALLOWED = new Set(["schema", "id", "payload", "digest"]);
const SCHEMA = "raven-canonical-envelope/1";

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]));
  }
  return value;
}

function digest(payload, mutation) {
  const text = mutation === "HASH_INSERTION_ORDER"
    ? JSON.stringify(payload)
    : JSON.stringify(sortKeys(payload));
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function decide(envelope, mutation) {
  if (mutation === "REFUSE_EVERYTHING") return { decision: "REJECT", reason: "mutant_refuse_all" };
  if (mutation === "ACCEPT_EVERYTHING") return { decision: "ACCEPT", reason: "mutant_accept_all" };
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    return { decision: "REJECT", reason: "envelope_not_object" };
  }
  if (mutation !== "ALLOW_EXTRA_FIELDS") {
    for (const key of Object.keys(envelope)) {
      if (!ALLOWED.has(key)) return { decision: "REJECT", reason: `unexpected_top_level_field:${key}` };
    }
  }
  const required = mutation === "ALLOW_MISSING_DIGEST"
    ? ["schema", "id", "payload"]
    : [...ALLOWED];
  for (const key of required) {
    if (!(key in envelope)) return { decision: "REJECT", reason: `missing_required:${key}` };
  }
  if (mutation !== "IGNORE_SCHEMA" && envelope.schema !== SCHEMA) {
    return { decision: "REJECT", reason: "schema_mismatch" };
  }
  if (mutation !== "ALLOW_INVALID_ID" && (typeof envelope.id !== "string" || envelope.id.length === 0)) {
    return { decision: "REJECT", reason: "id_invalid" };
  }
  const payloadIsObject = envelope.payload && typeof envelope.payload === "object";
  const payloadAllowed = mutation === "ALLOW_ARRAY_PAYLOAD"
    ? payloadIsObject
    : payloadIsObject && !Array.isArray(envelope.payload);
  if (!payloadAllowed) return { decision: "REJECT", reason: "payload_not_object" };
  if (mutation === "ALLOW_MISSING_DIGEST" && !("digest" in envelope)) {
    return { decision: "ACCEPT", reason: "mutant_missing_digest_allowed" };
  }
  if (mutation !== "IGNORE_DIGEST" && envelope.digest !== digest(envelope.payload, mutation)) {
    return { decision: "REJECT", reason: "digest_mismatch" };
  }
  return { decision: "ACCEPT", reason: mutation === "REFERENCE" ? "canonical_envelope_ok" : `mutant_${mutation.toLowerCase()}` };
}

export function run(mutation) {
  const raw = readFileSync(0, "utf8").trim();
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    process.stdout.write(`${JSON.stringify({ decision: "REJECT", reason: "invalid_json" })}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(decide(input, mutation))}\n`);
}
