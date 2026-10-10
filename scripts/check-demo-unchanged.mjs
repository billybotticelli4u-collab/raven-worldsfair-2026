#!/usr/bin/env node
// Proves the judge path is untouched: (1) every file the offline demo and its
// 43 tests depend on is byte-identical to the base commit, and (2) `npm run
// demo` stdout here is byte-identical to the stdout of the base commit's own
// checkout (exported to a temp dir, removed afterwards).
// Usage: node --experimental-strip-types scripts/check-demo-unchanged.mjs [base]
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BASE = process.argv[2] ?? "33f5486b8cff02d05abcded1155dc2bace865242";
const git = (...a) => spawnSync("git", a, { cwd: ROOT, encoding: "utf8" });
// Every file the base commit had in the Agent Trust app (sources, fixtures,
// README, the 7 original test files) plus the demo script and verifier pin.
const GUARDED = [
  "scripts/agent-trust-demo.mjs",
  "vendor/raven-receipt-verifier",
  ".gitmodules",
  ...git("ls-tree", "-r", "--name-only", BASE, "apps/worldsfair-agent-trust").stdout.split("\n").filter(Boolean),
];
const demo = (root) => spawnSync(process.execPath, ["--experimental-strip-types", path.join(root, "scripts/agent-trust-demo.mjs")], {
  cwd: tmpdir(), encoding: "buffer", timeout: 30_000,
});

let ok = true;
const existing = GUARDED.filter((p) => git("cat-file", "-e", `${BASE}:${p}`).status === 0);
const diff = git("diff", "--name-only", BASE, "--", ...existing);
const untracked = git("ls-files", "--others", "--exclude-standard", "--", ...existing);
if (diff.status !== 0 || diff.stdout.trim() !== "" || untracked.stdout.trim() !== "") {
  ok = false;
  console.error(`guarded files differ from ${BASE}:\n${diff.stdout}${untracked.stdout}${diff.stderr}`);
}
const sub = git("ls-tree", BASE, "vendor/raven-receipt-verifier").stdout.split(/\s+/)[2];
const subNow = spawnSync("git", ["-C", "vendor/raven-receipt-verifier", "rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
if (!sub || sub !== subNow) { ok = false; console.error(`verifier pin ${subNow} != base ${sub}`); }

const tmp = mkdtempSync(path.join(tmpdir(), "raven-demo-base-"));
try {
  const archive = spawnSync("sh", ["-c", `git archive ${BASE} | tar -x -C "${tmp}"`], { cwd: ROOT });
  if (archive.status !== 0) throw new Error("git archive failed");
  // The submodule is pinned identically (checked above); reuse its checkout.
  rmSync(path.join(tmp, "vendor/raven-receipt-verifier"), { recursive: true, force: true });
  cpSync(path.join(ROOT, "vendor/raven-receipt-verifier"), path.join(tmp, "vendor/raven-receipt-verifier"), { recursive: true });
  const before = demo(tmp);
  const after = demo(ROOT);
  if (before.status !== 0 || after.status !== 0 || Buffer.compare(before.stdout, after.stdout) !== 0) {
    ok = false;
    console.error(`demo stdout differs or failed: base exit ${before.status}, now exit ${after.status}`);
  } else {
    console.log(`demo stdout byte-identical to ${BASE.slice(0, 8)} (${after.stdout.length} bytes, exit 0)`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log(ok ? `guarded judge-path files unchanged vs ${BASE.slice(0, 8)}: ${existing.length} paths` : "CHECK FAILED");
process.exitCode = ok ? 0 : 1;
