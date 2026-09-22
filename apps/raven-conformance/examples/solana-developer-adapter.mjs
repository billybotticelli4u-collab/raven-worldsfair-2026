#!/usr/bin/env node
/**
 * Process-adapter example for raven-solana-txversion-experimental/0.
 *
 * Replace IMPLEMENTATION_ENTRY with a developer-owned JSON-line classifier.
 * The runner supplies exactly one input object and expects exactly one output
 * object. This working example delegates to the bundled reference target while
 * preserving exit status, stdout, and stderr.
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const IMPLEMENTATION_ENTRY = fileURLToPath(
  new URL("../targets/solana/SOL_CONFORMANT_REFERENCE.mjs", import.meta.url),
);
const input = readFileSync(0);
const result = spawnSync(process.execPath, [IMPLEMENTATION_ENTRY], {
  input,
  encoding: null,
  env: {},
  timeout: 3000,
  maxBuffer: 64 * 1024,
});

if (result.error) {
  process.stderr.write(`adapter_error:${result.error.code || result.error.message}\n`);
  process.exitCode = 70;
} else {
  if (result.stdout?.length) process.stdout.write(result.stdout);
  if (result.stderr?.length) process.stderr.write(result.stderr);
  process.exitCode = result.status ?? 70;
}
