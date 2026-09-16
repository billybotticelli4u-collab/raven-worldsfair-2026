import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyResult, adaptReport, firstMeaningfulIssue, relatedRequirement } from "../src/lib/displayAdapter.js";
import { loadProfile } from "../src/lib/runner.js";

describe("displayAdapter", () => {
  it("PASS stays PASS", () => {
    assert.equal(classifyResult({ status: "PASS", expected: { decision: "ACCEPT" }, observed: { decision: "ACCEPT" } }).kind, "PASS");
  });
  it("TIMEOUT separate", () => {
    assert.equal(classifyResult({ status: "TIMEOUT", expected: { decision: "ACCEPT" }, observed: { timedOut: true }, evidence: { timedOut: true } }).kind, "TIMEOUT");
  });
  it("INVALID_OUTPUT separate", () => {
    assert.equal(classifyResult({ status: "INVALID_OUTPUT", observed: { parseError: "unparseable_stdout" } }).kind, "INVALID_OUTPUT");
  });
  it("BEHAVIORAL_DIVERGENCE for mismatch", () => {
    assert.equal(classifyResult({ status: "BEHAVIORAL_DIVERGENCE", expected: { decision: "REJECT" }, observed: { decision: "ACCEPT" } }).kind, "BEHAVIORAL_DIVERGENCE");
  });
  it("adaptReport preserves engine overall", () => {
    const report = {
      schema: "raven-conformance-report/1",
      summary: { test_count: 2, pass: 1, divergence: 1, overall: "DIVERGENT", counts: { PASS: 1, BEHAVIORAL_DIVERGENCE: 1 } },
      results: [
        { vector_id: "A", status: "PASS", expected: { decision: "ACCEPT" }, observed: { decision: "ACCEPT" } },
        { vector_id: "B", status: "BEHAVIORAL_DIVERGENCE", description: "Unexpected top-level field must REJECT", expected: { decision: "REJECT" }, observed: { decision: "ACCEPT" } },
      ],
    };
    const adapted = adaptReport(report, loadProfile().data);
    assert.equal(adapted.ok, true);
    assert.equal(adapted.engine.summary.overall, "DIVERGENT");
    assert.equal(adapted.display.counts.behavioral_divergence, 1);
    const issue = firstMeaningfulIssue(adapted.display.results);
    assert.equal(issue.vector_id, "B");
    assert.match(relatedRequirement(loadProfile().data, issue), /unexpected|top-level|field|Reject/i);
  });
});
