import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, rmSync, readFileSync, cpSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { adaptReport } from "../src/lib/displayAdapter.js";
import { runConformance, classifyResult } from "../src/lib/runner.js";
import { loadProfile } from "../src/lib/runner.js";

const root = fileURLToPath(new URL("..", import.meta.url));

async function fixture(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "raven-allerr-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const n of ["src", "targets", "profiles", "corpus", "package.json"]) {
    cpSync(path.join(root, n), path.join(dir, n), { recursive: true });
  }
  const runner = await import(pathToFileURL(path.join(dir, "src/lib/runner.js")));
  return { dir, runner };
}

describe("all-error presentation + affected vector IDs", () => {
  it("keeps C2 taxonomy (no HARNESS_ERROR remap) on crash-after-decision", () => {
    const r = classifyResult(
      { observed: { decision: "ACCEPT" }, exitCode: 17, signal: null, timedOut: false, flooded: false },
      "ACCEPT",
    );
    assert.equal(r.status, "TARGET_CRASH");
    assert.notEqual(r.status, "HARNESS_ERROR");
  });

  it("all-crash run surfaces execution_error_vector_ids and all_execution_errors", async (t) => {
    const f = await fixture(t);
    const target = path.join(f.dir, "targets/CONFORMANT_REFERENCE.mjs");
    writeFileSync(target, readFileSync(target, "utf8") + "\nprocess.exitCode=17;\n");
    const report = await f.runner.runConformance("CONFORMANT_REFERENCE", { write: false });
    assert.equal(report.summary.pass, 0);
    assert.equal(report.summary.counts.TARGET_CRASH, 10);
    assert.equal(report.summary.behavioral_divergence, 0);
    assert.equal(report.summary.overall, "DIVERGENT"); // not remapped to HARNESS_ERROR
    assert.equal(report.summary.all_execution_errors, true);
    assert.equal(report.summary.mixed_execution_and_behavioral, false);
    assert.equal(report.summary.execution_error_vector_ids.length, 10);
    assert.ok(report.summary.presentation_hint.includes("ALL_EXECUTION_ERRORS"));

    const adapted = adaptReport(report, loadProfile().data);
    assert.equal(adapted.display.all_error, true);
    assert.ok(adapted.display.presentation_banner.includes("ALL EXECUTION FAILURES"));
    assert.ok(adapted.display.presentation_banner.includes(report.summary.execution_error_vector_ids[0]));
    assert.deepEqual(adapted.display.execution_error_vector_ids, report.summary.execution_error_vector_ids);
  });

  it("distinguishes mixed execution errors from behavioral mismatches", async () => {
    const report = await runConformance("BROKEN_SUBTLE", { write: false });
    // BROKEN_SUBTLE is behavioral only under normal run
    assert.equal(report.summary.all_execution_errors, false);
    assert.ok(report.summary.behavioral_divergence_vector_ids.length >= 1);
    assert.equal(report.summary.execution_error_vector_ids.length, 0);

    // Synthesize mixed for adapter
    const mixed = structuredClone(report);
    mixed.results[0].status = "TIMEOUT";
    mixed.results[0].observed = { decision: null, timedOut: true };
    mixed.summary.execution_error_vector_ids = [mixed.results[0].vector_id];
    mixed.summary.behavioral_divergence_vector_ids = mixed.results
      .filter((r) => r.status === "BEHAVIORAL_DIVERGENCE")
      .map((r) => r.vector_id);
    mixed.summary.mixed_execution_and_behavioral = true;
    mixed.summary.all_execution_errors = false;
    const adapted = adaptReport(mixed, loadProfile().data);
    assert.equal(adapted.display.mixed_execution_and_behavioral, true);
    assert.equal(adapted.display.all_error, false);
    assert.match(adapted.display.presentation_banner, /MIXED/);
    assert.ok(adapted.display.execution_error_vector_ids.includes(mixed.results[0].vector_id));
  });

  it("empty result set is not labeled PASS", () => {
    const adapted = adaptReport(
      {
        schema: "raven-conformance-report/1",
        summary: { test_count: 0, pass: 0, divergence: 0, overall: "DIVERGENT", counts: {}, empty_result_set: true },
        results: [],
      },
      loadProfile().data,
    );
    assert.equal(adapted.display.empty, true);
    assert.match(adapted.display.presentation_banner, /EMPTY/);
  });

  it("skipped-only rows do not manufacture all_execution_errors success", async (t) => {
    const f = await fixture(t);
    const corpusPath = path.join(f.dir, "corpus/raven-canonical-envelope-demo-corpus-1.json");
    const corpus = JSON.parse(readFileSync(corpusPath, "utf8"));
    for (const v of corpus.vectors) v.skip = true;
    const { sha256Hex } = await import("../src/lib/digest.js");
    const forDigest = {
      id: corpus.id,
      version: corpus.version,
      profile: corpus.profile,
      description: corpus.description,
      vectors: corpus.vectors,
    };
    corpus.content_digest_sha256 = sha256Hex(JSON.stringify(forDigest, null, 2) + "\n");
    writeFileSync(corpusPath, JSON.stringify(corpus, null, 2) + "\n");
    const report = await f.runner.runConformance("CONFORMANT_REFERENCE", { write: false });
    assert.equal(report.summary.counts.SKIPPED_VECTOR, 10);
    assert.equal(report.summary.pass, 0);
    assert.equal(report.summary.all_execution_errors, false);
    assert.equal(report.summary.overall, "CONFORMANT"); // existing skip+pass policy: all skipped ⇒ CONFORMANT
    assert.equal(report.summary.skipped_vector_ids.length, 10);
    // Must not claim execution-error banner
    const adapted = adaptReport(report, loadProfile().data);
    assert.equal(adapted.display.all_error, false);
  });

  it("interrupted run is INCOMPLETE with affected vector id", async (t) => {
    const f = await fixture(t);
    const ac = new AbortController();
    ac.abort();
    const report = await f.runner.runConformance("CONFORMANT_REFERENCE", { write: false, signal: ac.signal });
    assert.equal(report.summary.overall, "INCOMPLETE");
    assert.ok(report.summary.execution_error_vector_ids.length >= 1);
    assert.ok(report.summary.counts.INCOMPLETE >= 1);
    assert.notEqual(report.summary.overall, "CONFORMANT");
  });
});
