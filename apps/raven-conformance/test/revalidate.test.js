import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  revalidate,
  loadBaselineReport,
  compareReports,
  resolveTargetRef,
} from "../src/lib/revalidate.js";
import { runConformance } from "../src/lib/runner.js";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, "../src/bin/revalidate.js");

describe("revalidate", () => {
  it("resolves registered demo ids only", () => {
    const id = resolveTargetRef("CONFORMANT_REFERENCE");
    assert.equal(id.kind, "id");
    assert.equal(id.id, "CONFORMANT_REFERENCE");
    assert.equal(id.approved_demo, true);
    assert.equal(id.entryAbs, null);
  });

  it("refuses path-like refs with TARGET_NOT_REGISTERED + D1 registration message", () => {
    const pathArgs = [
      "./fixtures/revalidate/subject_pass.mjs",
      "fixtures/revalidate/subject_pass.mjs",
      "/tmp/not-registered.mjs",
      "subject_pass.mjs",
      "..\\windows\\path.js",
    ];
    for (const p of pathArgs) {
      assert.throws(
        () => resolveTargetRef(p),
        (err) =>
          err.code === "TARGET_NOT_REGISTERED" &&
          /targets\/manifests\.json/.test(err.message) &&
          /D1 pattern/.test(err.message),
      );
    }
    assert.throws(
      () => resolveTargetRef("NOT_REGISTERED_AT_ALL"),
      (err) => err.code === "TARGET_NOT_REGISTERED",
    );
  });

  it("REFERENCE→REFERENCE is UNCHANGED with two immutable reports", async () => {
    const outDir = mkdtempSync(path.join(tmpdir(), "reval-rr-"));
    const r = await revalidate({
      baseline: "CONFORMANT_REFERENCE",
      proposed: "CONFORMANT_REFERENCE",
      outDir,
      sessionId: "test_ref_ref",
    });
    assert.equal(r.comparison.verdict, "UNCHANGED");
    assert.equal(r.exitCode, 0);
    assert.equal(r.comparison.counts.regressions, 0);
    assert.ok(r.comparison.counts.unchanged >= 10);
    assert.notEqual(r.baselineReport.run_id, r.proposedReport.run_id);
    assert.ok(existsSync(r.comparisonJsonPath));
    const files = readdirSync(outDir);
    assert.ok(files.some((f) => f.startsWith("baseline_") && f.endsWith(".json")));
    assert.ok(files.some((f) => f.startsWith("proposed_") && f.endsWith(".json")));
  });

  it("REFERENCE→SUBTLE is REGRESSED with exactly 2 regressions", async () => {
    const outDir = mkdtempSync(path.join(tmpdir(), "reval-rs-"));
    const r = await revalidate({
      baseline: "CONFORMANT_REFERENCE",
      proposed: "BROKEN_SUBTLE",
      outDir,
      sessionId: "test_ref_subtle",
    });
    assert.equal(r.baselineReport.summary.overall, "CONFORMANT");
    assert.equal(r.proposedReport.summary.overall, "DIVERGENT");
    assert.equal(r.comparison.verdict, "REGRESSED");
    assert.equal(r.comparison.counts.regressions, 2);
    assert.equal(r.comparison.counts.improvements, 0);
    assert.equal(r.comparison.counts.unchanged, 10);
    assert.equal(r.exitCode, 1);
  });

  it("SUBTLE→REFERENCE is IMPROVED (fix)", async () => {
    const outDir = mkdtempSync(path.join(tmpdir(), "reval-sr-"));
    const r = await revalidate({
      baseline: "BROKEN_SUBTLE",
      proposed: "CONFORMANT_REFERENCE",
      outDir,
      sessionId: "test_subtle_ref",
    });
    assert.equal(r.comparison.verdict, "IMPROVED");
    assert.equal(r.comparison.counts.improvements, 2);
    assert.equal(r.exitCode, 0);
  });

  it("fail-closed on missing baseline report", async () => {
    await assert.rejects(
      () =>
        revalidate({
          baselineReportPath: path.join(tmpdir(), "no-such-baseline-report.json"),
          proposed: "CONFORMANT_REFERENCE",
          outDir: mkdtempSync(path.join(tmpdir(), "reval-miss-")),
        }),
      (err) => err.code === "BASELINE_REPORT_MISSING",
    );
  });

  it("fail-closed on tampered baseline report", async () => {
    const report = await runConformance("CONFORMANT_REFERENCE", { write: true });
    const src = report._written_path;
    assert.ok(src);
    const ok = loadBaselineReport(src);
    assert.equal(ok.deterministic_report_sha256, report.deterministic_report_sha256);

    const dirtyDir = mkdtempSync(path.join(tmpdir(), "reval-tamp-"));
    const dirty = path.join(dirtyDir, "tampered.json");
    const obj = JSON.parse(readFileSync(src, "utf8"));
    obj.summary.overall = "DIVERGENT";
    writeFileSync(dirty, JSON.stringify(obj, null, 2) + "\n");

    await assert.rejects(
      () =>
        revalidate({
          baselineReportPath: dirty,
          proposed: "CONFORMANT_REFERENCE",
          outDir: mkdtempSync(path.join(tmpdir(), "reval-tamp-out-")),
        }),
      (err) => err.code === "BASELINE_REPORT_TAMPERED",
    );
  });

  it("prior failure report is not overwritten by later pass (unique run ids)", async () => {
    const fail = await runConformance("BROKEN_OBVIOUS", { write: true });
    const failPath = fail._written_path;
    const failBody = readFileSync(failPath, "utf8");
    const pass = await runConformance("CONFORMANT_REFERENCE", { write: true });
    assert.notEqual(fail.run_id, pass.run_id);
    assert.notEqual(failPath, pass._written_path);
    assert.equal(readFileSync(failPath, "utf8"), failBody);
    assert.equal(fail.summary.overall, "DIVERGENT");
    assert.equal(pass.summary.overall, "CONFORMANT");
  });

  it("compareReports self is UNCHANGED", () => {
    const mk = (overall) => ({
      corpus: { sha256: "abc" },
      claimed_profile: { sha256: "def" },
      summary: { overall },
      results: [
        { vector_id: "V1", status: "PASS" },
        { vector_id: "V2", status: "PASS" },
      ],
    });
    const c = compareReports(mk("CONFORMANT"), mk("CONFORMANT"));
    assert.equal(c.verdict, "UNCHANGED");
    assert.equal(c.counts.unchanged, 2);
  });

  it("CLI path-like --proposed exits 2 with registration message", () => {
    const r = spawnSync(
      process.execPath,
      [
        BIN,
        "--baseline",
        "CONFORMANT_REFERENCE",
        "--proposed",
        "./fixtures/revalidate/subject_pass.mjs",
      ],
      { encoding: "utf8" },
    );
    assert.equal(r.status, 2);
    const err = (r.stderr || "") + (r.stdout || "");
    assert.match(err, /TARGET_NOT_REGISTERED/);
    assert.match(err, /targets\/manifests\.json/);
    assert.match(err, /D1 pattern/);
  });
});
