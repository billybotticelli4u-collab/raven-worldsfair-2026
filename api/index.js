/**
 * Vercel entry for apps/raven-conformance.
 * DEFECT A-1: validate RAVEN_CONFORMANCE_RUNTIME_ROOT before any fs mutation.
 */
import { cpSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertRuntimeRootWritable, resolveRuntimeRoot } from "./runtime-root-guard.mjs";

const SOURCE_ROOT = path.resolve(fileURLToPath(new URL("../apps/raven-conformance/", import.meta.url)));
const REPO_ROOT = path.resolve(SOURCE_ROOT, "..", "..");
const SKIP_TOP_LEVEL = new Set(["evidence", "test", "node_modules"]);

const RUNTIME_ROOT = resolveRuntimeRoot({
  env: process.env,
  sourceRoot: SOURCE_ROOT,
  repoRoot: REPO_ROOT,
  tmpdir: os.tmpdir(),
});

assertRuntimeRootWritable(RUNTIME_ROOT);

rmSync(RUNTIME_ROOT, { recursive: true, force: true });
cpSync(SOURCE_ROOT, RUNTIME_ROOT, {
  recursive: true,
  filter: (src) => !SKIP_TOP_LEVEL.has(path.relative(SOURCE_ROOT, src).split(path.sep)[0]),
});
mkdirSync(path.join(RUNTIME_ROOT, "reports"), { recursive: true });

await import(pathToFileURL(path.join(RUNTIME_ROOT, "src", "server.js")).href);
