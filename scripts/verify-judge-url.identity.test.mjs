import test from "node:test";
import assert from "node:assert/strict";
import {
  isLoopbackHost,
  classifyIdentityChecks,
} from "./lib/judge-url-identity.mjs";

test("loopback hosts", () => {
  assert.equal(isLoopbackHost("localhost"), true);
  assert.equal(isLoopbackHost("127.0.0.1"), true);
  assert.equal(isLoopbackHost("::1"), true);
  assert.equal(isLoopbackHost("example.com"), false);
  assert.equal(isLoopbackHost("localtest.me"), false);
});

test("healthy local unbound → LOCAL-UNBOUND pair", () => {
  const r = classifyIdentityChecks({
    baseUrl: "http://127.0.0.1:8791/",
    expectedCommit: "",
    identityStatus: "UNKNOWN",
    deployedCommit: null,
    shapeOk: true,
    allowlistedIdentity: false,
    commitShapeOk: false,
  });
  assert.equal(r.buildInfo.klass, "LOCAL-UNBOUND");
  assert.equal(r.buildInfo.ok, true);
  assert.equal(r.expectedCommit.klass, "LOCAL-UNBOUND");
  assert.equal(r.expectedCommit.ok, true);
});

test("null identity on loopback also unbound", () => {
  const r = classifyIdentityChecks({
    baseUrl: "http://localhost:8791/",
    expectedCommit: "",
    identityStatus: null,
    deployedCommit: null,
    shapeOk: true,
    allowlistedIdentity: false,
    commitShapeOk: false,
  });
  assert.equal(r.buildInfo.klass, "LOCAL-UNBOUND");
  assert.equal(r.expectedCommit.klass, "LOCAL-UNBOUND");
});

test("RED: corrupted identityStatus on non-loopback + unset EXPECTED_COMMIT → FAIL (exit gate)", () => {
  const r = classifyIdentityChecks({
    baseUrl: "https://raven-worldsfair-2026.vercel.app/",
    expectedCommit: "",
    identityStatus: "CORRUPTED_STATUS",
    deployedCommit: "not-a-commit",
    shapeOk: true,
    allowlistedIdentity: false,
    commitShapeOk: false,
  });
  assert.notEqual(r.buildInfo.klass, "LOCAL-UNBOUND");
  assert.equal(r.buildInfo.ok, false);
  assert.equal(r.expectedCommit.ok, false);
  assert.notEqual(r.expectedCommit.klass, "LOCAL-UNBOUND");
  // Gate would exit 1: at least one hard failure.
  assert.equal(r.buildInfo.ok && r.expectedCommit.ok, false);
});

test("remote missing EXPECTED_COMMIT always fails binding row", () => {
  const r = classifyIdentityChecks({
    baseUrl: "https://example.com/",
    expectedCommit: "",
    identityStatus: "UNVERIFIED_ASSERTION",
    deployedCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    shapeOk: true,
    allowlistedIdentity: true,
    commitShapeOk: true,
  });
  assert.equal(r.expectedCommit.ok, false);
  assert.notEqual(r.expectedCommit.klass, "LOCAL-UNBOUND");
});

test("malformed EXPECTED_COMMIT fails", () => {
  const r = classifyIdentityChecks({
    baseUrl: "https://example.com/",
    expectedCommit: "abc",
    identityStatus: "UNVERIFIED_ASSERTION",
    deployedCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    shapeOk: true,
    allowlistedIdentity: true,
    commitShapeOk: true,
  });
  assert.equal(r.expectedCommit.ok, false);
});

test("corrupt identity on loopback is not LOCAL-UNBOUND", () => {
  const r = classifyIdentityChecks({
    baseUrl: "http://127.0.0.1:8791/",
    expectedCommit: "",
    identityStatus: "CORRUPTED_STATUS",
    deployedCommit: "not-a-commit",
    shapeOk: true,
    allowlistedIdentity: false,
    commitShapeOk: false,
  });
  assert.notEqual(r.buildInfo.klass, "LOCAL-UNBOUND");
  assert.equal(r.buildInfo.ok, false);
  assert.equal(r.expectedCommit.ok, false);
});

