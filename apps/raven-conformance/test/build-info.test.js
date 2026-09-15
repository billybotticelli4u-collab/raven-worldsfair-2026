import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readBuildInfo, FAIR_BUILT, PREEXISTING } from "../src/lib/buildInfo.js";

describe("build info disclosure", () => {
  it("separates PRE-EXISTING vs FAIR-built", () => {
    const info = readBuildInfo();
    assert.ok(info.fairBuilt.length >= 5);
    assert.ok(info.preexisting.length >= 2);
    assert.equal(info.labels.fairBuilt.includes("CRYPTO WORLD"), true);
    assert.match(info.buildStageNote, /Build Stage/);
    assert.match(info.buildStageNote, /Does not claim Day-3 Evidence Contract Handshake/);
    assert.ok(FAIR_BUILT.some((x) => /Conformance product loop/i.test(x)));
    assert.ok(PREEXISTING.some((x) => /NOT copied/i.test(x)));
  });
});
