import { createHash } from "node:crypto";

/** Canonical JSON: sorted object keys, arrays preserve order, no whitespace. */
export function canonicalJson(value) {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out = Object.create(null);
    for (const key of Object.keys(value).sort()) {
      out[key] = sortKeys(value[key]);
    }
    return out;
  }
  return value;
}

export function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function payloadDigest(payload) {
  return sha256Hex(canonicalJson(payload));
}
