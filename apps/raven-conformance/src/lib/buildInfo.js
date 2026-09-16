import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import path from "node:path";

const APP_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const REPO_ROOT = path.resolve(APP_ROOT, "../..");

export const OFFICIAL_CONTEST_START = {
  instant: "2026-09-14T06:00:00-07:00",
  zone: "America/Los_Angeles",
  utc: "2026-09-14T13:00:00Z",
};

export const PREEXISTING = [
  "Raven product / receipt-verifier research lineage predating contest (referenced only; not imported by this MVP)",
  "Broader Raven monorepo and private corpora (NOT copied into this app)",
  "Crypto World's Fair contest framing and public Fair repo shell",
];

export const FAIR_BUILT = [
  "Conformance product loop (target → claimed profile → corpus → execution → evidence report → reproduction)",
  "Profile abstraction: raven-canonical-envelope/1",
  "Challenge 1 bounded runner: sandbox-exec on Darwin / curated_demo disclosure otherwise",
  "Expanded result taxonomy (no silent PASS for crash/timeout/flood/invalid)",
  "Hostile Raven-owned boundary probes + replay CLI",
  "UI contract interface for UI lane (local publish)",
  "Deterministic report digest vs volatile metadata",
  "Judge UI (select target → Run Conformance → evidence → copy reproduction)",
  "Three Raven-owned demo targets: CONFORMANT_REFERENCE, BROKEN_OBVIOUS, BROKEN_SUBTLE",
  "Self-contained Raven-owned demo corpus (not private corpora)",
  "Fair disclosure About / README PRE-EXISTING vs FAIR-built",
];

function git(cmd) {
  try {
    return execSync(cmd, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

export function readBuildInfo() {
  const fromEnv = process.env.WORLDSFAIR_BUILD_COMMIT || process.env.FAIR_BUILD_COMMIT;
  let commit = fromEnv || null;
  let branch = process.env.WORLDSFAIR_BUILD_BRANCH || null;
  let source = fromEnv ? "env" : null;

  if (!commit) {
    commit = git("git rev-parse HEAD");
    branch = branch || git("git branch --show-current");
    source = "git";
  }

  return {
    product: "raven-conformance",
    fairBuildCommit: commit,
    fairBuildBranch: branch,
    commitSource: source,
    officialContestStart: OFFICIAL_CONTEST_START,
    preexisting: PREEXISTING,
    fairBuilt: FAIR_BUILT,
    labels: {
      preexisting: "PRE-EXISTING (not Fair-created)",
      fairBuilt: "BUILT DURING CRYPTO WORLD'S FAIR 2026",
    },
    buildStageNote:
      "Build Stage product milestone surface for judge review. Does not claim Day-3 Evidence Contract Handshake as this product.",
    reviewClassHint: "Author lane — classify READY_FOR_HACKATHON_PRODUCT_REVIEW or NOT_READY",
  };
}
