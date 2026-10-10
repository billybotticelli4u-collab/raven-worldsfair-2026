// LIVE-SOLANA tests. Every network call goes to a loopback stub; the hosted
// Raven API and Solana RPC are never contacted (network guard in helpers and
// testPreload.mjs). No real key is used: keys here are dummy test strings.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  DEFAULT_API_BASE,
  FRESHNESS_MAX_AGE_SECONDS,
  MAX_HTTP_CALLS_PER_RUN,
  PUBLISHED_SIGNER_CROSS_CHECK,
  RECEIPT_PATH,
  createCallBudget,
  evaluateLiveGates,
  fetchAndVerifyLiveReceipt,
  keyIdFor,
  pinnedSigner,
  validateSubject,
  verifyLiveReceipt,
} from "../liveSolana.js";
import {
  RAVEN_PRODUCTION_TRUST_ANCHOR,
  verifyReceiptV1,
} from "../../../../vendor/raven-receipt-verifier/packages/verify-js/src/index.ts";
import { ravenVerifyReceiptForSubject } from "../../src/lib/ravenVerify.js";
import { startStub } from "./stubServer.js";
import { makeTestOnlySignedReceipt, rehashWithoutResigning } from "./testOnlySigner.js";
import {
  APP, FIXTURE, FIXTURE_BYTES, LIVE, ROOT, TAMPERED_BYTES, TEST_API_KEY, TOKEN_2022, WSOL_MINT,
  at, isoAt, readReports, replay, reportDir, runCli, runInProcess,
} from "./helpers.js";

const SUBJECT = validateSubject({});
const json = (o) => JSON.stringify(o);
const env = (stub, dir, extra = {}) => ({
  RAVEN_API_KEY: TEST_API_KEY, RAVEN_API_BASE: stub.base, RAVEN_LIVE_REPORT_DIR: dir, ...extra,
});
const noProceed = (stdout) => assert.doesNotMatch(stdout, /-> PROCEED/);

/* ------------------------------------------------------------ pins */

test("default API base and path match the repo's published Raven endpoints (not called)", () => {
  const agents = JSON.parse(readFileSync(path.join(ROOT, "apps/raven-site/agents.json"), "utf8"));
  assert.equal(DEFAULT_API_BASE, agents.endpoints.base);
  assert.equal(RECEIPT_PATH, agents.endpoints.receipt_v1.path);
  assert.equal(DEFAULT_API_BASE, "https://raven-hosted-verifier.onrender.com");
});

test("pinned signer = repo verifier's production anchor = published cross-check", () => {
  const pin = pinnedSigner();
  assert.deepEqual({ ...pin }, { ...PUBLISHED_SIGNER_CROSS_CHECK });
  assert.equal(RAVEN_PRODUCTION_TRUST_ANCHOR.length, 1);
  assert.equal(RAVEN_PRODUCTION_TRUST_ANCHOR[0].publicKeyBase64, pin.publicKeyBase64);
  assert.equal(keyIdFor(pin.publicKeyBase64), "rvk_c2997e90215279c2");
  assert.equal(FIXTURE.signerPublicKey, pin.publicKeyBase64, "fixture is signed by the pinned key");
});

