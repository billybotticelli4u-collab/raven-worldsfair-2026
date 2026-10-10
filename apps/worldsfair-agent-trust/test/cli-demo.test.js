import assert from "node:assert/strict";
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const SCRIPT = "scripts/agent-trust-demo.mjs";
const APP = "apps/worldsfair-agent-trust";
const EXPECTED = "Valid receipt: PROCEED\nOne-field tamper: REFUSE\n";

function run(root) {
  return spawnSync(process.execPath, ["--experimental-strip-types", path.join(root, SCRIPT)], {
    cwd: tmpdir(), encoding: "utf8", timeout: 10000,
  });
}

function scratch(t, withVerifier = true) {
  const root = mkdtempSync(path.join(tmpdir(), "raven-judge-demo-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, "scripts"), { recursive: true });
  writeFileSync(path.join(root, "package.json"), '{"type":"module"}\n');
  cpSync(path.join(ROOT, SCRIPT), path.join(root, SCRIPT));
  cpSync(path.join(ROOT, APP, "src"), path.join(root, APP, "src"), { recursive: true });
  cpSync(path.join(ROOT, APP, "fixtures"), path.join(root, APP, "fixtures"), { recursive: true });
  if (withVerifier) cpSync(path.join(ROOT, "vendor/raven-receipt-verifier"),
    path.join(root, "vendor/raven-receipt-verifier"), { recursive: true });
  return root;
}

function refuses(result) {
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "", "a failed demo must not print either success line");
  assert.match(result.stderr, /Agent Trust demo did not complete/);
}

test("judge demo verifies both real fixture outcomes from an unrelated cwd", () => {
  const result = run(ROOT);
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, EXPECTED);
});

test("judge demo refuses a missing verifier rather than printing expected outcomes", (t) => {
  refuses(run(scratch(t, false)));
});

test("judge demo refuses when the valid receipt is replaced by the tampered receipt", (t) => {
  const root = scratch(t);
  cpSync(path.join(root, APP, "fixtures/bonk-tampered-receipt.json"),
    path.join(root, APP, "fixtures/bonk-valid-receipt.json"));
  refuses(run(root));
});

test("judge demo refuses when the tampered receipt is replaced by the valid receipt", (t) => {
  const root = scratch(t);
  cpSync(path.join(root, APP, "fixtures/bonk-valid-receipt.json"),
    path.join(root, APP, "fixtures/bonk-tampered-receipt.json"));
  refuses(run(root));
});

test("judge demo refuses an unreadable second fixture without partial success output", (t) => {
  const root = scratch(t);
  writeFileSync(path.join(root, APP, "fixtures/bonk-tampered-receipt.json"), "{invalid JSON");
  refuses(run(root));
});
