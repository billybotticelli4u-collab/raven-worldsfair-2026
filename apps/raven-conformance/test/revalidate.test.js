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
import {
  revalidate,
  loadBaselineReport,
  compareReports,
  resolveTargetRef,
} from "../src/lib/revalidate.js";
import { runConformance } from "../src/lib/runner.js";
import { APP_ROOT } from "../src/lib/paths.js";

const FIX = path.join(APP_ROOT, "fixtures", "revalidate");
const PASS_FIXTURE = path.join(FIX, "subject_pass.mjs");
const FAIL_FIXTURE = path.join(FIX, "subject_fail.mjs");

describe("revalidate", () => {
  it("resolves approved demo ids and fixture paths", () => {
    const id = resolveTargetRef("CONFORMANT_REFERENCE");
    assert.equal(id.kind, "id");
    assert.equal(id.approved_demo, true);
    const p = resolveTargetRef(PASS_FIXTURE);
    assert.equal(p.kind, "path");
    assert.ok(p.entryAbs.endsWith("subject_pass.mjs"));
  });

  it("pass→pass is UNCHANGED and keeps two immutable reports", async () => {
    const outDir = mkdtempSync(path.join(tmpdir(), "reval-pp-"));
    const r = await revalidate({
      baseline: PASS_FIXTURE,
      proposed: PASS_FIXTURE,
      outDir,
      sessionId: "test_pass_pass",
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

  it("pass→fail is REGRESSED (defect injection)", async () => {
    const outDir = mkdtempSync(path.join(tmpdir(), "reval-pf-"));
    const r = await revalidate({
      baseline: PASS_FIXTURE,
      proposed: FAIL_FIXTURE,
      outDir,
      sessionId: "test_pass_fail",
    });
    assert.equal(r.baselineReport.summary.overall, "CONFORMANT");
    assert.equal(r.proposedReport.summary.overall, "DIVERGENT");
    assert.equal(r.comparison.verdict, "REGRESSED");
    assert.ok(r.comparison.counts.regressions >= 1);
    assert.equal(r.exitCode, 1);
  });

  it("fail→pass is IMPROVED (fix)", async () => {
    const outDir = mkdtempSync(path.join(tmpdir(), "reval-fp-"));
    const r = await revalidate({
      baseline: FAIL_FIXTURE,
      proposed: PASS_FIXTURE,
      outDir,
      sessionId: "test_fail_pass",
    });
    assert.equal(r.comparison.verdict, "IMPROVED");
    assert.ok(r.comparison.counts.improvements >= 1);
    assert.equal(r.exitCode, 0);
  });

  it("fail-closed on missing baseline report", async () => {
    await assert.rejects(
      () =>
        revalidate({
          baselineReportPath: path.join(tmpdir(), "no-such-baseline-report.json"),
          proposed: PASS_FIXTURE,
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
          proposed: PASS_FIXTURE,
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
    // lightweight structural check using two identical synthetic result sets
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
});