test("product code: no signer, no test imports, env read only at the entrypoint", () => {
  for (const f of readdirSync(LIVE).filter((n) => /\.(m?js)$/.test(n))) {
    const src = readFileSync(path.join(LIVE, f), "utf8");
    assert.doesNotMatch(src, /generateKeyPair|createPrivateKey|\bsign\(/, `${f} must not sign`);
    assert.doesNotMatch(src, /from\s+["'][^"']*\/test\//, `${f} must not import test code`);
    assert.doesNotMatch(src, /RAVEN_TEST_FIXED_NOW/, `${f} has no test clock`);
    if (f !== "demo-live-solana.mjs") assert.doesNotMatch(src, /process\.env/, `${f} must not read env`);
  }
  const lib = readFileSync(path.join(LIVE, "liveSolana.js"), "utf8");
  assert.equal((lib.match(/doFetch\(/g) ?? []).length, 1, "exactly one fetch site");
  assert.match(lib, /const url = apiBase \+ RECEIPT_PATH;/);
});

test("report folder is gitignored", () => {
  assert.match(readFileSync(path.join(LIVE, ".gitignore"), "utf8"), /^runs\/$/m);
});

/* --------------------------------------------- refuse before any call */

test("key unset -> refuse before any call (real entrypoint)", async (t) => {
  const stub = await startStub(t, replay(FIXTURE_BYTES));
  const dir = reportDir(t);
  for (const key of [undefined, "", "   "]) {
    const e = { RAVEN_API_BASE: stub.base, RAVEN_LIVE_REPORT_DIR: dir };
    if (key !== undefined) e.RAVEN_API_KEY = key;
    const r = await runCli(t, { env: e });
    assert.equal(r.code, 2);
    assert.equal(r.stdout, "");
    assert.match(r.stderr, /REFUSED before any network call: RAVEN_API_KEY is not set/);
  }
  assert.equal(stub.requests.length, 0);
  assert.equal(readReports(dir).length, 0);
});

test("malformed key / base / mint / program / flags -> exit 2, no call", async (t) => {
  const stub = await startStub(t, replay(FIXTURE_BYTES));
  const dir = reportDir(t);
  const cases = [
    [{ RAVEN_API_KEY: "short" }, [], /malformed/],
    [{ RAVEN_API_KEY: "has space inside key" }, [], /malformed/],
    [{ RAVEN_API_BASE: "http://example.com" }, [], /must be https/],
    [{ RAVEN_API_BASE: "https://user:pw@example.com" }, [], /bare origin/],
    [{ RAVEN_API_BASE: "https://example.com/receipt/v1" }, [], /bare origin/],
    [{ RAVEN_API_BASE: "not a url" }, [], /not a valid URL/],
    [{}, ["--mint", "not-base58-0OIl"], /--mint/],
    [{}, ["--token-program", WSOL_MINT], /--token-program/],
    [{}, ["--timeout-ms", "5"], /--timeout-ms/],
    [{}, ["--api-key=whatever"], /Unrecognised arguments/],
    [{}, ["positional"], /Unrecognised arguments/],
  ];
  let fetches = 0;
  for (const [extra, argv, re] of cases) {
    const r = await runInProcess({
      env: env(stub, dir, extra), argv, clock: at(5), fetchImpl: () => { fetches += 1; throw new Error("no"); },
    });
    assert.equal(r.code, 2, `${json(extra)} ${argv}`);
    assert.match(r.stderr, re);
    noProceed(r.stdout);
  }
  assert.equal(fetches, 0);
  assert.equal(stub.requests.length, 0);
});

/* ---------------------------------------------------------- outcomes */

test("valid genuine receipt -> VERIFIED -> PROCEED; tamper -> REFUSE; report written", async (t) => {
  const stub = await startStub(t, replay(FIXTURE_BYTES));
  const dir = reportDir(t);
  const r = await runInProcess({ env: env(stub, dir), clock: at(5) });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /LOCAL STUB - not the hosted Raven API/);
  assert.match(r.stdout, /^Receipt from LOCAL STUB: VERIFIED -> PROCEED$/m);
  assert.match(r.stdout, /^Same receipt, one field changed \(slot 430410160 -> 430410161\): REFUSE {2}\(reason: integrity_or_malformed\)$/m);
  assert.match(r.stdout, /HTTP calls used: 1 of 20/);
  assert.equal(r.stderr, "");

  assert.equal(stub.requests.length, 1);
  const req = stub.requests[0];
  assert.equal(req.method, "POST");
  assert.equal(req.url, "/receipt/v1");
  assert.equal(req.apiKeyHeader, TEST_API_KEY);
  assert.equal(req.contentType, "application/json");
  assert.deepEqual(JSON.parse(req.body), {
    mintAddress: FIXTURE.mintAddress, tokenProgramAddress: FIXTURE.tokenProgramAddress,
  });

  const [rep] = readReports(dir);
  assert.ok(rep, "report written");
  assert.equal(statSync(rep.file).mode & 0o777, 0o600);
  const report = JSON.parse(rep.text);
  assert.equal(report.unsigned, true);
  assert.equal(report.decision, "PROCEED");
  assert.equal(report.verification.result, "VERIFIED");
  assert.equal(report.receipt.receiptId, FIXTURE.receiptId);
  assert.equal(report.receipt.payloadHash, FIXTURE.payloadHash);
  assert.equal(report.receipt.signerKeyId, "rvk_c2997e90215279c2");
  assert.equal(report.request.mintAddress, FIXTURE.mintAddress);
  assert.equal(report.tamperControl.decision, "REFUSE");
  assert.equal(report.http.calls, 1);
  assert.equal(report.http.cap, 20);
  assert.equal(report.api.loopbackStub, true);
  assert.ok(report.startedAt && report.finishedAt);
  assert.ok(!rep.text.includes(TEST_API_KEY));
  assert.doesNotMatch(rep.text, /x-api-key|headers/i);
});

test("video line: against the default hosted base the label is 'Live receipt from Raven API' (fake fetch, no network)", async (t) => {
  const dir = reportDir(t);
  const seen = [];
  const fakeFetch = async (url, init) => {
    seen.push({ url, init });
    return new Response(FIXTURE_BYTES, { status: 200 });
  };
  const r = await runInProcess({
    env: { RAVEN_API_KEY: TEST_API_KEY, RAVEN_LIVE_REPORT_DIR: dir }, clock: at(5), fetchImpl: fakeFetch,
  });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^Live receipt from Raven API: VERIFIED -> PROCEED$/m);
  assert.match(r.stdout, /^Same receipt, one field changed .*: REFUSE/m);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, "https://raven-hosted-verifier.onrender.com/receipt/v1");
  assert.equal(seen[0].init.redirect, "manual");
});

test("real entrypoint end-to-end: genuine receipt at a fixed test clock -> PROCEED, exit 0", async (t) => {
  const stub = await startStub(t, replay(FIXTURE_BYTES));
  const dir = reportDir(t);
  const r = await runCli(t, { env: env(stub, dir), fixedNow: isoAt(5) });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /VERIFIED -> PROCEED/);
  assert.match(r.stdout, /one field changed .*: REFUSE/);
  assert.equal(readReports(dir).length, 1);
});