test("real local git checkout on loopback (UNVERIFIED_ASSERTION + HEAD) is LOCAL-UNBOUND when EXPECTED_COMMIT unset (CODEX B2)", () => {
  const r = classifyIdentityChecks({
    baseUrl: "http://127.0.0.1:8791/",
    expectedCommit: "",
    identityStatus: "UNVERIFIED_ASSERTION",
    deployedCommit: "b29c1f25acff34942a90074a5e7889e05351866f",
    shapeOk: true,
    allowlistedIdentity: true,
    commitShapeOk: true,
  });
  assert.equal(r.buildInfo.klass, "LOCAL-UNBOUND");
  assert.equal(r.buildInfo.ok, true);
  assert.equal(r.expectedCommit.klass, "LOCAL-UNBOUND");
  assert.equal(r.expectedCommit.ok, true);
});

test("git checkout on loopback with pinned EXPECTED_COMMIT: match passes, mismatch fails", () => {
  const base = {
    baseUrl: "http://localhost:8791/",
    identityStatus: "UNVERIFIED_ASSERTION",
    deployedCommit: "b29c1f25acff34942a90074a5e7889e05351866f",
    shapeOk: true,
    allowlistedIdentity: true,
    commitShapeOk: true,
  };
  const ok = classifyIdentityChecks({ ...base, expectedCommit: "b29c1f25acff34942a90074a5e7889e05351866f" });
  assert.equal(ok.buildInfo.ok, true);
  assert.equal(ok.expectedCommit.ok, true);
  assert.notEqual(ok.expectedCommit.klass, "LOCAL-UNBOUND");
  const bad = classifyIdentityChecks({ ...base, expectedCommit: "0000000000000000000000000000000000000000" });
  assert.equal(bad.expectedCommit.ok, false);
});

test("CONFLICT identity on loopback is never LOCAL-UNBOUND", () => {
  const r = classifyIdentityChecks({
    baseUrl: "http://127.0.0.1:8791/",
    expectedCommit: "",
    identityStatus: "CONFLICT",
    deployedCommit: "b29c1f25acff34942a90074a5e7889e05351866f",
    shapeOk: true,
    allowlistedIdentity: false,
    commitShapeOk: true,
  });
  assert.notEqual(r.buildInfo.klass, "LOCAL-UNBOUND");
  assert.equal(r.buildInfo.ok, false);
  assert.equal(r.expectedCommit.ok, false);
});

test("UNVERIFIED_ASSERTION with malformed commit on loopback is not LOCAL-UNBOUND", () => {
  const r = classifyIdentityChecks({
    baseUrl: "http://127.0.0.1:8791/",
    expectedCommit: "",
    identityStatus: "UNVERIFIED_ASSERTION",
    deployedCommit: "not-a-commit",
    shapeOk: true,
    allowlistedIdentity: true,
    commitShapeOk: false,
  });
  assert.notEqual(r.buildInfo.klass, "LOCAL-UNBOUND");
  assert.equal(r.expectedCommit.ok, false);
});

test("remote git-checkout-shaped response with unset EXPECTED_COMMIT still fails binding (negative control)", () => {
  const r = classifyIdentityChecks({
    baseUrl: "https://raven-worldsfair-2026.vercel.app/",
    expectedCommit: "",
    identityStatus: "UNVERIFIED_ASSERTION",
    deployedCommit: "b29c1f25acff34942a90074a5e7889e05351866f",
    shapeOk: true,
    allowlistedIdentity: true,
    commitShapeOk: true,
  });
  assert.notEqual(r.expectedCommit.klass, "LOCAL-UNBOUND");
  assert.equal(r.expectedCommit.ok, false);
});

for (const [label, identityStatus, deployedCommit] of [
  ["UNKNOWN + 40-hex commit", "UNKNOWN", "b29c1f25acff34942a90074a5e7889e05351866f"],
  ["UNVERIFIED_ASSERTION + null commit", "UNVERIFIED_ASSERTION", null],
  ["null identity + 40-hex commit", null, "b29c1f25acff34942a90074a5e7889e05351866f"],
]) {
  test(`mixed tuple on loopback is not LOCAL-UNBOUND: ${label} (CODEX B2 re-review)`, () => {
    const r = classifyIdentityChecks({
      baseUrl: "http://127.0.0.1:8791/",
      expectedCommit: "",
      identityStatus,
      deployedCommit,
      shapeOk: true,
      allowlistedIdentity: identityStatus === "UNVERIFIED_ASSERTION",
      commitShapeOk: typeof deployedCommit === "string",
    });
    assert.notEqual(r.buildInfo.klass, "LOCAL-UNBOUND");
    assert.notEqual(r.expectedCommit.klass, "LOCAL-UNBOUND");
    assert.equal(r.expectedCommit.ok, false);
    assert.equal(r.buildInfo.ok && r.expectedCommit.ok, false);
  });
}
