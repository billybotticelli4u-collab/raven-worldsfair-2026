#!/usr/bin/env node
/** Build-time identity capture → generated-build-info.json */
import { writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { publicFingerprint } from "../src/lib/buildIdentity.js";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let commit = process.env.VERCEL_GIT_COMMIT_SHA || "";
if (!/^[0-9a-fA-F]{40}$/.test(commit)) {
  try {
    commit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: appRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    commit = "";
  }
}
const out = {
  schema: "raven-generated-build-info/1",
  commit: /^[0-9a-fA-F]{40}$/.test(commit) ? commit.toLowerCase() : null,
  capturedAt: new Date().toISOString(),
  source: process.env.VERCEL_GIT_COMMIT_SHA ? "platform_asserted" : commit ? "git_checkout" : "unavailable",
  publicFingerprint: null,
};
try {
  out.publicFingerprint = publicFingerprint(appRoot);
} catch {
  /* public files may be absent in some packaging contexts */
}
writeFileSync(path.join(appRoot, "generated-build-info.json"), JSON.stringify(out, null, 2) + "\n");
console.log(`generated-build-info.json commit=${out.commit || "null"} source=${out.source}`);
