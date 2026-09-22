#!/usr/bin/env node
/**
 * Run adversarial bypass corpus against check-exportable-cleanliness.mjs.
 * Prints a results table. Exit 1 if any decided vector mismatches expectedExit.
 * UNDECIDED vectors are reported but do not fail the runner.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "fixtures/exportable-cleanliness/bypass-corpus");
const checker = path.join(here, "check-exportable-cleanliness.mjs");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const defaultAl = path.resolve(path.join(here, ".."), manifest.defaultAllowlist.replace(/^\.\.\//, "").includes("scripts/")
  ? path.join(here, "..") // unused
  : ".");
// Resolve allowlist relative to repo root (parent of scripts/)
const repoRoot = path.join(here, "..");
const allowlistPath = path.join(repoRoot, manifest.defaultAllowlist);

const rows = [];
let fail = 0;
let undecided = 0;

for (const v of manifest.vectors) {
  const artifact = path.join(root, v.file);
  const args = [checker];
  if (v.allowlist !== false) {
    const al = typeof v.allowlist === "string" ? path.join(repoRoot, v.allowlist) : allowlistPath;
    args.push("--allowlist", al);
  }
  args.push(artifact);
  const r = spawnSync(process.execPath, args, { encoding: "utf8" });
  const actual = r.status ?? 2;
  const match = actual === v.expectedExit;
  let status;
  if (v.undecided) {
    status = match ? "UNDECIDED-OK" : "UNDECIDED-DRIFT";
    undecided++;
  } else if (match) {
    status = "PASS";
  } else {
    status = "FAIL";
    fail++;
  }
  rows.push({
    id: v.id,
    expected: v.expectedExit,
    actual,
    status,
    rationale: v.rationale,
  });
}

console.log("exportable-cleanliness bypass-corpus results");
console.log("allowlist:", allowlistPath);
console.log("");
console.log(
  "| ID | expected | actual | status | rationale |",
);
console.log("|---|---|---|---|---|");
for (const row of rows) {
  const rat = row.rationale.replace(/\|/g, "/");
  console.log(
    `| ${row.id} | ${row.expected} | ${row.actual} | ${row.status} | ${rat} |`,
  );
}
console.log("");
console.log(
  `summary: total=${rows.length} fail=${fail} undecided=${undecided} pass=${rows.length - fail - undecided}`,
);
process.exit(fail > 0 ? 1 : 0);
