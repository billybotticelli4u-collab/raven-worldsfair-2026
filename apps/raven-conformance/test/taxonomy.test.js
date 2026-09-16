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
    // parseError checked before crash in some paths — either INVALID_OUTPUT or TARGET_CRASH
    assert.ok(["TARGET_CRASH", "INVALID_OUTPUT"].includes(r.status));
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
