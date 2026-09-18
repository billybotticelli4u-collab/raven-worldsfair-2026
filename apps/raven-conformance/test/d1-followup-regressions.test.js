/**
 * D1 follow-up regressions (empty-corpus non-success, stderr-independent lock,
 * Linux runner --permission enforcement mutant). Does not rewrite R1–R3.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  cpSync,
  rmSync,
  existsSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  checkEscapedTranscriptSizes,
  serializedEvidenceBytes,
  ESCAPED_STDOUT_LIMIT_BYTES,
  ESCAPED_STDERR_LIMIT_BYTES,
  replayReport,
} from "../src/lib/replay.js";
import {
  runConformance,
  computeDeterministicDigest,
  loadProfile,
} from "../src/lib/runner.js";
import { sha256Hex } from "../src/lib/digest.js";
import { adaptReport } from "../src/lib/displayAdapter.js";
import { FAIR_BUILT } from "../src/lib/buildInfo.js";
import {
  createRunWorkdir,
  cleanupWorkdir,
  resolveIsolation,
  spawnIsolated,
  buildNodePermissionArgs,
} from "../src/lib/isolation.js";

const root = fileURLToPath(new URL("..", import.meta.url));

async function fixture(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "raven-d1fu-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const n of ["src", "targets", "profiles", "corpus", "package.json"]) {
    cpSync(path.join(root, n), path.join(dir, n), { recursive: true });
  }
  const runner = await import(pathToFileURL(path.join(dir, "src/lib/runner.js")));
  return { dir, runner };
}

function resealReport(report) {
  delete report.binding.deterministic_report_sha256;
  report.deterministic_report_sha256 = computeDeterministicDigest(report);
  report.binding.deterministic_report_sha256 = report.deterministic_report_sha256;
  const { _written_path, report_content_digest_sha256, deterministic_report_sha256, ...body } =
    report;
  report.report_content_digest_sha256 = sha256Hex(JSON.stringify(body, null, 2) + "\n");
  return report;
}

function recomputeCorpusDigest(corpus) {
  const forDigest = {
    id: corpus.id,
    version: corpus.version,
    profile: corpus.profile,
    description: corpus.description,
    vectors: corpus.vectors,
  };
  corpus.content_digest_sha256 = sha256Hex(JSON.stringify(forDigest, null, 2) + "\n");
  return corpus;
}

describe("D1 follow-up: empty-corpus non-success", () => {
  it("real empty corpus with honest digest → INCOMPLETE (not CONFORMANT)", async (t) => {
    const f = await fixture(t);
    const corpusPath = path.join(f.dir, "corpus/raven-canonical-envelope-demo-corpus-1.json");
    const corpus = JSON.parse(readFileSync(corpusPath, "utf8"));
    corpus.vectors = [];
    recomputeCorpusDigest(corpus);
    writeFileSync(corpusPath, JSON.stringify(corpus, null, 2) + "\n");

    const report = await f.runner.runConformance("CONFORMANT_REFERENCE", { write: false });
    assert.equal(report.corpus.vector_count, 0);
    assert.equal(report.summary.test_count, 0);
    assert.equal(report.summary.pass, 0);
    assert.equal(report.summary.empty_result_set, true);
    assert.equal(report.summary.overall, "INCOMPLETE");
    assert.notEqual(report.summary.overall, "CONFORMANT");
    assert.match(report.summary.presentation_hint || "", /EMPTY|INCOMPLETE/i);

    const adapted = adaptReport(report, loadProfile().data);
    assert.equal(adapted.display.empty, true);
    assert.equal(adapted.display.overall_engine, "INCOMPLETE");
    assert.match(adapted.display.presentation_banner || "", /EMPTY|non-success|INCOMPLETE/i);
    // Engine ↔ display: neither claims success
    assert.notEqual(adapted.display.overall_engine, "CONFORMANT");
  });

  it("CLI exits non-zero for empty corpus; replay of empty run stays non-success", async (t) => {
    const f = await fixture(t);
    const corpusPath = path.join(f.dir, "corpus/raven-canonical-envelope-demo-corpus-1.json");
    const corpus = JSON.parse(readFileSync(corpusPath, "utf8"));
    corpus.vectors = [];
    recomputeCorpusDigest(corpus);
    writeFileSync(corpusPath, JSON.stringify(corpus, null, 2) + "\n");

    const report = await f.runner.runConformance("CONFORMANT_REFERENCE", {
      write: true,
      runId: "empty_corpus_followup",
    });
    assert.equal(report.summary.overall, "INCOMPLETE");

    // CLI path against the fixture tree
    const cli = spawnSync(
      process.execPath,
      [path.join(f.dir, "src/cli.js"), "--target", "CONFORMANT_REFERENCE"],
      { cwd: f.dir, encoding: "utf8", timeout: 60000, env: { ...process.env } },
    );
    assert.notEqual(cli.status, 0, `CLI must non-zero for empty corpus; stderr=${cli.stderr}`);

    // Synthetic adapter empty with engine INCOMPLETE is consistent
    const adapted = adaptReport(
      {
        schema: "raven-conformance-report/1",
        summary: {
          test_count: 0,
          pass: 0,
          divergence: 0,
          overall: "INCOMPLETE",
          counts: {},
          empty_result_set: true,
        },
        results: [],
      },
      loadProfile().data,
    );
    assert.equal(adapted.display.overall_engine, "INCOMPLETE");
    assert.equal(adapted.display.empty, true);
  });

  it("preserves all-skipped CONFORMANT and all-crash DIVERGENT policies", async (t) => {
    // all-skipped
    {
      const f = await fixture(t);
      const corpusPath = path.join(f.dir, "corpus/raven-canonical-envelope-demo-corpus-1.json");
      const corpus = JSON.parse(readFileSync(corpusPath, "utf8"));
      for (const v of corpus.vectors) v.skip = true;
      recomputeCorpusDigest(corpus);
      writeFileSync(corpusPath, JSON.stringify(corpus, null, 2) + "\n");
      const report = await f.runner.runConformance("CONFORMANT_REFERENCE", { write: false });
      assert.equal(report.summary.counts.SKIPPED_VECTOR, 12);
      assert.ok(report.results.some((r) => r.vector_id === "V11_proto_digest_includes_member"));
      assert.ok(report.results.some((r) => r.vector_id === "V12_proto_digest_omits_member"));
      assert.equal(report.summary.overall, "CONFORMANT");
    }
    // all-crash remains DIVERGENT (not remapped)
    {
      const f = await fixture(t);
      const target = path.join(f.dir, "targets/CONFORMANT_REFERENCE.mjs");
      writeFileSync(target, readFileSync(target, "utf8") + "\nprocess.exitCode=17;\n");
      const report = await f.runner.runConformance("CONFORMANT_REFERENCE", { write: false });
      assert.equal(report.summary.overall, "DIVERGENT");
      assert.equal(report.summary.all_execution_errors, true);
    }
  });
});

describe("D1 follow-up: stderr escaped-transcript lock (independent)", () => {
  it("boundary at stderr limit passes; one-byte-over fails check + replay", async () => {
    const report = await runConformance("CONFORMANT_REFERENCE", { write: false });
    const dir = mkdtempSync(path.join(os.tmpdir(), "raven-stderr-bound-"));
    try {
      // Find a raw string whose JSON.stringify UTF-8 length equals the limit.
      // ASCII letters stringify as "\"...\"", so escaped = raw + 2.
      // Use backslashes to inflate: each "\\" becomes "\\\\" in JSON (2→4 chars).
      // Simpler: craft stderr of length L such that serializedEvidenceBytes == limit.
      let atLimit = "A".repeat(ESCAPED_STDERR_LIMIT_BYTES - 2); // JSON quotes add 2
      assert.equal(serializedEvidenceBytes(atLimit), ESCAPED_STDERR_LIMIT_BYTES);

      report.results[0].evidence.stderr = atLimit;
      report.results[0].evidence.stdout = ""; // keep stdout well under
      resealReport(report);
      const okCheck = checkEscapedTranscriptSizes(report);
      assert.equal(okCheck.ok, true, JSON.stringify(okCheck.diffs));

      const fileOk = path.join(dir, "at-limit.json");
      writeFileSync(fileOk, JSON.stringify(report));
      // Replay may fail bundle identity if corpus differs — but size check must pass first.
      // Use check only for boundary; for over, assert replay error is escaped_transcript_limit.

      // One-byte over: add one more char → serialized = limit + 1
      const over = atLimit + "B";
      assert.equal(serializedEvidenceBytes(over), ESCAPED_STDERR_LIMIT_BYTES + 1);
      report.results[0].evidence.stderr = over;
      resealReport(report);
      const overCheck = checkEscapedTranscriptSizes(report);
      assert.equal(overCheck.ok, false);
      assert.ok(
        overCheck.diffs.some(
          (d) => d.error === "escaped_transcript_limit" && /stderr/.test(d.field),
        ),
        JSON.stringify(overCheck.diffs),
      );
      // stdout must NOT be the failing field
      assert.ok(!overCheck.diffs.some((d) => /stdout/.test(d.field)));

      const fileOver = path.join(dir, "over.json");
      writeFileSync(fileOver, JSON.stringify(report));
      const replay = await replayReport(fileOver, { write: false });
      assert.equal(replay.ok, false);
      assert.equal(replay.error, "escaped_transcript_limit");
      assert.equal(replay.attestation, false);
      assert.ok(replay.diffs.some((d) => /stderr/.test(d.field)));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("mutant removing only stderr guard → stderr-over test FAIL", () => {
    const isoDir = mkdtempSync(path.join(os.tmpdir(), "raven-stderr-mutant-"));
    try {
      const mutantPath = path.join(isoDir, "replay-mutant.js");
      let src = readFileSync(path.join(root, "src/lib/replay.js"), "utf8");
      // Remove ONLY the stderr guard block (leave stdout intact).
      const guard = `    if (errBytes > ESCAPED_STDERR_LIMIT_BYTES) {
      diffs.push({
        field: \`results[\${i}].evidence.stderr\`,
        error: "escaped_transcript_limit",
        vector_id: r?.vector_id,
        serialized_utf8_bytes: errBytes,
        limit: ESCAPED_STDERR_LIMIT_BYTES,
        encoding: "utf8",
        representation: "JSON.stringify(stderr)",
      });
    }`;
      // Source uses template literals — match via simpler markers
      const start = src.indexOf("if (errBytes > ESCAPED_STDERR_LIMIT_BYTES)");
      assert.ok(start > 0, "stderr guard must exist in source");
      const end = src.indexOf("}", src.indexOf("representation: \"JSON.stringify(stderr)\"", start)) + 1;
      assert.ok(end > start, "stderr guard end");
      const mutant = src.slice(0, start) + "/* stderr guard removed */\n    " + src.slice(end);
      assert.ok(!mutant.includes("if (errBytes > ESCAPED_STDERR_LIMIT_BYTES)"));
      assert.ok(mutant.includes("if (outBytes > ESCAPED_STDOUT_LIMIT_BYTES)"));
      writeFileSync(mutantPath, mutant);

      const harness = path.join(isoDir, "harness.mjs");
      writeFileSync(
        harness,
        `
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
const m = await import(pathToFileURL(${JSON.stringify(mutantPath)}).href);
const limit = m.ESCAPED_STDERR_LIMIT_BYTES;
const at = "A".repeat(limit - 2);
const over = at + "B";
assert.equal(m.serializedEvidenceBytes(over), limit + 1);
const check = m.checkEscapedTranscriptSizes({
  results: [{ vector_id: "V1", evidence: { stdout: "", stderr: over } }],
});
assert.equal(check.ok, false, "mutant must still fail — if this passes, stderr guard was required");
`,
      );
      // With mutant, check.ok will be TRUE (guard gone) → harness assert fails → status != 0
      // Rewrite harness to expect the mutant to incorrectly pass, proving the test would fail.
      writeFileSync(
        harness,
        `
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
const m = await import(pathToFileURL(${JSON.stringify(mutantPath)}).href);
const limit = m.ESCAPED_STDERR_LIMIT_BYTES;
const over = "A".repeat(limit - 2) + "B";
const check = m.checkEscapedTranscriptSizes({
  results: [{ vector_id: "V1", evidence: { stdout: "", stderr: over } }],
});
// Fixed code would set ok=false. Mutant incorrectly sets ok=true.
// This assertion documents that the stderr-over regression FAILS under the mutant.
assert.equal(check.ok, false);
`,
      );
      const run = spawnSync(process.execPath, [harness], { encoding: "utf8", timeout: 10000 });
      assert.notEqual(run.status, 0, "stderr-only mutant must make over-limit assertion fail");
      assert.match(run.stderr + run.stdout, /AssertionError|ok/i);
    } finally {
      rmSync(isoDir, { recursive: true, force: true });
    }
  });
});

