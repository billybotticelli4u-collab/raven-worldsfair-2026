#!/usr/bin/env node
/**
 * Artifact-sealing procedure gate (INTEGRATION-LANE / Fair path).
 * Runs exportable-cleanliness against the package directory or file list
 * being sealed. NOT wired into npm product build, CI, or Fair tip promote.
 *
 * Usage:
 *   node scripts/artifact-sealing.mjs [--allowlist FILE] <package-dir-or-file> [...]
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const checker = path.join(here, "check-exportable-cleanliness.mjs");
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error(
    "Usage: node scripts/artifact-sealing.mjs [--allowlist FILE] <package-dir-or-file> [...]",
  );
  process.exit(2);
}
console.log("artifact-sealing: running exportable-cleanliness gate…");
const r = spawnSync(process.execPath, [checker, ...args], { stdio: "inherit" });
process.exit(r.status ?? 2);
