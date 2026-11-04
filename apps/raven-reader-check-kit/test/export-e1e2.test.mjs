// E-1 (long valid output names), E-2 (private temp stage, no permission widening)
// and the retained W-1 limit control. Synthetic fixtures only; Linux/POSIX mode bits.
import { test } from "node:test";
import { ownedId } from "./_isolation.mjs";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GATE = path.join(KIT, "test", "helpers", "export-gate.mjs");
const REF = path.join(KIT, "readers", "reference-reader.mjs");
const BAD = path.join(KIT, "readers", "faulty-reader-no-size-cap.mjs");
const sha = (b) => createHash("sha256").update(b).digest("hex");
const mode = (f) => (statSync(f).mode & 0o7777).toString(8);
const printed = (s) => (s.match(/report: .*  sha256 ([0-9a-f]{64})/) || [])[1];
const RUN80 = ownedId("e1").padEnd(80, "e");
function fixture(t) { const d = realpathSync(mkdtempSync(path.join(os.tmpdir(), "export-e1e2-"))); t.after(() => rmSync(d, { recursive: true, force: true })); return d; }
// Children run under an explicit ordinary 022 umask so the default-mode control is exact.
function run(reader, args, env = {}) {
  const p = spawn("/bin/sh", ["-c", 'umask 022 && exec "$@"', "sh", process.execPath, "--import", GATE, path.join(KIT, "check-reader.mjs"), "--reader", reader, ...args], { env: { ...process.env, ...env } });
  let stdout = "", stderr = ""; p.stdout.on("data", (b) => (stdout += b)); p.stderr.on("data", (b) => (stderr += b));
  const done = new Promise((res) => p.on("close", (status) => res({ status, stdout, stderr })));
  return { p, done };
}
const go = (reader, args, env) => run(reader, args, env).done;

for (const [label, json, md] of [
  ["240-byte JSON and Markdown names", "r".repeat(235) + ".json", "s".repeat(237) + ".md"],
  ["healthy short-name control", "r.json", "s.md"],
]) {
  test(`E-1: ${label} with an 80-character run id export successfully and leave no temp file`, async (t) => {
    assert.equal(Buffer.byteLength(RUN80), 80);
    const d = fixture(t); const out = path.join(d, json), ex = path.join(d, md);
    const a = await go(REF, ["--run-id", RUN80, "--out", out, "--explain", ex]);
    assert.equal(a.status, 0, a.stderr);
    assert.match(a.stdout, /verdict: ALL_MATCHED/);
    assert.equal(printed(a.stdout), sha(readFileSync(out)));
    assert.equal(JSON.parse(readFileSync(out, "utf8")).run_id, RUN80);
    assert.match(readFileSync(ex, "utf8"), new RegExp(`summary — ${RUN80}`));
    assert.deepEqual(readdirSync(d).sort(), [json, md].sort());
    // Replacing existing long-name exports works too.
    const b = await go(REF, ["--run-id", RUN80.slice(1) + "f", "--out", out, "--explain", ex]);
    assert.equal(b.status, 0, b.stderr);
    assert.deepEqual(readdirSync(d).sort(), [json, md].sort());
  });
}

test("E-2: temp exports are owner-only (0600) from creation; an existing 0600 pair stays 0600 after replacement", async (t) => {
  const d = fixture(t); const out = path.join(d, "r.json"), ex = path.join(d, "s.md"), log = path.join(d, "..", path.basename(d) + ".modes");
  t.after(() => rmSync(log, { force: true }));
  assert.equal((await go(REF, ["--run-id", ownedId("e2-first"), "--out", out, "--explain", ex])).status, 0);
  chmodSync(out, 0o600); chmodSync(ex, 0o600);
  const a = await go(REF, ["--run-id", ownedId("e2-second"), "--out", out, "--explain", ex], { TMP_MODE_LOG: log });
  assert.equal(a.status, 0, a.stderr);
  assert.deepEqual(readFileSync(log, "utf8").trim().split("\n"), ["json 600 47", "md 600 47"]);
  assert.equal(mode(out), "600"); assert.equal(mode(ex), "600");
  assert.equal(JSON.parse(readFileSync(out, "utf8")).run_id, ownedId("e2-second"));
  assert.deepEqual(readdirSync(d).sort(), ["r.json", "s.md"]);
});

