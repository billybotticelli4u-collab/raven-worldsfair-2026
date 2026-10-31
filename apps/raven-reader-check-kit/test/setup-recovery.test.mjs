// W-1 setup/export failures and W-3 hard-kill recovery (synthetic fixtures only).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP = realpathSync(path.join(KIT, "..", "raven-conformance"));
const READER = path.join(KIT, "readers", "reference-reader.mjs");
const fixture = () => realpathSync(mkdtempSync(path.join(os.tmpdir(), "w1w3-")));
const cli = (args) => spawnSync(process.execPath, [path.join(KIT, "check-reader.mjs"), "--reader", READER, ...args], { encoding: "utf8", timeout: 60000 });
function refused(r, pattern) {
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, pattern);
  assert.doesNotMatch(r.stderr, /\n\s+at |node:internal|Error: /, "no uncaught stack trace");
  assert.doesNotMatch(r.stdout, /verdict:|report:|summary:/, "no success message");
}

test("W-1 explicit JSON parent missing is refused before running; nothing created", () => {
  const d = fixture(); const out = path.join(d, "missing", "r.json");
  refused(cli(["--out", out, "--run-id", "w1-json-parent"]), /output_parent_missing/);
  assert.equal(existsSync(path.join(d, "missing")), false);
});

test("W-1 Markdown parent missing is refused before running; JSON not written", () => {
  const d = fixture(); const out = path.join(d, "r.json");
  refused(cli(["--out", out, "--explain", path.join(d, "nope", "s.md"), "--run-id", "w1-md-parent"]), /output_parent_missing/);
  assert.equal(existsSync(out), false);
});

test("W-1 physical parent missing behind symlink/.. is refused", () => {
  const d = fixture(); mkdirSync(path.join(d, "a", "sub"), { recursive: true }); mkdirSync(path.join(d, "b"));
  symlinkSync(path.join(d, "a", "sub"), path.join(d, "b", "link"));
  const out = `${d}/b/link/../missing/r.json`; // physically a/missing (absent); lexically b/missing
  refused(cli(["--out", out, "--run-id", "w1-link-parent"]), /output_parent_missing|invalid_output_path/);
  assert.equal(existsSync(path.join(d, "a", "missing")), false);
  assert.equal(existsSync(path.join(d, "b", "missing")), false);
});

test("W-1 trailing separators are refused for JSON and Markdown", () => {
  const d = fixture();
  refused(cli(["--out", `${d}/r.json/`, "--run-id", "w1-trail-json"]), /ends with a directory separator/);
  refused(cli(["--out", `${d}/r.json`, "--explain", `${d}/s.md/`, "--run-id", "w1-trail-md"]), /ends with a directory separator/);
  assert.equal(existsSync(`${d}/r.json`), false);
});

test("W-1 JSON export-write failure is exit 2 with explanation", () => {
  const d = fixture(); const ro = path.join(d, "ro"); mkdirSync(ro); chmodSync(ro, 0o500);
  try { refused(cli(["--out", path.join(ro, "r.json"), "--run-id", "w1-json-write"]), /export_write_failed: could not write the JSON report/); }
  finally { chmodSync(ro, 0o700); }
  assert.equal(existsSync(path.join(ro, "r.json")), false);
});

test("W-1 Markdown export-write failure keeps the written JSON and claims no success", () => {
  const d = fixture(); const ro = path.join(d, "ro"); mkdirSync(ro); chmodSync(ro, 0o500);
  const out = path.join(d, "r.json");
  try { refused(cli(["--out", out, "--explain", path.join(ro, "s.md"), "--run-id", "w1-md-write"]), /export_write_failed: could not write the Markdown summary.*JSON report .* was written and kept/); }
  finally { chmodSync(ro, 0o700); }
  const report = JSON.parse(readFileSync(out, "utf8"));
  assert.equal(report.verdict, "ALL_MATCHED");
  assert.equal(existsSync(path.join(ro, "s.md")), false);
});

test("W-1/W-3 an existing run-owned snapshot is refused (exit 2) and left untouched", () => {
  const id = `w3-preexisting-${process.pid}`; const snap = path.join(APP, `.reader-kit-snapshot-${id}`);
  mkdirSync(snap); writeFileSync(path.join(snap, "reader.mjs"), "// synthetic leftover\n", { mode: 0o400 }); chmodSync(snap, 0o500);
  try {
    const d = fixture();
    refused(cli(["--out", path.join(d, "r.json"), "--run-id", id]), /capture_failed: .*already exists/);
    assert.equal(statSync(snap).mode & 0o777, 0o500);
    assert.equal(readFileSync(path.join(snap, "reader.mjs"), "utf8"), "// synthetic leftover\n");
    assert.equal(existsSync(path.join(d, "r.json")), false);
  } finally { recover(snap); }
  assert.equal(existsSync(snap), false);
});

// README "Recovering after a hard kill": exactly these three commands on one explicit path.
function recover(snap) {
  execFileSync("/bin/chmod", ["u+w", snap]);
  execFileSync("/bin/rm", ["-f", path.join(snap, "reader.mjs")]);
  execFileSync("/bin/rmdir", [snap]);
}

