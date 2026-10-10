/** Canonical JSON + SHA-256 using the pinned verifier's own canonicalizer. */
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const VERIFY_JS_ENTRY = fileURLToPath(
  new URL(
    "../../../../vendor/raven-receipt-verifier/packages/verify-js/src/index.ts",
    import.meta.url,
  ),
);

let cached = null;
export async function loadPinnedVerifier() {
  if (!cached) cached = await import(VERIFY_JS_ENTRY);
  return cached;
}

export async function sha256Canonical(value) {
  const { canonicalJson } = await loadPinnedVerifier();
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}
