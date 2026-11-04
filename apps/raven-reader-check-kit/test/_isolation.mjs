// Test-only isolation helpers (not a test file; not matched by *.test.mjs).
// Every run id a test passes is suffixed with this suite invocation's pid and a
// random nonce, so parallel test files and overlapping suite invocations never
// share a run-owned snapshot path. Cleanup/leak checks inspect only the exact
// snapshot paths a test owns; unrelated live snapshots are neither counted nor
// touched.
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import assert from "node:assert/strict";

export const RUN_NONCE = `${process.pid}-${randomBytes(4).toString("hex")}`;
export const ownedId = (label) => `${label}-${RUN_NONCE}`;

// Leak check for the exact snapshot folders a test owns. Throws if any remains.
export function assertNoOwnedSnapshot(paths, message = "owned snapshot left behind") {
  const leaked = paths.filter((p) => existsSync(p));
  assert.deepEqual(leaked, [], message);
}