test("tampered receipt (offline fixture bytes) -> REFUSE, exit 3", async (t) => {
  const stub = await startStub(t, replay(TAMPERED_BYTES));
  const r = await runInProcess({ env: env(stub, reportDir(t)), clock: at(5) });
  assert.equal(r.code, 3);
  assert.match(r.stdout, /VERIFICATION_FAILED -> REFUSE {2}\(reason: integrity_or_malformed\)/);
  noProceed(r.stdout);
});

test("re-hashed but not re-signed receipt -> REFUSE (only the signature check catches it)", async (t) => {
  const forged = rehashWithoutResigning(FIXTURE, { slot: FIXTURE.slot + 7 });
  const stub = await startStub(t, replay(json(forged)));
  const r = await runInProcess({ env: env(stub, reportDir(t)), clock: at(5) });
  assert.equal(r.code, 3);
  noProceed(r.stdout);
  // Layer 1: the repo's pinned verifier alone.
  const v = await ravenVerifyReceiptForSubject({ receipt: forged, expectedSubject: SUBJECT, now: isoAt(5) });
  assert.equal(v.verified, false);
  assert.equal(v.axes.valid, false);
  assert.deepEqual(v.axes.reasons, ["signature_invalid"]);
  // Layer 2: live gates alone.
  const g = evaluateLiveGates({ receipt: forged, subject: SUBJECT, now: at(5)() });
  assert.equal(g.checks.payloadHash, true);
  assert.equal(g.checks.receiptIdentity, true);
  assert.equal(g.checks.signatureByPinnedKey, false);
  assert.deepEqual(g.failed, ["live_signature_invalid_for_pinned_key"]);
});