test("E-2 controls: new exports get the ordinary 0644 (umask 022); an existing 0640 export keeps exactly 0640; temp stage still 0600", async (t) => {
  const d = fixture(t); const out = path.join(d, "r.json"), ex = path.join(d, "s.md"), log = path.join(d, "..", path.basename(d) + ".modes");
  t.after(() => rmSync(log, { force: true }));
  const a = await go(REF, ["--run-id", ownedId("e2-fresh"), "--out", out, "--explain", ex], { TMP_MODE_LOG: log });
  assert.equal(a.status, 0, a.stderr);
  assert.equal(mode(out), "644"); assert.equal(mode(ex), "644");
  assert.deepEqual(readFileSync(log, "utf8").trim().split("\n"), ["json 600 47", "md 600 47"]);
  chmodSync(out, 0o640);
  assert.equal((await go(REF, ["--run-id", ownedId("e2-again"), "--out", out, "--explain", ex])).status, 0);
  assert.equal(mode(out), "640"); assert.equal(mode(ex), "644");
});

for (const at of ["json", "md"]) {
  test(`E-2: simulated ENOSPC on the ${at} temp keeps the earlier owner-only exports byte- and mode-identical and leaves no temp`, async (t) => {
    const d = fixture(t); const out = path.join(d, "r.json"), ex = path.join(d, "s.md");
    assert.equal((await go(REF, ["--run-id", ownedId(`e2f-${at}-0`), "--out", out, "--explain", ex])).status, 0);
    chmodSync(out, 0o600); chmodSync(ex, 0o600);
    const bj = readFileSync(out), bm = readFileSync(ex);
    const a = await go(REF, ["--run-id", ownedId(`e2f-${at}-1`), "--out", out, "--explain", ex], { FAIL_AT: at });
    assert.equal(a.status, 2, a.stdout + a.stderr);
    assert.match(a.stderr, at === "json" ? /export_write_failed: could not write the JSON report .*ENOSPC/ : /export_write_failed: could not write the Markdown summary .*was written and kept/);
    assert.doesNotMatch(a.stdout, /verdict:|report:|summary:/);
    if (at === "json") assert.ok(readFileSync(out).equals(bj));
    else assert.equal(JSON.parse(readFileSync(out, "utf8")).run_id, ownedId(`e2f-${at}-1`), "JSON kept on Markdown failure");
    assert.ok(readFileSync(ex).equals(bm));
    assert.equal(mode(out), "600"); assert.equal(mode(ex), "600");
    assert.deepEqual(readdirSync(d).sort(), ["r.json", "s.md"]);
  });
}

// W-1 is a RETAINED, DOCUMENTED LIMIT, not a fix: a writer that replaces the JSON
// after this run's final JSON re-read but before its Markdown re-read is not
// detected. This control asserts the limit so any future change to it is visible.
test("W-1 limit control (retained): JSON replaced between the final JSON and Markdown re-reads leaves a mixed pair while the earlier run exits 0", { timeout: 60000 }, async (t) => {
  const d = fixture(t); const out = path.join(d, "r.json"), mdA = path.join(d, "a.md"), mdB = path.join(d, "b.md");
  const g = path.join(d, "gate"); spawnSync("mkdir", [g]); for (const f of ["reached", "go"]) assert.equal(spawnSync("mkfifo", [path.join(g, f)]).status, 0);
  const A = run(REF, ["--run-id", ownedId("w1-a"), "--out", out, "--explain", mdA], { GATE_AFTER: "readjson", GATE_DIR: g });
  assert.equal(await readFile(path.join(g, "reached"), "utf8"), "readjson");
  const b = await go(BAD, ["--run-id", ownedId("w1-b"), "--out", out, "--explain", mdB]);
  assert.equal(b.status, 1, b.stderr);
  await writeFile(path.join(g, "go"), "go");
  const a = await A.done;
  assert.equal(a.status, 0, a.stderr);
  assert.match(a.stdout, /verdict: ALL_MATCHED/);
  const disk = readFileSync(out);
  assert.equal(JSON.parse(disk.toString("utf8")).run_id, ownedId("w1-b"), "advertised JSON now belongs to B");
  assert.notEqual(printed(a.stdout), sha(disk), "A prints its own hash, which no longer matches the file");
  assert.match(readFileSync(mdA, "utf8"), new RegExp(`summary — ${ownedId("w1-a")}`), "advertised Markdown still belongs to A");
});
