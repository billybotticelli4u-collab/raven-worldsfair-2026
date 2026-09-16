import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { runConformance } from "../src/lib/runner.js";
import { replayReport, checkBundleIdentities, compareSemantic } from "../src/lib/replay.js";
import { REPORTS_DIR } from "../src/lib/paths.js";
import { createRunWorkdir, cleanupWorkdir } from "../src/lib/isolation.js";

describe("replay + concurrent uniqueness", () => {
  it("replay CONFORMANT_REFERENCE matches semantically", async () => {
    const report = await runConformance("CONFORMANT_REFERENCE", { write: true });
    assert.ok(report._written_path);
    const replay = await replayReport(report._written_path, { write: false });
    assert.equal(replay.bundle_match, true);
    assert.equal(replay.semantic_match, true);
    assert.equal(replay.ok, true);
    assert.equal(replay.original_overall, "CONFORMANT");
    assert.equal(replay.replay_overall, "CONFORMANT");
  });

  it("replay BROKEN_SUBTLE preserves divergence semantics", async () => {
    const report = await runConformance("BROKEN_SUBTLE", { write: true });
    const replay = await replayReport(report._written_path, { write: false });
    assert.equal(replay.ok, true);
    assert.equal(replay.original_overall, "DIVERGENT");
    assert.equal(replay.replay_overall, "DIVERGENT");
  });

  it("bundle check fails on tampered corpus digest", async () => {
    const report = await runConformance("CONFORMANT_REFERENCE", { write: false });
    const tampered = structuredClone(report);
    tampered.binding.corpus_sha256 = "0".repeat(64);
    tampered.corpus.sha256 = "0".repeat(64);
    const check = checkBundleIdentities(tampered);
    assert.equal(check.ok, false);
    assert.ok(check.diffs.some((d) => d.field === "corpus_sha256"));
  });

  it("concurrent runs get unique workdirs", async () => {
    const a = createRunWorkdir("conc_a");
    const b = createRunWorkdir("conc_b");
    try {
      assert.notEqual(a, b);
      const [r1, r2] = await Promise.all([
        runConformance("CONFORMANT_REFERENCE", { write: false, runId: "conc_run_1" }),
        runConformance("CONFORMANT_REFERENCE", { write: false, runId: "conc_run_2" }),
      ]);
      assert.notEqual(r1.run_id, r2.run_id);
      assert.equal(r1.summary.overall, "CONFORMANT");
      assert.equal(r2.summary.overall, "CONFORMANT");
    } finally {
      cleanupWorkdir(a);
      cleanupWorkdir(b);
    }
  });

  it("compareSemantic detects status drift", () => {
    const a = {
      summary: { overall: "CONFORMANT", counts: { PASS: 1 } },
      results: [{ vector_id: "V1", status: "PASS", expected: { decision: "ACCEPT" }, observed: { decision: "ACCEPT" } }],
    };
    const b = {
      summary: { overall: "DIVERGENT", counts: { BEHAVIORAL_DIVERGENCE: 1 } },
      results: [
        {
          vector_id: "V1",
          status: "BEHAVIORAL_DIVERGENCE",
          expected: { decision: "ACCEPT" },
          observed: { decision: "REJECT" },
        },
      ],
    };
    const c = compareSemantic(a, b);
    assert.equal(c.ok, false);
  });
});
