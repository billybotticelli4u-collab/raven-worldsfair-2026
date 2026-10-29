import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCorpus } from "../../raven-conformance/src/lib/runner.js";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP = path.resolve(KIT, "../raven-conformance");
const vectors = loadCorpus("raven-solana-txversion-experimental/0").data.vectors;
const ids = vectors.map(v => v.id);
const faultIndex = ids.indexOf("V21_v1_size_cap_exceeded");
assert(faultIndex >= 0 && faultIndex + 1 < vectors.length);

function run(trigger, readerName = "reference-reader.mjs") {
  const dir = mkdtempSync(path.join(tmpdir(), "raven-kit-completeness-"));
  const control = path.join(dir, "control.json");
  const preload = path.join(dir, "change-snapshot.mjs");
  // Trusted test instrumentation changes actual snapshot bytes exactly at a
  // synchronous digest read. No timer race or production test hook is used.
  // The isolated reader receives neither this preload nor its permissions.
  writeFileSync(preload, `import fs from 'node:fs';
import path from 'node:path';
import {syncBuiltinESMExports} from 'node:module';
const originalRead = fs.readFileSync;
let reads = 0, changed = false;
fs.readFileSync = function(file, ...args) {
  if (typeof file === 'string' && path.dirname(file).startsWith(${JSON.stringify(APP + path.sep + ".reader-kit-snapshot-")}) && path.basename(file) === 'reader.mjs') {
    reads++;
    if (reads === ${trigger}) {
      const bytes = originalRead.call(fs, file);
      fs.chmodSync(file, 0o600);
      fs.writeFileSync(file, Buffer.concat([bytes, Buffer.from('\\n// trusted snapshot-change control\\n')]));
      changed = true;
    }
  }
  return originalRead.call(this, file, ...args);
};
syncBuiltinESMExports();
process.on('exit', () => fs.writeFileSync(${JSON.stringify(control)}, JSON.stringify({reads,changed})));
`);
  const reader = path.join(KIT, "readers", readerName);
  const inputBefore = readFileSync(reader);
  const snapshotsBefore = readdirSync(APP).filter(x => x.startsWith(".reader-kit-snapshot-")).sort();
  const out = path.join(dir, "report.json"), summary = path.join(dir, "report.md");
  const child = spawnSync(process.execPath, ["--import", preload, path.join(KIT, "check-reader.mjs"),
    "--reader", reader, "--out", out, "--explain", summary, "--run-id", `snapshot-completeness-${trigger}`],
    { encoding: "utf8", timeout: 15000 });
  assert.equal(child.error, undefined, child.error?.message);
  assert.equal(child.signal, null, child.stderr);
  assert.equal(child.stderr, "");
  assert.deepEqual(readFileSync(reader), inputBefore, "source reader must be preserved");
  assert.deepEqual(readdirSync(APP).filter(x => x.startsWith(".reader-kit-snapshot-")).sort(), snapshotsBefore);
  return { child, report: JSON.parse(readFileSync(out, "utf8")), markdown: readFileSync(summary, "utf8"),
    control: JSON.parse(readFileSync(control, "utf8")) };
}

for (const [name, affected, phase, faulty] of [
  ["before the first case", 0, "before", false],
  ["after the first response", 0, "after", false],
  ["after a middle response", 3, "after", false],
  ["after the final response", vectors.length - 1, "after", false],
  ["after an earlier genuine difference", faultIndex + 1, "before", true],
]) {
  test(`snapshot change ${name} exports every case without inventing answers`, () => {
    const trigger = affected * 2 + (phase === "before" ? 1 : 2);
    const { child, report, markdown, control } = run(trigger, faulty ? "faulty-reader-no-size-cap.mjs" : undefined);
    assert.deepEqual(control, { reads: trigger, changed: true }, "the intended filesystem change must execute");
    assert.equal(child.status, 1, child.stdout);
    assert.equal(report.verdict, faulty ? "DIVERGENT" : "NOT_PASSED");
    assert.deepEqual(report.results.map(r => r.vector_id), ids, "persisted report must enumerate the entire corpus");
    assert.equal(report.corpus.vector_count, vectors.length);
    assert.equal(Object.values(report.counts).reduce((a, b) => a + b, 0), vectors.length);
    assert.deepEqual(report.execution_error_vector_ids, ids.slice(affected));
    assert.deepEqual(report.divergent_vector_ids, faulty ? [ids[faultIndex]] : []);
    assert.equal(report.counts.INCOMPLETE, vectors.length - affected);
    for (const [index, row] of report.results.entries()) {
      if (index < affected) {
        assert.equal(row.status, faulty && index === faultIndex ? "BEHAVIORAL_DIVERGENCE" : "PASS");
        assert(row.observed, "completed answers must be retained");
      } else {
        assert.equal(row.status, "INCOMPLETE");
        assert.equal(row.observed, null);
        assert.deepEqual(row.expected, vectors[index].expected);
        assert.equal(row.evidence.note, index === affected ? "reader_snapshot_changed" : "not_run_after_reader_snapshot_changed");
        assert(markdown.includes(row.vector_id), "readable export must enumerate the incomplete case");
      }
    }
    assert.match(report.verdict_meaning, /run stopped.*reader.*changed/i);
    assert(markdown.includes(report.verdict_meaning));
    assert.match(child.stdout, new RegExp(`verdict: ${report.verdict} `));
    assert.deepEqual(report.limits, { timeout_ms_per_case: 3000, max_stdout_bytes: 262144, max_stderr_bytes: 65536 });
  });
}

test("unchanged snapshot still exports the complete matching twin", () => {
  const { child, report, control } = run(0);
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(control, { reads: vectors.length * 2, changed: false });
  assert.equal(report.verdict, "ALL_MATCHED");
  assert.deepEqual(report.counts, { PASS: vectors.length });
  assert.deepEqual(report.results.map(r => r.vector_id), ids);
  assert.deepEqual(report.execution_error_vector_ids, []);
  assert.doesNotMatch(report.verdict_meaning, /stopped|snapshot/);
});