test("wrong signer key (TEST-ONLY key, fresh) -> REFUSE on the product path, exit 3", async (t) => {
  const { receipt, testOnlyPublicKeyBase64 } = makeTestOnlySignedReceipt(FIXTURE, {
    timestamp: new Date().toISOString(),
  });
  const stub = await startStub(t, replay(json(receipt)));
  const r = await runCli(t, { env: env(stub, reportDir(t)) }); // real clock, real entrypoint
  assert.equal(r.code, 3, r.stderr);
  assert.match(r.stdout, /REFUSE {2}\(reason: untrusted_key\)/);
  noProceed(r.stdout);
  // Layer 1: verifier says self-consistent signature, untrusted key.
  const v = await ravenVerifyReceiptForSubject({ receipt, expectedSubject: SUBJECT, now: new Date() });
  assert.equal(v.axes.valid, true);
  assert.equal(v.axes.keyTrusted, false);
  // Layer 2: live gates alone.
  const g = evaluateLiveGates({ receipt, subject: SUBJECT, now: new Date() });
  assert.equal(g.checks.pinnedSigner, false);
  assert.equal(g.checks.signatureByPinnedKey, false);
  // Positive control: the same gates PASS if (and only if) the test key were pinned.
  const gTest = evaluateLiveGates({ receipt, subject: SUBJECT, now: new Date(), pinnedPublicKeyBase64: testOnlyPublicKeyBase64 });
  assert.equal(gTest.ok, true, json(gTest.failed));
  // The product API offers no way to pin the test key.
  const direct = await fetchAndVerifyLiveReceipt({
    apiKey: TEST_API_KEY, apiBase: stub.base, pinnedPublicKeyBase64: testOnlyPublicKeyBase64,
    trustedKeys: [testOnlyPublicKeyBase64], fetchImpl: fetch,
  });
  assert.equal(direct.decision, "REFUSE");
});

test("mint mismatch (asked wSOL, got BONK receipt) -> REFUSE", async (t) => {
  const stub = await startStub(t, replay(FIXTURE_BYTES));
  const r = await runInProcess({ env: env(stub, reportDir(t)), argv: ["--mint", WSOL_MINT], clock: at(5) });
  assert.equal(r.code, 3);
  assert.match(r.stdout, /reason: subject_mismatch/);
  assert.equal(JSON.parse(stub.requests[0].body).mintAddress, WSOL_MINT);
  const wsol = validateSubject({ mint: WSOL_MINT });
  const v = await verifyLiveReceipt({ receipt: FIXTURE, subject: wsol, now: at(5)() });
  assert.equal(v.agentA.axes.subjectMatches, false);
  const g = evaluateLiveGates({ receipt: FIXTURE, subject: wsol, now: at(5)() });
  assert.deepEqual(g.failed, ["live_mint_mismatch"]);
});

test("token program mismatch (asked Token-2022) -> REFUSE", async (t) => {
  const stub = await startStub(t, replay(FIXTURE_BYTES));
  const r = await runInProcess({ env: env(stub, reportDir(t)), argv: ["--token-program", TOKEN_2022], clock: at(5) });
  assert.equal(r.code, 3);
  noProceed(r.stdout);
  const g = evaluateLiveGates({ receipt: FIXTURE, subject: validateSubject({ tokenProgram: TOKEN_2022 }), now: at(5)() });
  assert.deepEqual(g.failed, ["live_token_program_mismatch"]);
});

test("stale receipt (age 301s > 300s) -> REFUSE; age 299s -> PROCEED", async (t) => {
  const stub = await startStub(t, replay(FIXTURE_BYTES));
  const stale = await runInProcess({ env: env(stub, reportDir(t)), clock: at(301) });
  assert.equal(stale.code, 3);
  assert.match(stale.stdout, /reason: stale/);
  const v = await ravenVerifyReceiptForSubject({ receipt: FIXTURE, expectedSubject: SUBJECT, now: isoAt(301) });
  assert.equal(v.axes.stale, true);
  const g = evaluateLiveGates({ receipt: FIXTURE, subject: SUBJECT, now: at(301)() });
  assert.deepEqual(g.failed, ["live_receipt_stale"]);
  const fresh = await runInProcess({ env: env(stub, reportDir(t)), clock: at(299) });
  assert.equal(fresh.code, 0, fresh.stdout);
});

test("future-dated receipt (issued 120s after 'now') -> REFUSE (live gate; the vendor verifier alone accepts it)", async (t) => {
  const stub = await startStub(t, replay(FIXTURE_BYTES));
  const r = await runInProcess({ env: env(stub, reportDir(t)), clock: at(-120) });
  assert.equal(r.code, 3);
  assert.match(r.stdout, /reason: live_timestamp_in_future/);
  const v = await ravenVerifyReceiptForSubject({ receipt: FIXTURE, expectedSubject: SUBJECT, now: isoAt(-120) });
  assert.equal(v.verified, true, "documented gap: verifier has no future bound");
  const g = evaluateLiveGates({ receipt: FIXTURE, subject: SUBJECT, now: at(-120)() });
  assert.deepEqual(g.failed, ["live_timestamp_in_future"]);
  const ok = evaluateLiveGates({ receipt: FIXTURE, subject: SUBJECT, now: at(-59)() });
  assert.equal(ok.ok, true, "within 60s skew is accepted");
});

