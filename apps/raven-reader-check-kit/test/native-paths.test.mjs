import { test } from "node:test";
import assert from "node:assert/strict";
import { ownedId } from "./_isolation.mjs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reference = readFileSync(path.join(KIT, "readers/reference-reader.mjs"));
const faulty = readFileSync(path.join(KIT, "readers/faulty-reader-no-size-cap.mjs"));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const SENTINEL = "KEEP_EXISTING_JSON";
const DECOY = "KEEP_LEXICAL_DECOY";
function fixture(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "raven-kit-native-"));
  t.after(() => rmSync(dir, { recursive: true }));
  mkdirSync(path.join(dir, "x"));
  mkdirSync(path.join(dir, "y"));
  symlinkSync(path.join(dir, "x"), path.join(dir, "y", "M"));
  writeFileSync(path.join(dir, "reader.mjs"), reference);
  return dir;
}
function cli(t, dir, reader, out, summary) {
  const args = [path.join(KIT, "check-reader.mjs"), "--reader", reader, "--out", out, "--run-id", ownedId("native-paths")];
  if (summary) args.push("--explain", summary);
  const r = spawnSync(process.execPath, args, { cwd: dir, encoding: "utf8", timeout: 15000 });
  assert.equal(r.error, undefined, "CLI must finish inside the test bound");
  t.diagnostic(JSON.stringify({ exit: r.status, stderr: r.stderr.trim(), stdout: r.stdout.trim(), out_prefix: existsSync(out) ? readFileSync(out, "utf8").slice(0, 55) : null }));
  return r;
}
function refused(r) {
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /output_path_collision/);
  assert.doesNotMatch(r.stdout, /verdict:|report:|summary:/);
}

for (const shape of ["file", "directory"]) {
  for (const existing of shape === "file" ? [true] : [false, true]) {
    test(`nested symlink target preserves JSON (${shape}, ${existing ? "existing" : "new"})`, (t) => {
      const dir = fixture(t), out = path.join(dir, "report.json");
      writeFileSync(path.join(dir, "y", "report.json"), DECOY);
      symlinkSync(shape === "file" ? "y/M/../report.json" : "y/M/..", path.join(dir, "L"));
      const summary = shape === "file" ? path.join(dir, "L") : path.join(dir, "L", "report.json");
      if (existing) {
        writeFileSync(out, SENTINEL);
        assert.equal(readFileSync(summary, "utf8"), SENTINEL, "kernel opens the protected JSON");
      }
      const r = cli(t, dir, path.join(dir, "reader.mjs"), out, summary);
      refused(r);
      assert.equal(readFileSync(path.join(dir, "y", "report.json"), "utf8"), DECOY);
      if (existing) assert.equal(readFileSync(out, "utf8"), SENTINEL);
      else assert.equal(existsSync(out), false, "refuse before creating JSON");
    });
  }
  test(`nested symlink target preserves reader source (${shape})`, (t) => {
    const dir = fixture(t), reader = path.join(dir, "reader.mjs"), out = path.join(dir, "out.json");
    writeFileSync(path.join(dir, "y", "reader.mjs"), DECOY);
    symlinkSync(shape === "file" ? "y/M/../reader.mjs" : "y/M/..", path.join(dir, "L"));
    const summary = shape === "file" ? path.join(dir, "L") : path.join(dir, "L", "reader.mjs");
    assert.deepEqual(readFileSync(summary), reference, "kernel opens the protected reader");
    const r = cli(t, dir, reader, out, summary);
    refused(r);
    assert.deepEqual(readFileSync(reader), reference);
    assert.equal(readFileSync(path.join(dir, "y", "reader.mjs"), "utf8"), DECOY);
    assert.equal(existsSync(out), false);
  });
}

for (const relative of [false, true]) for (const twin of [false, true]) {
  test(`reader symlink/.. captures kernel-named bytes (${relative ? "relative" : "absolute"}, ${twin ? "faulty twin" : "no twin"})`, (t) => {
    const dir = fixture(t);
    mkdirSync(path.join(dir, "a")); mkdirSync(path.join(dir, "b"));
    symlinkSync(path.join(dir, "a"), path.join(dir, "b", "link"));
    writeFileSync(path.join(dir, "a", "reader.mjs"), reference);
    if (twin) {
      mkdirSync(path.join(dir, "b", "a"));
      writeFileSync(path.join(dir, "b", "a", "reader.mjs"), faulty);
    }
    const typed = `${relative ? "." : dir}/b/link/../a/reader.mjs`;
    const out = path.join(dir, "out.json");
    const r = cli(t, dir, typed, out);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const report = JSON.parse(readFileSync(out, "utf8"));
    assert.equal(report.reader.sha256, sha(reference));
    assert.equal(report.reader.path, path.join("a", "reader.mjs"));
    assert.equal(report.verdict, "ALL_MATCHED");
    assert.deepEqual(report.counts, { PASS: 30 });
    assert.deepEqual(readFileSync(path.join(dir, "a", "reader.mjs")), reference);
    if (twin) assert.deepEqual(readFileSync(path.join(dir, "b", "a", "reader.mjs")), faulty);
  });
}

test("reader with a nested symlink target captures physical bytes, not its faulty lexical twin", (t) => {
  const dir = fixture(t), out = path.join(dir, "out.json");
  writeFileSync(path.join(dir, "y", "reader.mjs"), faulty);
  symlinkSync("y/M/../reader.mjs", path.join(dir, "alias.mjs"));
  assert.deepEqual(readFileSync(path.join(dir, "alias.mjs")), reference);
  const r = cli(t, dir, path.join(dir, "alias.mjs"), out);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const report = JSON.parse(readFileSync(out, "utf8"));
  assert.equal(report.reader.sha256, sha(reference));
  assert.equal(report.reader.path, "reader.mjs");
  assert.deepEqual(report.counts, { PASS: 30 });
});

test("distinct export through a nested symlink target remains usable", (t) => {
  const dir = fixture(t), out = path.join(dir, "out.json"), summary = path.join(dir, "summary.md");
  writeFileSync(summary, "replace this separate summary");
  writeFileSync(path.join(dir, "y", "summary.md"), DECOY);
  symlinkSync("y/M/../summary.md", path.join(dir, "L"));
  const r = cli(t, dir, path.join(dir, "reader.mjs"), out, path.join(dir, "L"));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(JSON.parse(readFileSync(out, "utf8")).verdict, "ALL_MATCHED");
  assert.match(readFileSync(summary, "utf8"), /^# Reader check summary/);
  assert.equal(readFileSync(path.join(dir, "y", "summary.md"), "utf8"), DECOY);
  assert.deepEqual(readFileSync(path.join(dir, "reader.mjs")), reference);
});
