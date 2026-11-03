// W-2: an export whose preserved mode lacks owner read is published but cannot be
// re-read. That is a verification failure, not a replacement by another writer.
// Synthetic fixtures only; POSIX mode bits; skipped as root (root bypasses modes).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REF = path.join(KIT, "readers", "reference-reader.mjs");
const mode = (f) => (statSync(f).mode & 0o777).toString(8);
const root = typeof process.getuid === "function" && process.getuid() === 0;
const skip = process.platform === "win32" ? "POSIX modes only" : root ? "root bypasses read permission" : false;
function fixture(t) { const d = realpathSync(mkdtempSync(path.join(os.tmpdir(), "export-verify-"))); t.after(() => { for (const f of readdirSync(d)) chmodSync(path.join(d, f), 0o600); rmSync(d, { recursive: true, force: true }); }); return d; }
const go = (args) => spawnSync(process.execPath, [path.join(KIT, "check-reader.mjs"), "--reader", REF, ...args], { encoding: "utf8" });

for (const which of ["JSON report", "Markdown summary"]) {
  test(`W-2: an existing ${which} kept at write-only 0200 is written but refused as export_verification_failed (EACCES), not export_overwritten`, { skip }, (t) => {
    const d = fixture(t); const out = path.join(d, "r.json"), ex = path.join(d, "s.md");
    assert.equal(go(["--run-id", "w2-first", "--out", out, "--explain", ex]).status, 0);
    const target = which === "JSON report" ? out : ex;
    chmodSync(target, 0o200);
    const a = go(["--run-id", "w2-second", "--out", out, "--explain", ex]);
    assert.equal(a.status, 2, a.stdout + a.stderr);
    assert.match(a.stderr, new RegExp(`export_verification_failed: the ${which} .* could not be re-read to verify it \\(EACCES\\)`));
    assert.doesNotMatch(a.stderr, /export_overwritten|at .*check-reader\.mjs/);
    assert.doesNotMatch(a.stdout, /verdict:|report:|summary:/);
    assert.equal(mode(target), "200", "preserved mode");
    chmodSync(target, 0o600);
    assert.match(readFileSync(target, "utf8"), /w2-second/, "this run's bytes were published");
    assert.deepEqual(readdirSync(d).sort(), ["r.json", "s.md"]);
  });
}

test("W-2 control: an ordinary readable existing pair is replaced and verified (exit 0)", { skip }, (t) => {
  const d = fixture(t); const out = path.join(d, "r.json"), ex = path.join(d, "s.md");
  assert.equal(go(["--run-id", "w2c-first", "--out", out, "--explain", ex]).status, 0);
  chmodSync(out, 0o600);
  const a = go(["--run-id", "w2c-second", "--out", out, "--explain", ex]);
  assert.equal(a.status, 0, a.stderr);
  assert.match(a.stdout, /verdict: ALL_MATCHED/);
  assert.equal(JSON.parse(readFileSync(out, "utf8")).run_id, "w2c-second");
  assert.equal(mode(out), "600");
});
