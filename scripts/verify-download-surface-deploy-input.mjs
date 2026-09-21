#!/usr/bin/env node
/**
 * Deployment-input proof for the Fair download surface (CODEX B3).
 * Vercel applies `.vercelignore` with gitignore semantics relative to the project
 * Root Directory (apps/raven-site). This script evaluates those exact rules with
 * `git check-ignore` (the reference gitignore matcher) for every
 * /worldsfair/download/* href linked from worldsfair/index.html, and proves:
 *   1. the file exists on disk;
 *   2. it is NOT excluded by .vercelignore (so it enters the deployment input);
 *   3. it is listed in download/SHA256SUMS.txt and its digest matches.
 * Negative control: a bare `README.md` at that path IS excluded (the F1 defect).
 * Exit 1 on any failure. Static: no network, no deploy.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(here, "..", "apps", "raven-site");
const IGNORE = path.join(SITE, ".vercelignore");
let failures = 0;
const row = (ok, name, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) failures++;
};

function ignoredByVercelignore(relPath) {
  // Evaluate .vercelignore as the sole exclude file, rooted at SITE.
  const r = spawnSync(
    "git",
    ["-c", "core.excludesFile=" + IGNORE, "-c", "core.attributesFile=/dev/null",
     "check-ignore", "--no-index", "-q", relPath],
    { cwd: SITE, encoding: "utf8" },
  );
  if (r.status === 0) return true;      // ignored
  if (r.status === 1) return false;     // not ignored
  throw new Error("git check-ignore error: " + r.stderr);
}

const html = readFileSync(path.join(SITE, "worldsfair", "index.html"), "utf8");
const hrefs = [...html.matchAll(/href="\/worldsfair\/download\/([^"]+)"/g)].map((m) => m[1]);
row(hrefs.length >= 3, "worldsfair/index.html links download files", `count=${hrefs.length}`);

const sums = Object.fromEntries(
  readFileSync(path.join(SITE, "worldsfair", "download", "SHA256SUMS.txt"), "utf8")
    .split("\n").filter(Boolean).map((l) => { const [h, f] = l.trim().split(/\s+\*?/); return [f, h]; }),
);
for (const name of hrefs) {
  const rel = path.posix.join("worldsfair", "download", name);
  const abs = path.join(SITE, rel);
  row(existsSync(abs), `exists: ${rel}`);
  if (!existsSync(abs)) continue;
  row(!ignoredByVercelignore(rel), `not excluded by .vercelignore: ${rel}`);
  const digest = createHash("sha256").update(readFileSync(abs)).digest("hex");
  row(sums[name] === digest, `SHA256SUMS.txt binds ${name}`, `${digest.slice(0, 12)}…`);
}
// Negative control: the old bare README.md name is excluded (must be true, else the matcher is not applying .vercelignore).
row(ignoredByVercelignore("worldsfair/download/README.md"), "negative control: worldsfair/download/README.md would be excluded");
row(!hrefs.includes("README.md"), "no link to the excluded README.md name");

console.log(`summary: ${failures === 0 ? "DOWNLOAD_SURFACE_DEPLOY_INPUT_OK" : failures + " FAIL"}`);
process.exit(failures === 0 ? 0 : 1);
