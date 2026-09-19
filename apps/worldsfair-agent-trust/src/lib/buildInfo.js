import { fileURLToPath } from "node:url";
import { readIdentity } from "./buildIdentity.js";

const APP_ROOT = fileURLToPath(new URL("../..", import.meta.url));

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

export function readBuildInfo() {
  const identity = readIdentity(APP_ROOT);
  return {
    ...identity,
    officialContestStart: OFFICIAL_CONTEST_START,
    preexistingFoundation: PREEXISTING_FOUNDATION,
    fairWorkInThisApp: FAIR_WORK_IN_THIS_APP,
    labels: {
      foundation: "PRE-EXISTING (not Fair-created)",
      fairApp: "FAIR WORK (World's Fair 2026 Days 1-2)",
    },
  };
}
