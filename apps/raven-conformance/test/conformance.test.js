import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runConformance, loadCorpus, loadProfile, loadTargets } from "../src/lib/runner.js";
import { payloadDigest } from "../src/lib/canonical.js";

describe("raven-conformance MVP", () => {
  it("loads profile, corpus, and three targets", () => {
    const profile = loadProfile();
    const corpus = loadCorpus();
    const targets = loadTargets();
    assert.equal(profile.data.name, "raven-canonical-envelope/1");
    assert.equal(corpus.data.vectors.length, 10);
    assert.equal(corpus.digest, corpus.declaredDigest);
    assert.deepEqual(
      targets.map((t) => t.id),
      ["CONFORMANT_REFERENCE", "BROKEN_OBVIOUS", "BROKEN_SUBTLE"],
    );
  });

  it("CONFORMANT_REFERENCE passes entire corpus", async () => {
    const report = await runConformance("CONFORMANT_REFERENCE", { write: false });
    assert.equal(report.summary.overall, "CONFORMANT");
    assert.equal(report.summary.pass, 10);
    assert.equal(report.summary.divergence, 0);
    assert.ok(report.report_content_digest_sha256);
    assert.ok(report.reproduction.one_liner.includes("CONFORMANT_REFERENCE"));
  });

  it("BROKEN_OBVIOUS diverges on reject-expected vectors (negative control)", async () => {
    const report = await runConformance("BROKEN_OBVIOUS", { write: false });
    assert.equal(report.summary.overall, "DIVERGENT");
    assert.ok(report.summary.divergence >= 6, "obvious break must fail many reject vectors");
    const rejectExpected = report.results.filter((r) => r.expected.decision === "REJECT");
    const badAccepts = rejectExpected.filter((r) => r.observed.decision === "ACCEPT");
    assert.ok(badAccepts.length >= 6);
  });

  it("BROKEN_SUBTLE diverges only on unexpected-field probes (subtle negative control)", async () => {
    const report = await runConformance("BROKEN_SUBTLE", { write: false });
    assert.equal(report.summary.overall, "DIVERGENT");
    const unexpected = report.results.filter((r) =>
      r.vector_id.includes("unexpected"),
    );
    assert.ok(unexpected.length >= 2);
    for (const r of unexpected) {
      assert.equal(r.status, "DIVERGENCE");
      assert.equal(r.expected.decision, "REJECT");
      assert.equal(r.observed.decision, "ACCEPT");
    }
    // Still correctly rejects digest mismatch (not vacuously broken)
    const digest = report.results.find((r) => r.vector_id === "V03_digest_mismatch");
    assert.equal(digest.status, "PASS");
    assert.equal(digest.observed.decision, "REJECT");
  });

  it("canonical payload digest is deterministic", () => {
    const a = payloadDigest({ b: 1, a: 2 });
    const b = payloadDigest({ a: 2, b: 1 });
    assert.equal(a, b);
  });

  it("report marks DIVERGENCE as expectation mismatch only", async () => {
    const report = await runConformance("BROKEN_SUBTLE", { write: false });
    assert.match(report.divergence_definition, /observed decision ≠ specified corpus expectation/i);
    assert.doesNotMatch(JSON.stringify(report.summary), /security.?score/i);
  });
});
