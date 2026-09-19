import assert from "node:assert/strict";
import test from "node:test";
import {
  readBuildInfo,
  PREEXISTING_FOUNDATION,
  FAIR_WORK_IN_THIS_APP,
  OFFICIAL_CONTEST_START,
} from "../src/lib/buildInfo.js";

test("build info shows Fair commit", () => {
  const info = readBuildInfo();
  assert.ok(info.fairBuildCommit, "fairBuildCommit must be present");
  assert.match(info.fairBuildCommit, /^[0-9a-f]{40}$/);
  assert.equal(info.officialContestStart.zone, "America/Los_Angeles");
  assert.equal(info.officialContestStart.instant, OFFICIAL_CONTEST_START.instant);
});

test("does not falsely label pre-existing foundation as Fair-created", () => {
  const info = readBuildInfo();
  assert.equal(info.labels.foundation, "PRE-EXISTING (not Fair-created)");
  assert.equal(info.labels.fairApp, "FAIR WORK (World's Fair 2026 Days 1-2)");
  assert.ok(PREEXISTING_FOUNDATION.length >= 1);
  assert.ok(FAIR_WORK_IN_THIS_APP.length >= 1);
  // Honesty: foundation list must mention verify-js / verifier, not claim Fair invented it
  assert.ok(
    PREEXISTING_FOUNDATION.some((s) => /verify-js|verifier/i.test(s)),
    "foundation must acknowledge pre-existing verifier",
  );
  assert.ok(
    !FAIR_WORK_IN_THIS_APP.some((s) => /invented the verifier|created raven-receipt-verifier/i.test(s)),
    "Fair work must not claim creating the verifier",
  );
});

test("operator injection is disclosed without overriding checkout identity", () => {
  const prev = process.env.WORLDSFAIR_BUILD_COMMIT;
  process.env.WORLDSFAIR_BUILD_COMMIT = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  try {
    const info = readBuildInfo();
    assert.notEqual(info.fairBuildCommit, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    assert.equal(info.identityStatus, "CONFLICT");
    assert.equal(info.commitSource, "git_checkout");
  } finally {
    if (prev === undefined) delete process.env.WORLDSFAIR_BUILD_COMMIT;
    else process.env.WORLDSFAIR_BUILD_COMMIT = prev;
  }
});
