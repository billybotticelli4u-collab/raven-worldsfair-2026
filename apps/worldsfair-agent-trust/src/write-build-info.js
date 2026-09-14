import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import path from "node:path";

const APP_ROOT = fileURLToPath(new URL("..", import.meta.url));
const commit = execSync("git rev-parse HEAD", {
  cwd: APP_ROOT,
  encoding: "utf8",
}).trim();
const branch = execSync("git branch --show-current", {
  cwd: APP_ROOT,
  encoding: "utf8",
}).trim();
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
