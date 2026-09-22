#!/usr/bin/env node
/**
 * Evidence-handoff procedure gate (INTEGRATION-LANE / Fair path).
 * Runs exportable-cleanliness against evidence / handoff directories before
 * handoff. NOT wired into npm product build, CI, or Fair tip promote.
 *
 * Usage:
 *   node scripts/evidence-handoff.mjs [--allowlist FILE] <evidence-dir-or-file> [...]
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const checker = path.join(here, "check-exportable-cleanliness.mjs");
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error(
    "Usage: node scripts/evidence-handoff.mjs [--allowlist FILE] <evidence-dir-or-file> [...]",
  );
  process.exit(2);
}
console.log("evidence-handoff: running exportable-cleanliness gate…");
const r = spawnSync(process.execPath, [checker, ...args], { stdio: "inherit" });
process.exit(r.status ?? 2);
