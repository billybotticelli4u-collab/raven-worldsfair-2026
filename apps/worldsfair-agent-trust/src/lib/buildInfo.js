import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import path from "node:path";

const APP_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const GENERATED = path.join(APP_ROOT, "generated-build-info.json");

export const OFFICIAL_CONTEST_START = {
  instant: "2026-09-14T06:00:00-07:00",
  zone: "America/Los_Angeles",
  utc: "2026-09-14T13:00:00Z",
};

export const PREEXISTING_FOUNDATION = [
  "packages/verify-js (raven-receipt-verifier) — offline receipt-v1 verify",
  "Production trust anchor + BONK fixture vectors",
  "Broader Raven monorepo evidence/apps predating contest start",
];

export const FAIR_WORK_IN_THIS_APP = [
  "Built during competition (after official contest start)",
  "Agent A / Agent B orchestration and fail-closed decision surface",
  "PATH A verified + PATH B refused vertical slice",
  "Day-2 raven-agent-trust/1 request, response, verification, and policy exchange",
  "Judge-facing web UI + About/Build Info honesty",
  "Fair app tests and worldsfair-2026 provenance docs",
];

function git(cmd) {
  try {
    return execSync(cmd, {
      cwd: APP_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Prefer env injection (CI/build), then generated file, then live git.
 */
export function readBuildInfo() {
  const fromEnv = process.env.WORLDSFAIR_BUILD_COMMIT || process.env.FAIR_BUILD_COMMIT;
  let commit = fromEnv || null;
  let branch = process.env.WORLDSFAIR_BUILD_BRANCH || null;
  let source = fromEnv ? "env" : null;

  if (!commit && existsSync(GENERATED)) {
    try {
      const g = JSON.parse(readFileSync(GENERATED, "utf8"));
      commit = g.commit || null;
      branch = branch || g.branch || null;
      source = "generated";
    } catch {
      /* ignore */
    }
  }

  if (!commit) {
    commit = git("git rev-parse HEAD");
    branch = branch || git("git branch --show-current");
    source = "git";
  }

  return {
    fairBuildCommit: commit,
    fairBuildBranch: branch,
    commitSource: source,
    officialContestStart: OFFICIAL_CONTEST_START,
    preexistingFoundation: PREEXISTING_FOUNDATION,
    fairWorkInThisApp: FAIR_WORK_IN_THIS_APP,
    labels: {
      foundation: "PRE-EXISTING (not Fair-created)",
      fairApp: "FAIR WORK (World's Fair 2026 Days 1-2)",
    },
  };
}