test("freshness bound is min(300s, receipt.maxAgeSeconds) even when the receipt allows more", () => {
  const now = new Date();
  const { receipt, testOnlyPublicKeyBase64: pin } = makeTestOnlySignedReceipt(FIXTURE, {
    maxAgeSeconds: 3600, timestamp: new Date(now.getTime() - 400_000).toISOString(),
  });
  const vendor = verifyReceiptV1(receipt, { trustedKeys: [pin], now });
  assert.equal(vendor.stale, false, "receipt's own 3600s window says fresh");
  const g = evaluateLiveGates({ receipt, subject: SUBJECT, now, pinnedPublicKeyBase64: pin });
  assert.equal(g.freshness.boundSeconds, FRESHNESS_MAX_AGE_SECONDS);
  assert.deepEqual(g.failed, ["live_receipt_stale"]);
});

test("unsupported rules version -> live gate refuses", () => {
  const now = new Date();
  const { receipt, testOnlyPublicKeyBase64: pin } = makeTestOnlySignedReceipt(FIXTURE, {
    rulesVersion: "raven-rules@9.9.9", timestamp: now.toISOString(),
  });
  const g = evaluateLiveGates({ receipt, subject: SUBJECT, now, pinnedPublicKeyBase64: pin });
  assert.deepEqual(g.failed, ["live_rules_not_supported_valid"]);
});

test("live gates layer: each defect is flagged by its own check", () => {
  const now = at(5)();
  const cases = [
    ["receiptId changed", { ...FIXTURE, receiptId: "raven-receipt-v1:sha256:" + "0".repeat(64) }, "live_receipt_identity_mismatch"],
    ["payload field changed", { ...FIXTURE, slot: FIXTURE.slot + 1 }, "live_payload_hash_mismatch"],
    ["signature swapped", { ...FIXTURE, signature: Buffer.alloc(64, 1).toString("base64") }, "live_signature_invalid_for_pinned_key"],
    ["signer key swapped", { ...FIXTURE, signerPublicKey: "MCowBQYDK2VwAyEA" + Buffer.alloc(32, 7).toString("base64") }, "live_signer_not_pinned"],
    ["chain changed", { ...FIXTURE, chain: "solana-devnet" }, "live_chain_mismatch"],
  ];
  for (const [name, receipt, reason] of cases) {
    const g = evaluateLiveGates({ receipt, subject: SUBJECT, now });
    assert.ok(g.failed.includes(reason), `${name}: ${json(g.failed)}`);
  }
  assert.equal(evaluateLiveGates({ receipt: FIXTURE, subject: SUBJECT, now }).ok, true);
});

test("extra unsigned field -> vendor shape check REFUSES even though live gates pass", async (t) => {
  const odd = { ...FIXTURE, injected: "not part of receipt-v1" };
  const g = evaluateLiveGates({ receipt: odd, subject: SUBJECT, now: at(5)() });
  assert.equal(g.ok, true, "live gates only look at signed fields");
  const v = await verifyLiveReceipt({ receipt: odd, subject: SUBJECT, now: at(5)() });
  assert.equal(v.decision, "REFUSE");
  assert.equal(v.reason, "integrity_or_malformed");
  const { liveVerifyEvidence } = await import("../agentHooks.js");
  const { createClaimMessage, createEvidenceResponse } = await import("../../src/lib/protocol.js");
  const { createEvidenceRequest } = await import("../../src/lib/agentA.js");
  const claim = createClaimMessage({ claimId: "x", ...SUBJECT, property: "p", summary: "s" });
  const evidenceRequest = createEvidenceRequest(claim);
  const verification = await liveVerifyEvidence({
    evidenceRequest, evidenceResponse: createEvidenceResponse(evidenceRequest, odd), now: at(5)(),
  });
  assert.equal(verification.result.verified, false);
  const stub = await startStub(t, replay(json(odd)));
  const r = await runInProcess({ env: env(stub, reportDir(t)), clock: at(5) });
  assert.equal(r.code, 3);
});

