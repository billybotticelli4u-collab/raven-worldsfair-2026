import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { verifyEngine } from "../src/bootstrap.mjs";
const sha = (x) => createHash("sha256").update(x).digest("hex");
function fixture(fn) {
  const root = mkdtempSync(path.join(tmpdir(), "raven-bootstrap-"));
  try {
    mkdirSync(root + "/app/engine", { recursive: true });
    writeFileSync(root + "/app/engine/test.mjs", "fixed source");
    const pin = JSON.stringify({
      node_version: "v22.18.0",
      engine_files: [{ path: "test.mjs", sha256: sha("fixed source") }],
    });
    writeFileSync(root + "/engine-pin.json", pin);
    return fn(root, sha(pin));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
test("pinned engine is checked before it can be imported", () =>
  fixture((root, pin) => assert.equal(verifyEngine(root, pin), true)));
test("wrong pin, changed source, malformed path and symlinks refuse", () => {
  fixture((root, pin) => {
    assert.throws(() => verifyEngine(root, "0".repeat(64)), {
      code: "ENGINE_IDENTITY_MISMATCH",
    });
    writeFileSync(root + "/app/engine/test.mjs", "changed source");
    assert.throws(() => verifyEngine(root, pin), {
      code: "ENGINE_IDENTITY_MISMATCH",
    });
  });
  fixture((root, pin) => {
    rmSync(root + "/app/engine/test.mjs");
    writeFileSync(root + "/external.mjs", "fixed source");
    symlinkSync(root + "/external.mjs", root + "/app/engine/test.mjs");
    assert.throws(() => verifyEngine(root, pin), {
      code: "ENGINE_IDENTITY_MISMATCH",
    });
  });
  fixture((root) => {
    const pin = JSON.stringify({
      node_version: "v22.18.0",
      engine_files: [{ path: "../outside", sha256: sha("fixed source") }],
    });
    writeFileSync(root + "/engine-pin.json", pin);
    assert.throws(() => verifyEngine(root, sha(pin)), {
      code: "ENGINE_IDENTITY_MISMATCH",
    });
  });
});
