import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
// sha256 of `npm run demo` stdout at base 33f5486b (Node 22.18 / 24.18 / 26.9).
const BASE_DEMO_STDOUT_SHA256 = "eeed2e14620820da3b2c69e48f63bd1ada1c8b88b34f26b99e4856618143d747";

test("offline judge demo stdout is byte-identical to base 33f5486b", () => {
  const r = spawnSync(process.execPath, ["--experimental-strip-types", path.join(ROOT, "scripts/agent-trust-demo.mjs")], {
    cwd: tmpdir(), encoding: "buffer", timeout: 30_000,
  });
  assert.equal(r.status, 0);
  assert.equal(createHash("sha256").update(r.stdout).digest("hex"), BASE_DEMO_STDOUT_SHA256);
});

test("guarded judge-path files are unchanged vs 33f5486b (needs git history)", (t) => {
  if (spawnSync("git", ["cat-file", "-e", "33f5486b8cff02d05abcded1155dc2bace865242"], { cwd: ROOT }).status !== 0) {
    return t.skip("base commit not available in this checkout");
  }
  const r = spawnSync(process.execPath, ["--experimental-strip-types", path.join(ROOT, "scripts/check-demo-unchanged.mjs")], {
    cwd: ROOT, encoding: "utf8", timeout: 60_000,
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /demo stdout byte-identical to 33f5486b/);
});
