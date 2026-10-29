import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, symlinkSync, linkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkReader } from "../check-reader.mjs";
import { loadCorpus } from "../../raven-conformance/src/lib/runner.js";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reference = readFileSync(path.join(KIT, "readers/reference-reader.mjs"), "utf8");
const faulty = readFileSync(path.join(KIT, "readers/faulty-reader-no-size-cap.mjs"), "utf8");
const sha = b => createHash("sha256").update(b).digest("hex");
const fixture = () => mkdtempSync(path.join(tmpdir(), "raven-kit-binding-"));
const insert = (source, code) => source.replace(/^(#![^\n]*\n)/, "$1" + code + "\n");

for (const [name, before, after, verdict] of [
  ["faulty-to-reference", faulty, reference, "DIVERGENT"],
  ["reference-to-faulty", reference, faulty, "ALL_MATCHED"],
]) {
  test(`reader identity remains bound after ${name} source replacement`, async () => {
    const entry = path.join(fixture(), "reader.mjs");
    writeFileSync(entry, before);
    // checkReader captures synchronously before its first await. By V21, the
    // original path has certainly changed, irrespective of first-child timing.
    const running = checkReader(entry, { runId: `binding-${name}` });
    writeFileSync(entry, after);
    const report = await running;
    assert.equal(report.reader.sha256, sha(before));
    assert.equal(report.verdict, verdict);
    assert.deepEqual(report.divergent_vector_ids, verdict === "DIVERGENT" ? ["V21_v1_size_cap_exceeded"] : []);
    assert.equal(report.execution_error_vector_ids.length, 0);
    assert.equal(readFileSync(entry, "utf8"), after);
  });
}

test("reader cannot rewrite its captured execution file", async () => {
  const entry = path.join(fixture(), "reader.mjs");
  const guarded = insert(reference, `import {writeFileSync as attemptWrite,chmodSync as attemptChmod} from 'node:fs';
import {fileURLToPath as ownPath} from 'node:url';
try { attemptChmod(ownPath(import.meta.url), 0o600); attemptWrite(ownPath(import.meta.url), 'throw new Error("rewritten");'); process.stderr.write('WRITE_ALLOWED'); }
catch(e) { process.stderr.write('WRITE_DENIED:'+e.code); }`);
  writeFileSync(entry, guarded);
  const report = await checkReader(entry, { runId: "binding-self-write" });
  assert.equal(report.verdict, "ALL_MATCHED");
  assert.deepEqual(report.counts, { PASS: 30 });
  assert.equal(report.reader.sha256, sha(guarded));
  assert.equal(readFileSync(entry, "utf8"), guarded);
  for (const row of report.results) assert.match(row.evidence.stderr, /WRITE_DENIED:(EPERM|EACCES|ERR_ACCESS_DENIED)/);
});

test("change-and-change-back cannot make faulty bytes receive a reference verdict", { skip: process.platform !== "darwin" }, async () => {
  // This event-driven control uses a task-owned temp marker, allowed by the
  // Mac policy. Linux's write-denying permission mode uses the two tests above.
  const dir = fixture(), entry = path.join(dir, "reader.mjs");
  const marker = path.join(dir, "v21-started"), release = path.join(dir, "release");
  const v21 = loadCorpus("raven-solana-txversion-experimental/0").data.vectors.find(v => v.id === "V21_v1_size_cap_exceeded");
  const barrier = `import {writeFileSync as mark,existsSync as released} from 'node:fs';
if (raw === ${JSON.stringify(JSON.stringify(v21.input))}) {
  mark(${JSON.stringify(marker)}, 'v21'); const deadline = Date.now()+2000;
  while (!released(${JSON.stringify(release)})) { if(Date.now()>deadline) throw new Error('barrier_timeout'); await new Promise(r=>setTimeout(r,5)); }
}

`;
  const withBarrier = source => source.replace('process.stdout.write(JSON.stringify(out) + "\\n");', barrier + 'process.stdout.write(JSON.stringify(out) + "\\n");');
  const original = withBarrier(faulty), replacement = withBarrier(reference);
  assert.notEqual(original, faulty);
  writeFileSync(entry, original);
  const running = checkReader(entry, { runId: "binding-change-back" });
  writeFileSync(entry, replacement);
  const deadline = Date.now() + 5000;
  while (!existsSync(marker)) { assert(Date.now() < deadline, "V21 barrier not reached"); await new Promise(r => setTimeout(r, 5)); }
  writeFileSync(entry, original);
  writeFileSync(release, "release");
  const report = await running;
  assert.equal(sha(readFileSync(entry)), sha(original));
  assert.equal(report.reader.sha256, sha(original));
  assert.equal(report.verdict, "DIVERGENT");
  assert.deepEqual(report.divergent_vector_ids, ["V21_v1_size_cap_exceeded"]);
  assert.equal(report.execution_error_vector_ids.length, 0);
});

for (const shape of ["same", "normalized", "symlink", "hardlink", "symlink-parent", "reader", "reader-symlink", "reader-hardlink"]) {
  test(`CLI refuses ${shape} export aliases before changing any file`, () => {
    const dir = fixture(), reader = path.join(dir, "reader.mjs"), output = path.join(dir, "result.json");
    writeFileSync(reader, reference);
    let out = output, explain = path.join(dir, "summary.md");
    const sentinel = "PRESERVE_EXISTING_REPORT";
    if (shape === "same") { writeFileSync(out, sentinel); explain = out; }
    if (shape === "normalized") { writeFileSync(out, sentinel); explain = path.join(dir, "unused", "..", "result.json"); }
    if (shape === "symlink") { writeFileSync(out, sentinel); symlinkSync(out, explain); }
    if (shape === "hardlink") { writeFileSync(out, sentinel); linkSync(out, explain); }
    if (shape === "symlink-parent") { const alias = path.join(dir, "alias"); symlinkSync(dir, alias); explain = path.join(alias, "result.json"); }
    if (shape === "reader") out = reader;
    if (shape === "reader-symlink") symlinkSync(reader, out);
    if (shape === "reader-hardlink") linkSync(reader, out);
    const before = new Map([reader, out, explain].filter(p => existsSync(p)).map(p => [p, readFileSync(p)]));
    const r = spawnSync(process.execPath, [path.join(KIT, "check-reader.mjs"), "--reader", reader, "--out", out, "--explain", explain, "--run-id", "export-alias"], { encoding: "utf8", timeout: 10000 });
    assert.equal(r.status, 2, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /output_path_collision/);
    assert.doesNotMatch(r.stdout, /verdict:/);
    for (const [p, bytes] of before) assert.deepEqual(readFileSync(p), bytes);
    for (const p of [out, explain]) if (!before.has(p)) assert.equal(existsSync(p), false);
  });
}

test("colliding exports refuse before executing the reader", { skip: process.platform !== "darwin" }, () => {
  const dir = fixture(), reader = path.join(dir, "reader.mjs"), marker = path.join(dir, "executed");
  writeFileSync(reader, insert(reference, `import {writeFileSync as mark} from 'node:fs'; mark(${JSON.stringify(marker)},'executed');`));
  const out = path.join(dir, "output.json");
  const r = spawnSync(process.execPath, [path.join(KIT, "check-reader.mjs"), "--reader", reader, "--out", out, "--explain", out], { encoding: "utf8", timeout: 10000 });
  assert.equal(r.status, 2);
  assert.equal(existsSync(marker), false);
  assert.equal(existsSync(out), false);
});

test("reports distinguish captured bytes, digest kinds and measured isolation", async () => {
  const report = await checkReader(path.join(KIT, "readers/reference-reader.mjs"), { runId: "binding-report-contract" });
  const corpus = loadCorpus("raven-solana-txversion-experimental/0");
  assert.equal(report.reader.execution_binding, "captured_single_file");
  assert.equal(report.corpus.digest_kind, "canonical_content");
  assert.equal(report.corpus.sha256, corpus.digest);
  assert.equal(report.corpus.file_sha256, sha(readFileSync(corpus.path)));
  assert.notEqual(report.corpus.sha256, report.corpus.file_sha256);
  assert(Array.isArray(report.isolation.verified_controls));
  assert(Array.isArray(report.isolation.assumed_controls));
  assert.doesNotMatch(report.evidence_kind, /no chain, RPC or network data was read/);
  assert.equal(report.runtime.electron, null);
  assert.deepEqual(report.limits, { timeout_ms_per_case: 3000, max_stdout_bytes: 262144, max_stderr_bytes: 65536 });
});
