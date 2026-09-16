import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  runConformance,
  loadCorpus,
  loadProfile,
  loadDemoTargets,
  loadProbeTargets,
} from "../src/lib/runner.js";
import { payloadDigest } from "../src/lib/canonical.js";

describe("raven-conformance Challenge 1 demos", () => {
  it("loads profile, corpus, and three demo targets", () => {
    const profile = loadProfile();
    const corpus = loadCorpus();
    const targets = loadDemoTargets();
    assert.equal(profile.data.name, "raven-canonical-envelope/1");
    assert.equal(corpus.data.vectors.length, 10);
    assert.equal(corpus.digest, corpus.declaredDigest);
    assert.deepEqual(
      targets.map((t) => t.id),
      ["CONFORMANT_REFERENCE", "BROKEN_OBVIOUS", "BROKEN_SUBTLE"],
    );
    assert.ok(loadProbeTargets().length >= 8);
  });

  it("CONFORMANT_REFERENCE passes entire corpus", async () => {
    const report = await runConformance("CONFORMANT_REFERENCE", { write: false });
    assert.equal(report.summary.overall, "CONFORMANT");
    assert.equal(report.summary.pass, 10);
    assert.equal(report.summary.divergence, 0);
    assert.equal(report.summary.counts.BEHAVIORAL_DIVERGENCE, 0);
    assert.ok(report.report_content_digest_sha256);
    assert.ok(report.deterministic_report_sha256);
    assert.ok(report.isolation);
    assert.ok(["sandbox_exec", "curated_demo"].includes(report.isolation.mode));
    assert.equal(typeof report.isolation.verified, "boolean");
    assert.ok(report.reproduction.one_liner.includes("CONFORMANT_REFERENCE"));
    // Never claim verified isolation without sandbox_exec success
    if (report.isolation.mode === "curated_demo") {
      assert.equal(report.isolation.verified, false);
    }
    if (report.isolation.mode === "sandbox_exec") {
      assert.equal(report.isolation.verified, true);
    }
  });

  it("BROKEN_OBVIOUS diverges on reject-expected vectors (negative control)", async () => {
    const report = await runConformance("BROKEN_OBVIOUS", { write: false });
    assert.equal(report.summary.overall, "DIVERGENT");
    assert.ok(report.summary.divergence >= 6, "obvious break must fail many reject vectors");
    const rejectExpected = report.results.filter((r) => r.expected.decision === "REJECT");
    const badAccepts = rejectExpected.filter((r) => r.observed.decision === "ACCEPT");
    assert.ok(badAccepts.length >= 6);
    for (const r of badAccepts) {
      assert.equal(r.status, "BEHAVIORAL_DIVERGENCE");
    }
  });

  it("BROKEN_SUBTLE diverges only on unexpected-field probes (subtle negative control)", async () => {
    const report = await runConformance("BROKEN_SUBTLE", { write: false });
    assert.equal(report.summary.overall, "DIVERGENT");
    const unexpected = report.results.filter((r) => r.vector_id.includes("unexpected"));
    assert.ok(unexpected.length >= 2);
    for (const r of unexpected) {
      assert.equal(r.status, "BEHAVIORAL_DIVERGENCE");
      assert.equal(r.expected.decision, "REJECT");
      assert.equal(r.observed.decision, "ACCEPT");
    }
    const digest = report.results.find((r) => r.vector_id === "V03_digest_mismatch");
    assert.equal(digest.status, "PASS");
    assert.equal(digest.observed.decision, "REJECT");
  });

  it("canonical payload digest is deterministic", () => {
    const a = payloadDigest({ b: 1, a: 2 });
    const b = payloadDigest({ a: 2, b: 1 });
    assert.equal(a, b);
  });

  it("report marks BEHAVIORAL_DIVERGENCE as expectation mismatch only", async () => {
    const report = await runConformance("BROKEN_SUBTLE", { write: false });
    assert.match(report.divergence_definition, /observed decision ≠ specified corpus expectation/i);
    assert.doesNotMatch(JSON.stringify(report.summary), /security.?score/i);
  });

  it("binding digests present", async () => {
    const report = await runConformance("CONFORMANT_REFERENCE", { write: false });
    assert.ok(report.binding.profile_sha256);
    assert.ok(report.binding.corpus_sha256);
    assert.ok(report.binding.target_entry_sha256);
    assert.ok(report.binding.deterministic_report_sha256);
  });
});