/* ------------------------------------------------------ HTTP failures */

for (const [status, calls] of [[401, 1], [403, 1], [404, 1], [422, 1], [429, 1], [500, 2], [503, 2]]) {
  test(`HTTP ${status} -> clear failure, exit 4, no PROCEED, ${calls} call(s)`, async (t) => {
    const stub = await startStub(t, () => ({ status, body: json({ error: "nope" }) }));
    const dir = reportDir(t);
    const r = await runCli(t, { env: env(stub, dir) });
    assert.equal(r.code, 4);
    assert.match(r.stderr, new RegExp(`FAILED: .*HTTP ${status}`));
    assert.match(r.stdout, /NOT OBTAINED -> no PROCEED/);
    noProceed(r.stdout);
    assert.equal(stub.requests.length, calls);
    const [rep] = readReports(dir);
    const report = JSON.parse(rep.text);
    assert.equal(report.decision, "REFUSE");
    assert.equal(report.error.code, `http_${status}`);
    assert.equal(report.http.calls, calls);
  });
}

test("timeout -> one retry, then clear failure, exit 4", async (t) => {
  const stub = await startStub(t, () => ({ hang: true }));
  const r = await runCli(t, { env: env(stub, reportDir(t)), argv: ["--timeout-ms", "300"] });
  assert.equal(r.code, 4);
  assert.match(r.stderr, /did not answer within 300 ms \(attempt 2 of 2\)/);
  noProceed(r.stdout);
  assert.equal(stub.requests.length, 2);
});

test("500 then 200 -> the single retry succeeds -> PROCEED (2 calls)", async (t) => {
  const stub = await startStub(t, (i) => (i === 0 ? { status: 500, body: "{}" } : { body: FIXTURE_BYTES }));
  const r = await runInProcess({ env: env(stub, reportDir(t)), clock: at(5) });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /HTTP calls used: 2 of 20/);
  assert.equal(stub.requests.length, 2);
});

test("connection refused -> network error after one retry, exit 4", async (t) => {
  const stub = await startStub(t, replay(FIXTURE_BYTES));
  const base = stub.base;
  await stub.close();
  const r = await runCli(t, { env: { RAVEN_API_KEY: TEST_API_KEY, RAVEN_API_BASE: base, RAVEN_LIVE_REPORT_DIR: reportDir(t) } });
  assert.equal(r.code, 4);
  assert.match(r.stderr, /Could not reach the Raven API \(attempt 2 of 2\)/);
});

test("redirect is not followed (key cannot be forwarded), exit 4", async (t) => {
  const other = await startStub(t, replay(FIXTURE_BYTES));
  const stub = await startStub(t, () => ({ status: 307, headers: { location: `${other.base}/receipt/v1` } }));
  const r = await runInProcess({ env: env(stub, reportDir(t)), clock: at(5) });
  assert.equal(r.code, 4);
  assert.match(r.stderr, /redirect/);
  assert.equal(stub.requests.length, 1);
  assert.equal(other.requests.length, 0);
});

test("non-JSON, non-object and oversized 200 bodies -> exit 4", async (t) => {
  for (const body of ["<html>", "[1,2]", "null", "x".repeat(300 * 1024)]) {
    const stub = await startStub(t, () => ({ body }));
    const r = await runInProcess({ env: env(stub, reportDir(t)), clock: at(5) });
    assert.equal(r.code, 4, body.slice(0, 10));
    noProceed(r.stdout);
    assert.equal(stub.requests.length, 1, "no retry on a bad 200");
  }
});

test("malformed receipt object -> REFUSE, exit 3", async (t) => {
  const stub = await startStub(t, () => ({ body: json({ hello: "world" }) }));
  const r = await runInProcess({ env: env(stub, reportDir(t)), clock: at(5) });
  assert.equal(r.code, 3);
  noProceed(r.stdout);
});

/* ----------------------------------------------------------- call cap */