test("W-3 hard kill leaves the run-owned snapshot; the documented manual procedure removes it", async () => {
  const d = fixture(); const id = `w3-hardkill-${process.pid}`;
  const snap = path.join(APP, `.reader-kit-snapshot-${id}`);
  assert.equal(existsSync(snap), false);
  const slow = path.join(d, "slow-reader.mjs");
  writeFileSync(slow, "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2500);\nprocess.stdout.write(JSON.stringify({decision:'REJECT',version:null,reason:'slow'}));\n");
  const child = spawn(process.execPath, [path.join(KIT, "check-reader.mjs"), "--reader", slow, "--out", path.join(d, "r.json"), "--run-id", id], { detached: true, stdio: "ignore" });
  const t0 = Date.now();
  while (!existsSync(path.join(snap, "reader.mjs")) && Date.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 25));
  await new Promise((r) => setTimeout(r, 300));
  process.kill(-child.pid, "SIGKILL");
  await new Promise((r) => child.exitCode !== null || child.signalCode ? r() : child.on("exit", r));
  assert.equal(existsSync(path.join(d, "r.json")), false);
  assert.equal(statSync(snap).mode & 0o777, 0o500, "leftover is the protected run-owned folder");
  assert.equal(statSync(path.join(snap, "reader.mjs")).mode & 0o777, 0o400);
  assert.throws(() => execFileSync("/bin/rm", ["-rf", snap], { stdio: "ignore" }), "plain rm -rf fails (W-3 symptom)");
  // A rerun with the same id refuses and names the exact path instead of reusing it.
  const r = cli(["--out", path.join(d, "r2.json"), "--run-id", id]);
  refused(r, new RegExp(`capture_failed: .*${snap.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  recover(snap);
  assert.equal(existsSync(snap), false);
});

// C-1: generated default run ids must not collide within one second.
const FROZEN = `const R = globalThis.Date; const T = R.parse("2026-10-31T10:00:00.000Z");
globalThis.Date = class extends R { constructor(...a) { if (a.length) super(...a); else super(T); } static now() { return T; } };`;
function slowReference(d) {
  const p = path.join(d, "slow-reference.mjs");
  const src = readFileSync(READER, "utf8").replace(/^#!.*\n/, ""); // shebang must stay first; drop it
  writeFileSync(p, "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60);\n" + src);
  return p;
}
const runAsync = (args, pre = []) => new Promise((resolve) => {
  const c = spawn(process.execPath, [...pre, path.join(KIT, "check-reader.mjs"), ...args], { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = ""; c.stdout.on("data", (b) => stdout += b); c.stderr.on("data", (b) => stderr += b);
  c.on("exit", (status) => resolve({ status, stdout, stderr }));
});
const snapshots = (prefix) => new Set(readdirSync(APP).filter((x) => x.startsWith(prefix)));

test("C-1 two same-second default-id runs overlap and both succeed with distinct outputs", async () => {
  const d = fixture(); const freeze = path.join(d, "freeze-date.mjs"); writeFileSync(freeze, FROZEN);
  const reader = slowReference(d); const pre = ["--import", freeze];
  const prefix = ".reader-kit-snapshot-reader-check-20261031100000";
  const before = snapshots(prefix);
  const a = runAsync(["--reader", reader, "--out", path.join(d, "a.json")], pre);
  const t0 = Date.now();
  while ([...snapshots(prefix)].every((x) => before.has(x)) && Date.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 10));
  const b = runAsync(["--reader", reader, "--out", path.join(d, "b.json")], pre); // starts while A's snapshot exists
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(ra.status, 0, ra.stdout + ra.stderr); assert.equal(rb.status, 0, rb.stdout + rb.stderr);
  const ja = JSON.parse(readFileSync(path.join(d, "a.json"), "utf8")), jb = JSON.parse(readFileSync(path.join(d, "b.json"), "utf8"));
  assert.equal(ja.verdict, "ALL_MATCHED"); assert.equal(jb.verdict, "ALL_MATCHED");
  for (const j of [ja, jb]) assert.match(j.run_id, /^reader-check-20261031100000-\d+-[0-9a-f]{16}$/);
  assert.notEqual(ja.run_id, jb.run_id);
  assert.deepEqual(snapshots(prefix), before, "no snapshot left behind");
});

test("C-1 healthy distinct explicit-id twins overlap and both succeed", async () => {
  const d = fixture(); const reader = slowReference(d); const ids = [`c1-twin-a-${process.pid}`, `c1-twin-b-${process.pid}`];
  const rs = await Promise.all(ids.map((id) => runAsync(["--reader", reader, "--out", path.join(d, `${id}.json`), "--run-id", id])));
  for (const [i, r] of rs.entries()) {
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(JSON.parse(readFileSync(path.join(d, `${ids[i]}.json`), "utf8")).run_id, ids[i], "explicit id used verbatim");
    assert.equal(existsSync(path.join(APP, `.reader-kit-snapshot-${ids[i]}`)), false);
  }
});

test("C-1 control: a pre-existing explicit-id snapshot is still refused and preserved", () => {
  const id = `c1-explicit-${process.pid}`; const snap = path.join(APP, `.reader-kit-snapshot-${id}`);
  mkdirSync(snap); writeFileSync(path.join(snap, "reader.mjs"), "// synthetic c1 leftover\n", { mode: 0o400 }); chmodSync(snap, 0o500);
  try {
    const d = fixture();
    refused(cli(["--out", path.join(d, "r.json"), "--run-id", id]), new RegExp(`capture_failed: .*\\.reader-kit-snapshot-${id} .*already exists`));
    assert.equal(statSync(snap).mode & 0o777, 0o500);
    assert.equal(readFileSync(path.join(snap, "reader.mjs"), "utf8"), "// synthetic c1 leftover\n");
    assert.equal(existsSync(path.join(d, "r.json")), false);
  } finally { recover(snap); }
});
