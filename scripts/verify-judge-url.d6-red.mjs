#!/usr/bin/env node
/**
 * D6/B1 red proof: corrupted identityStatus on a non-loopback URL must fail closed (exit 1).
 * Spawns a one-shot classifier gate so the exit code is the gate outcome.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyIdentityChecks } from "./lib/judge-url-identity.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

// In-process assertion (documentation).
const classified = classifyIdentityChecks({
  baseUrl: "https://evil.example/",
  expectedCommit: "",
  identityStatus: "CORRUPTED_STATUS",
  deployedCommit: "not-a-commit",
  shapeOk: true,
  allowlistedIdentity: false,
  commitShapeOk: false,
});
if (classified.buildInfo.klass === "LOCAL-UNBOUND" || classified.expectedCommit.klass === "LOCAL-UNBOUND") {
  console.error("RED_FAIL: LOCAL-UNBOUND issued for non-loopback corrupt identity");
  process.exit(1);
}
if (classified.buildInfo.ok || classified.expectedCommit.ok) {
  console.error("RED_FAIL: corrupt non-loopback soft-passed", classified);
  process.exit(1);
}

// Child process whose exit code is the gate: 1 = identity gate failed closed (what we want).
const child = spawnSync(
  process.execPath,
  [
    "--input-type=module",
    "-e",
    `
    import { classifyIdentityChecks } from ${JSON.stringify(path.join(here, "lib/judge-url-identity.mjs"))};
    const r = classifyIdentityChecks({
      baseUrl: "https://evil.example/",
      expectedCommit: "",
      identityStatus: "CORRUPTED_STATUS",
      deployedCommit: "not-a-commit",
      shapeOk: true,
      allowlistedIdentity: false,
      commitShapeOk: false,
    });
    const pass = r.buildInfo.ok && r.expectedCommit.ok;
    process.exit(pass ? 0 : 1);
    `,
  ],
  { encoding: "utf8" },
);

if (child.status !== 1) {
  console.error("RED_FAIL: expected child exit 1, got", child.status, child.stdout, child.stderr);
  process.exit(1);
}

// Green contrast: loopback UNKNOWN/null must be LOCAL-UNBOUND (soft).
const green = classifyIdentityChecks({
  baseUrl: "http://127.0.0.1:8791/",
  expectedCommit: "",
  identityStatus: "UNKNOWN",
  deployedCommit: null,
  shapeOk: true,
  allowlistedIdentity: false,
  commitShapeOk: false,
});
if (green.buildInfo.klass !== "LOCAL-UNBOUND" || green.expectedCommit.klass !== "LOCAL-UNBOUND") {
  console.error("GREEN_FAIL", green);
  process.exit(1);
}

console.log("RED_NON_LOOPBACK_CORRUPT_EXIT", child.status);
console.log("GREEN_LOCAL_UNBOUND_OK");
console.log("D6_RED_GREEN_OK");
