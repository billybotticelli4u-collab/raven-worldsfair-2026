import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import path from "node:path";

const APP_ROOT = fileURLToPath(new URL("..", import.meta.url));

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

const commit =
  process.env.WORLDSFAIR_BUILD_COMMIT ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.FAIR_BUILD_COMMIT ||
  git("git rev-parse HEAD") ||
  "unknown";
const branch =
  process.env.WORLDSFAIR_BUILD_BRANCH ||
  process.env.VERCEL_GIT_COMMIT_REF ||
  git("git branch --show-current") ||
  null;
const out = {
  commit,
  branch,
  writtenAt: new Date().toISOString(),
};
writeFileSync(
  path.join(APP_ROOT, "generated-build-info.json"),
  JSON.stringify(out, null, 2) + "\n",
);
console.log("wrote generated-build-info.json", out);