test("call cap: 20 per run, cannot be raised, enforced before the call", async (t) => {
  assert.equal(MAX_HTTP_CALLS_PER_RUN, 20);
  const b = createCallBudget();
  for (let i = 1; i <= 20; i += 1) assert.equal(b.take(), i);
  assert.throws(() => b.take(), { code: "call_cap_exceeded" });
  assert.equal(b.used, 20);
  assert.equal(createCallBudget(1000).max, 20);
  assert.equal(createCallBudget(-1).max, 20);
  assert.equal(createCallBudget(Number.NaN).max, 20);
  assert.equal(createCallBudget(2).max, 2);

  const stub = await startStub(t, () => ({ status: 500, body: "{}" }));
  const exhausted = await fetchAndVerifyLiveReceipt({ apiKey: TEST_API_KEY, apiBase: stub.base, budget: b, fetchImpl: fetch });
  assert.equal(exhausted.decision, "REFUSE");
  assert.equal(exhausted.reason, "call_cap_exceeded");
  assert.equal(stub.requests.length, 0, "no call once the cap is reached");

  const oneLeft = createCallBudget(20);
  for (let i = 0; i < 19; i += 1) oneLeft.take();
  const blockedRetry = await fetchAndVerifyLiveReceipt({ apiKey: TEST_API_KEY, apiBase: stub.base, budget: oneLeft, fetchImpl: fetch });
  assert.equal(blockedRetry.reason, "call_cap_exceeded");
  assert.equal(stub.requests.length, 1, "the retry was blocked by the cap");
});

/* ------------------------------------------------------- key secrecy */

test("sentinel key never appears in stdout, stderr or report, in any mode", async (t) => {
  const SENTINEL = "SENTINEL-" + randomBytes(12).toString("hex");
  const { receipt: testKeyReceipt } = makeTestOnlySignedReceipt(FIXTURE, { timestamp: new Date().toISOString() });
  const reflected = { ...FIXTURE, receiptId: SENTINEL };
  const modes = {
    valid: [() => ({ body: FIXTURE_BYTES }), { fixedNow: isoAt(5) }],
    stale: [() => ({ body: FIXTURE_BYTES }), {}],
    http401Echo: [() => ({ status: 401, body: json({ error: `bad key ${SENTINEL}` }) }), {}],
    http500Echo: [() => ({ status: 500, body: SENTINEL }), {}],
    timeout: [() => ({ hang: true }), { argv: ["--timeout-ms", "200"] }],
    testKey: [() => ({ body: json(testKeyReceipt) }), {}],
    reflectedInReceipt: [() => ({ body: json(reflected) }), { fixedNow: isoAt(5) }],
    redirectEcho: [() => ({ status: 302, headers: { location: `http://127.0.0.1:9/${SENTINEL}` } }), {}],
    notJsonEcho: [() => ({ body: `oops ${SENTINEL}` }), {}],
  };
  for (const [name, [respond, opts]] of Object.entries(modes)) {
    const stub = await startStub(t, respond);
    const dir = reportDir(t);
    const r = await runCli(t, {
      env: { RAVEN_API_KEY: SENTINEL, RAVEN_API_BASE: stub.base, RAVEN_LIVE_REPORT_DIR: dir },
      argv: opts.argv ?? [], fixedNow: opts.fixedNow,
    });
    assert.ok(stub.requests.length >= 1, name);
    assert.ok(stub.requests.every((q) => q.apiKeyHeader === SENTINEL), `${name}: key sent as x-api-key`);
    assert.ok(!r.stdout.includes(SENTINEL), `${name}: stdout`);
    assert.ok(!r.stderr.includes(SENTINEL), `${name}: stderr`);
    const reports = readReports(dir);
    assert.ok(reports.length >= 1, `${name}: report written`);
    for (const rep of reports) assert.ok(!rep.text.includes(SENTINEL), `${name}: report`);
    if (name === "reflectedInReceipt") assert.match(r.stdout, /\[REDACTED\]/);
  }
  // A key pasted as an argument is not echoed either.
  const r = await runCli(t, { env: {}, argv: [`--key=${SENTINEL}`] });
  assert.equal(r.code, 2);
  assert.ok(!r.stdout.includes(SENTINEL) && !r.stderr.includes(SENTINEL));
});

test("no stray report files outside the chosen folder", () => {
  const runs = path.join(LIVE, "runs");
  let files = [];
  try { files = readdirSync(runs); } catch { /* absent is fine */ }
  assert.deepEqual(files, [], "tests never write into live/runs/");
  assert.ok(APP);
});
