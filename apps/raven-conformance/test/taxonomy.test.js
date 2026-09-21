import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyResult } from "../src/lib/runner.js";

describe("result taxonomy", () => {
  it("PASS only on matching decision", () => {
    const r = classifyResult(
      { observed: { decision: "ACCEPT" }, exitCode: 0, timedOut: false, flooded: false },
      "ACCEPT",
    );
    assert.equal(r.status, "PASS");
  });

  it("BEHAVIORAL_DIVERGENCE on mismatch", () => {
    const r = classifyResult(
      { observed: { decision: "ACCEPT" }, exitCode: 0, timedOut: false, flooded: false },
      "REJECT",
    );
    assert.equal(r.status, "BEHAVIORAL_DIVERGENCE");
  });

  it("compares version when the profile expectation includes it", () => {
    const pass = classifyResult(
      { observed: { decision: "ACCEPT", version: 1 }, exitCode: 0, timedOut: false, flooded: false },
      { decision: "ACCEPT", version: 1, reason: "non-normative expectation note" },
    );
    const divergence = classifyResult(
      { observed: { decision: "ACCEPT", version: 0 }, exitCode: 0, timedOut: false, flooded: false },
      { decision: "ACCEPT", version: 1 },
    );

    assert.equal(pass.status, "PASS");
    assert.equal(divergence.status, "BEHAVIORAL_DIVERGENCE");
  });

  it("refuses a missing version instead of normalizing it to null", () => {
    assert.deepEqual(
      classifyResult(
        { observed: { decision: "REJECT" }, exitCode: 0, timedOut: false, flooded: false },
        { decision: "REJECT", version: null },
      ),
      { status: "INVALID_OUTPUT", evidence_note: "missing_version" },
    );
    assert.deepEqual(
      classifyResult(
        { observed: { decision: "REJECT", version: null }, exitCode: 0, timedOut: false, flooded: false },
        { decision: "REJECT", version: null },
      ),
      { status: "PASS", evidence_note: null },
    );
  });

  it("TIMEOUT never PASS", () => {
    const r = classifyResult(
      { observed: null, exitCode: null, timedOut: true, flooded: false, parseError: "timeout" },
      "ACCEPT",
    );
    assert.equal(r.status, "TIMEOUT");
  });

  it("OUTPUT_FLOOD never PASS", () => {
    const r = classifyResult(
      { observed: null, exitCode: null, timedOut: false, flooded: true, parseError: "output_flood" },
      "ACCEPT",
    );
    assert.equal(r.status, "OUTPUT_FLOOD");
  });

  it("INVALID_OUTPUT never PASS", () => {
    const r = classifyResult(
      {
        observed: null,
        exitCode: 0,
        timedOut: false,
        flooded: false,
        parseError: "unparseable_stdout",
      },
      "ACCEPT",
    );
    assert.equal(r.status, "INVALID_OUTPUT");
  });

  it("TARGET_CRASH never PASS", () => {
    const r = classifyResult(
      {
        observed: null,
        exitCode: 1,
        timedOut: false,
        flooded: false,
        parseError: "unparseable_stdout",
        signal: null,
      },
      "ACCEPT",
    );
    // A nonzero exit takes priority over malformed output.
    assert.equal(r.status, "TARGET_CRASH");
    assert.notEqual(r.status, "PASS");
  });

  it("non-zero without parse still TARGET_CRASH when no observed", () => {
    const r = classifyResult(
      {
        observed: null,
        exitCode: 1,
        timedOut: false,
        flooded: false,
        parseError: null,
        signal: null,
      },
      "ACCEPT",
    );
    assert.equal(r.status, "TARGET_CRASH");
  });
});
