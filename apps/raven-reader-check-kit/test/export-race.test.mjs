// Export races and simulated write failures (synthetic fixtures only).
// Deterministic FIFO handshakes via test/helpers/export-gate.mjs; no sleeps.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GATE = path.join(KIT, "test", "helpers", "export-gate.mjs");
const REF = path.join(KIT, "readers", "reference-reader.mjs");
const BAD = path.join(KIT, "readers", "faulty-reader-no-size-cap.mjs");
const sha = (b) => createHash("sha256").update(b).digest("hex");
function fixture(t) { const d = realpathSync(mkdtempSync(path.join(os.tmpdir(), "export-race-"))); t.after(() => rmSync(d, { recursive: true, force: true })); return d; }
function run(reader, args, env = {}) {
  const p = spawn(process.execPath, ["--import", GATE, path.join(KIT, "check-reader.mjs"), "--reader", reader, ...args], { env: { ...process.env, ...env } });
  let stdout = "", stderr = ""; p.stdout.on("data", (b) => (stdout += b)); p.stderr.on("data", (b) => (stderr += b));
  const done = new Promise((res) => p.on("close", (status) => res({ status, stdout, stderr })));
  return { p, done };
}
function gate(d) { const g = path.join(d, "gate"); spawnSync("mkdir", [g]); for (const f of ["reached", "go"]) assert.equal(spawnSync("mkfifo", [path.join(g, f)]).status, 0); return g; }
const printed = (s) => (s.match(/report: .*  sha256 ([0-9a-f]{64})/) || [])[1];

for (const at of ["json", "md"]) {
  test(`a run whose ${at === "json" ? "JSON" : "Markdown"} export is replaced by a concurrent run does not print its verdict beside the other run's bytes`, { timeout: 60000 }, async (t) => {
    const d = fixture(t); const out = path.join(d, "r.json"), md = path.join(d, "s.md"); const g = gate(d);
    const A = run(REF, ["--run-id", `race-a-${at}`, "--out", out, "--explain", md], { GATE_AFTER: at, GATE_DIR: g });
    assert.equal(await readFile(path.join(g, "reached"), "utf8"), at);
    const B = await run(BAD, ["--run-id", `race-b-${at}`, "--out", out, "--explain", md]).done;
    assert.equal(B.status, 1, B.stderr);
    await writeFile(path.join(g, "go"), "go");
    const a = await A.done;
    assert.equal(a.status, 2, a.stdout + a.stderr);
    assert.match(a.stderr, /export_overwritten: the JSON report .* no longer holds this run's bytes/);
    assert.doesNotMatch(a.stdout, /verdict:|report:|summary:/, "no success message");
    assert.equal(JSON.parse(readFileSync(out, "utf8")).run_id, `race-b-${at}`);
  });
}

test("healthy twin: concurrent runs on independent paths each print the hash of their own bytes", { timeout: 60000 }, async (t) => {
  const d = fixture(t); const g = gate(d);
  const A = run(REF, ["--run-id", "twin-a", "--out", path.join(d, "a.json"), "--explain", path.join(d, "a.md")], { GATE_AFTER: "json", GATE_DIR: g });
  await readFile(path.join(g, "reached"));
  const b = await run(BAD, ["--run-id", "twin-b", "--out", path.join(d, "b.json"), "--explain", path.join(d, "b.md")]).done;
  await writeFile(path.join(g, "go"), "go");
  const a = await A.done;
  assert.equal(a.status, 0, a.stderr); assert.equal(b.status, 1, b.stderr);
  assert.equal(printed(a.stdout), sha(readFileSync(path.join(d, "a.json"))));
  assert.equal(printed(b.stdout), sha(readFileSync(path.join(d, "b.json"))));
  assert.match(readFileSync(path.join(d, "a.md"), "utf8"), /summary — twin-a/);
});

test("simulated ENOSPC while writing JSON keeps the earlier JSON intact and leaves no partial file", async (t) => {
  const d = fixture(t); const out = path.join(d, "r.json"), md = path.join(d, "s.md");
  assert.equal((await run(REF, ["--run-id", "enospc-earlier", "--out", out, "--explain", md]).done).status, 0);
  const before = readFileSync(out), beforeMd = readFileSync(md);
  const a = await run(REF, ["--run-id", "enospc-json", "--out", out, "--explain", md], { FAIL_AT: "json" }).done;
  assert.equal(a.status, 2); assert.match(a.stderr, /export_write_failed: could not write the JSON report .*ENOSPC/);
  assert.doesNotMatch(a.stdout, /verdict:|report:|summary:/);
  assert.ok(readFileSync(out).equals(before), "earlier JSON evidence preserved");
  assert.ok(readFileSync(md).equals(beforeMd));
  assert.deepEqual(readdirSync(d).sort(), ["r.json", "s.md"]);
});

test("simulated ENOSPC while writing Markdown keeps the new JSON, the earlier Markdown, and claims no success", async (t) => {
  const d = fixture(t); const out = path.join(d, "r.json"), md = path.join(d, "s.md");
  assert.equal((await run(REF, ["--run-id", "enospc-md-earlier", "--out", out, "--explain", md]).done).status, 0);
  const beforeMd = readFileSync(md);
  const a = await run(REF, ["--run-id", "enospc-md", "--out", out, "--explain", md], { FAIL_AT: "md" }).done;
  assert.equal(a.status, 2); assert.match(a.stderr, /export_write_failed: could not write the Markdown summary .*was written and kept/);
  assert.doesNotMatch(a.stdout, /verdict:|report:|summary:/);
  assert.equal(JSON.parse(readFileSync(out, "utf8")).run_id, "enospc-md");
  assert.ok(readFileSync(md).equals(beforeMd), "earlier Markdown not truncated");
  assert.deepEqual(readdirSync(d).sort(), ["r.json", "s.md"]);
});
