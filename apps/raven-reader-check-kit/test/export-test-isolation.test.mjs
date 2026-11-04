// Regression for overlapping export-test invocations. Each probe has its own
// app copy, so its deliberately fixed foreign name cannot collide with another
// probe or touch a live snapshot in the real checkout.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENGINE = path.resolve(KIT, "../raven-conformance");
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const mode = (p) => statSync(p).mode & 0o777;
const cases = [
  ["long-name exports", "export-e1e2.test.mjs", "^E-1: 240-byte JSON", "e".repeat(80)],
  ["disk-full export control", "export-race.test.mjs", "^simulated ENOSPC while writing JSON", "enospc-earlier"],
  ["permission export control", "export-verify.test.mjs", "^W-2: an existing JSON report", "w2-first"],
];
const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
const skip = process.platform === "win32" ? "POSIX export fixtures only" : isRoot ? "ordinary-user permission probes required" : false;

for (const [label, file, pattern, oldId] of cases) {
  test(`export-test isolation: ${label} survives its old fixed snapshot name`, { skip, timeout: 180000 }, (t) => {
    const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "raven-export-test-isolation-")));
    const kit = path.join(root, "apps/raven-reader-check-kit");
    const engine = path.join(root, "apps/raven-conformance");
    let foreign;
    t.after(() => {
      // Only this test's private copy is removed, including its own fixture.
      if (foreign) chmodSync(foreign, 0o700);
      rmSync(root, { recursive: true, force: true });
    });
    mkdirSync(path.join(kit, "test/helpers"), { recursive: true });
    mkdirSync(engine, { recursive: true });
    for (const part of ["src", "profiles", "corpus", "targets", "package.json"]) {
      cpSync(path.join(ENGINE, part), path.join(engine, part), { recursive: true });
    }
    for (const part of ["check-reader.mjs", "readers", `test/${file}`, "test/_isolation.mjs", "test/helpers/export-gate.mjs"]) {
      cpSync(path.join(KIT, part), path.join(kit, part), { recursive: true });
    }
    const capture = path.join(root, "capture-cli-ids.mjs");
    writeFileSync(capture, `import { appendFileSync } from "node:fs";
if (process.argv[1]?.endsWith("check-reader.mjs") && process.env.RAVEN_EXPORT_TEST_ID_LOG) {
  const i = process.argv.indexOf("--run-id");
  if (i >= 0) appendFileSync(process.env.RAVEN_EXPORT_TEST_ID_LOG, JSON.stringify(process.argv[i + 1]) + "\\n");
  delete process.env.NODE_OPTIONS;
  delete process.env.RAVEN_EXPORT_TEST_ID_LOG;
}
`);
    const run = (args, log) => {
      // The nested test invocation needs its own reporter, not the parent's
      // internal test-worker transport. CLI children otherwise keep the env.
      const env = { ...process.env };
      delete env.NODE_TEST_CONTEXT;
      if (log) {
        env.NODE_OPTIONS = `--import ${JSON.stringify(capture)}`;
        env.RAVEN_EXPORT_TEST_ID_LOG = log;
      }
      const result = spawnSync(process.execPath, args, { cwd: root, env, encoding: "utf8", timeout: 60000, maxBuffer: 2 * 1024 * 1024 });
      assert.equal(result.error, undefined, "probe setup or timeout is a harness failure");
      assert.equal(result.signal, null, "probe must finish normally");
      return result;
    };
    const targetArgs = ["--test", "--test-reporter=tap", "--test-concurrency=1", `--test-name-pattern=${pattern}`, path.join(kit, "test", file)];
    const healthyLog = path.join(root, "healthy-ids.jsonl");
    const occupiedLog = path.join(root, "occupied-ids.jsonl");
    const healthy = run(targetArgs, healthyLog);
    assert.equal(healthy.status, 0, `healthy target must pass before planting: ${healthy.stdout}${healthy.stderr}`);
    assert.match(healthy.stdout, /^# pass 1$/m, "the intended target actually executed");

    foreign = path.join(engine, `.reader-kit-snapshot-${oldId}`);
    mkdirSync(foreign);
    const reader = path.join(foreign, "reader.mjs");
    writeFileSync(reader, "// synthetic foreign live snapshot\n", { mode: 0o400 });
    chmodSync(foreign, 0o500);
    const before = { digest: sha(reader), dirMode: mode(foreign), fileMode: mode(reader) };

    // Confirm the fixed name really is occupied, using the unchanged CLI.
    const direct = run([path.join(kit, "check-reader.mjs"), "--reader", path.join(kit, "readers/reference-reader.mjs"),
      "--run-id", oldId, "--out", path.join(root, "direct.json"), "--explain", path.join(root, "direct.md")]);
    assert.equal(direct.status, 2);
    assert.match(direct.stderr, /capture_failed:.*EEXIST/);
    assert.equal(direct.stdout, "");

    const occupied = run(targetArgs, occupiedLog);
    const after = { digest: sha(reader), dirMode: mode(foreign), fileMode: mode(reader) };
    assert.deepEqual(after, before, "foreign snapshot bytes and modes must remain unchanged");
    t.diagnostic(JSON.stringify({ label, oldId, healthyExit: healthy.status, directExit: direct.status, occupiedExit: occupied.status, foreignUnchanged: true }));
    assert.equal(occupied.status, 0, `target must remain green with foreign old ID: ${occupied.stdout}${occupied.stderr}`);
    assert.match(occupied.stdout, /^# pass 1$/m, "the intended target actually executed despite the old-name collision");
    assert.match(occupied.stdout, /^# fail 0$/m);
    assert.match(occupied.stdout, /^# cancelled 0$/m);
    const ids = (file) => readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    const healthyIds = ids(healthyLog), occupiedIds = ids(occupiedLog);
    assert.equal(healthyIds.length, 2, "both CLI calls must be observed");
    assert.equal(occupiedIds.length, 2, "both CLI calls must be observed");
    assert.equal(new Set(healthyIds).size, 2, "the target's two runs remain distinct");
    assert.equal(new Set(occupiedIds).size, 2, "the target's two runs remain distinct");
    assert.deepEqual(occupiedIds.filter((id) => healthyIds.includes(id)), [], "independent target invocations must not reuse any run ID");
    for (const id of [...healthyIds, ...occupiedIds]) {
      assert.match(id, /^[A-Za-z0-9._-]{1,80}$/, "all generated IDs retain the CLI contract");
      if (file === "export-e1e2.test.mjs") assert.equal(Buffer.byteLength(id), 80, "both long-ID runs retain exactly 80 bytes");
    }
  });
}
