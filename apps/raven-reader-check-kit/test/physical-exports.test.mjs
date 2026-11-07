import { test } from "node:test";
import assert from "node:assert/strict";
import { ownedId } from "./_isolation.mjs";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, existsSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const READER = path.join(KIT, "readers/reference-reader.mjs");
const SENTINEL = "KEEP_EXISTING_JSON_BYTES";
function fixture(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "raven-kit-c1-"));
  t.after(() => rmSync(dir, { recursive: true }));
  return dir;
}
function run(dir, out, summary) {
  return spawnSync(process.execPath, [path.join(KIT, "check-reader.mjs"), "--reader", READER,
    "--out", out, "--explain", summary, "--run-id", ownedId("physical-export")],
  { cwd: dir, encoding: "utf8", timeout: 15000 });
}
function observe(t, r, out) {
  assert.equal(r.error, undefined, "CLI must finish within its test bound");
  t.diagnostic(JSON.stringify({ exit: r.status, stderr: r.stderr.trim(),
    output_prefix: existsSync(out) ? readFileSync(out, "utf8").slice(0, 60) : null,
    verdict_printed: /verdict:/.test(r.stdout) }));
}

for (const relative of [false, true]) for (const existing of [false, true]) {
  test(`physical symlink/.. alias refuses before writes (${relative ? "relative" : "absolute"}, ${existing ? "existing" : "new"})`, t => {
    const dir = fixture(t);
    mkdirSync(path.join(dir, "a")); mkdirSync(path.join(dir, "b"));
    symlinkSync(path.join(dir, "a"), path.join(dir, "b", "link"));
    const out = path.join(dir, "a", "result.json");
    // Do not use path.join/resolve: they erase the kernel's symlink/.. order.
    const summary = `${relative ? "." : dir}/b/link/../a/result.json`;
    if (existing) writeFileSync(out, SENTINEL);
    const r = run(dir, relative ? "./a/result.json" : out, summary);
    observe(t, r, out);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /output_path_collision/);
    assert.doesNotMatch(r.stdout, /verdict:|report:|summary:/);
    if (existing) assert.equal(readFileSync(out, "utf8"), SENTINEL);
    else assert.equal(existsSync(out), false);
  });
}

for (const [shape, name, alias] of [["case", "result.json", "RESULT.JSON"],
  ["Unicode", "r\u00e9sult.json", "re\u0301sult.json"]]) for (const existing of [false, true]) {
  test(`${shape}-folded export alias preserves JSON (${existing ? "existing" : "new"})`, t => {
    const dir = fixture(t), probe = path.join(dir, "probe");
    mkdirSync(probe);
    const first = path.join(probe, name), second = path.join(probe, alias);
    writeFileSync(first, "volume probe");
    if (!existsSync(second) || statSync(first).ino !== statSync(second).ino) {
      t.skip(`test volume does not fold ${shape}; no alias on this volume`); return;
    }
    const out = path.join(dir, name), summary = path.join(dir, alias);
    if (existing) writeFileSync(out, SENTINEL);
    else { assert.equal(existsSync(out), false); assert.equal(existsSync(summary), false); }
    const r = run(dir, out, summary);
    observe(t, r, out);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /output_path_collision/);
    assert.doesNotMatch(r.stdout, /verdict:|report:|summary:/);
    if (existing) assert.equal(readFileSync(out, "utf8"), SENTINEL);
    else {
      // Folding of new names is discovered after creating JSON. The JSON must
      // survive intact, with no Markdown overwrite or success announcement.
      const report = JSON.parse(readFileSync(out, "utf8"));
      assert.equal(report.schema, "raven-reader-check-kit-report/0");
      assert.equal(report.verdict, "ALL_MATCHED");
      assert.deepEqual(report.counts, { PASS: 30 });
      assert.equal(readFileSync(summary, "utf8"), readFileSync(out, "utf8"));
    }
  });
}

test("lexically identical but physically distinct exports remain usable", t => {
  const dir = fixture(t);
  mkdirSync(path.join(dir, "a")); mkdirSync(path.join(dir, "b"));
  symlinkSync(path.join(dir, "a"), path.join(dir, "b", "link"));
  const out = path.join(dir, "b", "result.json"), summary = `${dir}/b/link/../result.json`;
  assert.equal(path.resolve(summary), out, "positive twin must defeat lexical normalization");
  const r = run(dir, out, summary);
  observe(t, r, out);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const report = JSON.parse(readFileSync(out, "utf8"));
  assert.equal(report.verdict, "ALL_MATCHED");
  assert.deepEqual(report.counts, { PASS: 30 });
  assert.match(readFileSync(path.join(dir, "result.json"), "utf8"), /^# Reader check summary/);
  assert.notEqual(statSync(out).ino, statSync(summary).ino);
  assert.match(r.stdout, /report:.*sha256 [a-f0-9]{64}/);
  assert.match(r.stdout, /summary:/);
});
