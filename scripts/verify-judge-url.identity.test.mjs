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