describe("D1 follow-up: actual runner --permission enforcement", () => {
  it("spawnIsolated denies write/child/worker; unrestricted positive controls succeed", async (t) => {
    if (process.platform !== "linux") {
      t.skip("Linux-only: actual Node --permission runner path");
      return;
    }
    const work = createRunWorkdir("d1fu_perm");
    const scratch = mkdtempSync(path.join(os.tmpdir(), "raven-d1fu-pos-"));
    t.after(() => {
      cleanupWorkdir(work);
      rmSync(scratch, { recursive: true, force: true });
    });
    const isolation = resolveIsolation(work);
    assert.equal(isolation.mode, "node_permissions");
    assert.equal(isolation.verified, true);

    const outside = path.join(scratch, "outside.txt");
    const entry = path.join(work, "hostile.mjs");
    writeFileSync(
      entry,
      `import { writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { Worker } from "node:worker_threads";
const out = ${JSON.stringify(outside)};
const result = { write: null, child: null, worker: null };
try { writeFileSync(out, "escaped"); result.write = "ok"; } catch (e) { result.write = e.code || String(e); }
try { spawn(process.execPath, ["-e", "1"], { stdio: "ignore" }); result.child = "ok"; }
catch (e) { result.child = e.code || String(e); }
try { new Worker("1+1", { eval: true }); result.worker = "ok"; }
catch (e) { result.worker = e.code || String(e); }
process.stdout.write(JSON.stringify({ decision: "ACCEPT", ...result }));
`,
    );

    const pos = spawnSync(process.execPath, [entry], { encoding: "utf8", timeout: 5000 });
    assert.equal(pos.status, 0, pos.stderr);
    const posObs = JSON.parse(pos.stdout);
    assert.equal(posObs.write, "ok");
    assert.equal(posObs.child, "ok");
    assert.equal(posObs.worker, "ok");
    assert.equal(existsSync(outside), true);
    rmSync(outside, { force: true });

    const built = buildNodePermissionArgs(entry);
    assert.ok(built.args.includes("--permission"));
    assert.ok(built.args.some((a) => a.startsWith("--allow-fs-read=")));

    const sandboxed = await spawnIsolated({
      entryAbs: entry,
      inputObj: {},
      workDir: work,
      isolation,
    });
    assert.equal(sandboxed.exitCode, 0, sandboxed.stderr);
    assert.equal(sandboxed.observed.write, "ERR_ACCESS_DENIED");
    assert.equal(sandboxed.observed.child, "ERR_ACCESS_DENIED");
    assert.equal(sandboxed.observed.worker, "ERR_ACCESS_DENIED");
    assert.equal(existsSync(outside), false);
  });

  it("mutant removing runner --permission → enforcement FAIL", async (t) => {
    if (process.platform !== "linux") {
      t.skip("Linux-only: --permission mutant");
      return;
    }
    const dir = mkdtempSync(path.join(os.tmpdir(), "raven-perm-mutant-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));

    // Copy isolation module and strip --permission from buildNodePermissionArgs only.
    let src = readFileSync(path.join(root, "src/lib/isolation.js"), "utf8");
    const mutantSrc = src.replace(
      'args: ["--permission", `--allow-fs-read=${realEntry}`, realEntry],',
      'args: [`--allow-fs-read=${realEntry}`, realEntry], /* --permission removed */',
    );
    assert.notEqual(mutantSrc, src);
    assert.ok(!/args:\s*\["--permission"/.test(mutantSrc));
    writeFileSync(path.join(dir, "isolation-mutant.js"), mutantSrc);

    // Also need digest/paths deps — simpler: inline harness that imports mutant and spawnIsolated
    // The mutant file still has relative imports to digest etc — copy full src/lib
    cpSync(path.join(root, "src/lib"), path.join(dir, "lib"), { recursive: true });
    writeFileSync(
      path.join(dir, "lib/isolation.js"),
      mutantSrc.replace(/from "\.\/paths\.js"/g, 'from "./paths.js"'),
    );

    const harness = path.join(dir, "harness.mjs");
    writeFileSync(
      harness,
      `
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

const lib = await import(pathToFileURL(${JSON.stringify(path.join(dir, "lib/isolation.js"))}).href);
const work = lib.createRunWorkdir("mutant_perm");
const scratch = mkdtempSync(path.join(os.tmpdir(), "mut-pos-"));
try {
  const isolation = lib.resolveIsolation(work);
  assert.equal(isolation.mode, "node_permissions");
  const outside = path.join(scratch, "out.txt");
  const entry = path.join(work, "h.mjs");
  writeFileSync(entry, \`import { writeFileSync } from "node:fs";
try { writeFileSync(\${JSON.stringify(outside)}, "x"); console.log(JSON.stringify({decision:"ACCEPT",write:"ok"})); }
catch(e){ console.log(JSON.stringify({decision:"ACCEPT",write:e.code||String(e)})); }
\`);
  const sandboxed = await lib.spawnIsolated({ entryAbs: entry, inputObj: {}, workDir: work, isolation });
  // Under mutant (no --permission), write succeeds → observed.write === "ok"
  // Enforcement test requires ERR_ACCESS_DENIED — so this assert fails under mutant.
  assert.equal(sandboxed.observed?.write, "ERR_ACCESS_DENIED");
} finally {
  lib.cleanupWorkdir(work);
  rmSync(scratch, { recursive: true, force: true });
}
`,
    );
    const run = spawnSync(process.execPath, [harness], {
      encoding: "utf8",
      timeout: 20000,
      cwd: dir,
    });
    assert.notEqual(run.status, 0, `permission mutant must fail enforcement; out=${run.stdout} err=${run.stderr}`);
  });
});

describe("D1 follow-up: disclosure", () => {
  it("About FAIR_BUILT explicitly states Node permissions do not restrict network", () => {
    const runnerLine = FAIR_BUILT.find((x) => /Challenge 1 bounded runner/i.test(x));
    assert.ok(runnerLine);
    assert.match(runnerLine, /Node --permission/i);
    assert.match(runnerLine, /do NOT restrict network|NOT restrict network/i);
  });

  it("documents nested disclosure tests: 84 Linux vs 87 Darwin totals", () => {
    // Documentation-only: disclosure-regressions.test.js nests three runtime
    // t.test() calls inside the Darwin-only Seatbelt disclosure test:
    //   - two via for-loop over allowed_resources.filesystem + isolation.details
    //   - one verified_controls assertion
    // On Linux the outer test is skipped, so those three nested tests do not
    // register — producing 84 tests on Linux vs 87 on Darwin. Document only;
    // do not change tests merely to equalize totals.
    const src = readFileSync(
      path.join(root, "test/disclosure-regressions.test.js"),
      "utf8",
    );
    assert.match(src, /Seatbelt is Darwin-only/);
    assert.match(src, /allowed_resources\.filesystem/);
    assert.match(src, /isolation\.details/);
    assert.match(src, /verified_controls/);
    // Source has one await t.test(field) in a 2-iteration loop + one named.
    assert.match(src, /await t\.test\(field/);
    assert.match(src, /await t\.test\('verified_controls'/);
    const callSites = [...src.matchAll(/await t\.test\(/g)].length;
    assert.equal(callSites, 2, "two call sites; loop expands to three nested tests at runtime");
  });
});
