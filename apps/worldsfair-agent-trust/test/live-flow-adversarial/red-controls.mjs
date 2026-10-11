/**
 * Red controls for the adversarial live-flow pack.
 *
 * For every adversarial case, this runner:
 *   1. copies apps/worldsfair-agent-trust + vendor/raven-receipt-verifier into
 *      a disposable throwaway directory (the real tree is never touched);
 *   2. applies ONE precise mutation that removes the check under test;
 *   3. runs the case's test against the mutated copy and requires the measured
 *      MUTATED OBSERVABLE for that control (see the expect field of each spec):
 *      an unexpected PROCEED, a specific alternate refusal reason or status,
 *      an expected throw, or RC9a's outer timeout. Anything else — including
 *      import/setup errors, which a bare "nonzero exit" rule would mislabel as
 *      RED — makes the runner FAIL, never silently pass.
 *
 * A control whose mutation "only" reroutes the refusal to a different reason
 * (RC1, RC2, RC4, RC11) is still RED: the check under test no longer fires,
 * so the case test fails on its exact expected observable. RED here means
 * "the measured observable changed as specified", not "the adversary reached
 * PROCEED".
 *
 * Usage (from the package root, with the pinned Node):
 *   node --experimental-strip-types --disable-warning=ExperimentalWarning \
 *     --test test/live-flow-adversarial/red-controls.mjs
 * or directly:
 *   node --experimental-strip-types test/live-flow-adversarial/red-controls.mjs
 *
 * Env: RED_CONTROL_LOGDIR (keeps per-case TAP logs there). If unset, logs go to
 *      a private mkdtemp directory that is removed when the run finishes.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PKG = fileURLToPath(new URL("../..", import.meta.url));   // apps/worldsfair-agent-trust
const REPO = path.resolve(PKG, "../../");                        // repo root
const VENDOR_SRC = path.join(REPO, "vendor", "raven-receipt-verifier");
const TRANSPORT = "cases-01-02-03-09-10-transport.test.js";
const IDENTITY = "cases-04-05-06-07-08-identity.test.js";
const LIVEPATH = "cases-11-12-live-path.test.js";
const KEEP_LOGS = Boolean(process.env.RED_CONTROL_LOGDIR);
const LOGDIR = KEEP_LOGS ? process.env.RED_CONTROL_LOGDIR : mkdtempSync(path.join(tmpdir(), "red-control-logs-"));
mkdirSync(LOGDIR, { recursive: true });

// expect: the measured mutated observable the mutated run MUST produce.
//   { proceed: true }            at least one unexpected PROCEED actual
//   { actual: <string|number> }  a strictEqual diagnostic whose actual value
//                                is the named alternate reason/status
//   { matches: [<regexp>] }      every regexp must occur in the TAP log
//   { timeout: true }            the run must die by outer ETIMEDOUT (RC9a)
// Controls that do not expect PROCEED forbid it: an actual PROCEED means the
// adversary got through, which is a FAIL for that control, not its measured
// observable. Import/setup errors (module resolution, SyntaxError outside an
// expected throw, spawn failure) are always FAIL, never RED.
const SPECS = [
  { id: "RC1", cased: "1 replayed-same-challenge", file: "src/live/agentACore.js",
    anchor: '    if (consumedNonces.has(echo.nonce)) return { ok: false, reason: "nonce_replayed" };\n',
    replacement: "    // RED CONTROL: consumed-nonce check removed\n",
    testFile: TRANSPORT, pattern: "^case 1",
    expect: { actual: "nonce_mismatch_replay" },
    measured: "replay still refused, but as nonce_mismatch_replay (mismatch check), not PROCEED" },
  { id: "RC2", cased: "2 response-to-different-challenge", file: "src/live/agentACore.js",
    anchor: '    if (echo.nonce !== sent.nonce) return { ok: false, reason: "nonce_mismatch_replay" };\n',
    replacement: "    // RED CONTROL: nonce equality check removed\n",
    testFile: TRANSPORT, pattern: "^case 2",
    expect: { actual: "nonce_not_outstanding" },
    measured: "cross-challenge response refused as nonce_not_outstanding, not PROCEED" },
  { id: "RC3", cased: "3 missing/expired/future timestamp", file: "src/live/agentACore.js",
    anchor:
      "    const respondedMs = Date.parse(echo.respondedAt);\n" +
      "    const nowMs = clock().getTime();\n" +
      "    const issuedMs = Date.parse(sent.issuedAt);\n" +
      '    if (!Number.isFinite(respondedMs)) return { ok: false, reason: "responded_at_invalid" };\n' +
      "    if (respondedMs < issuedMs - CLOCK_SKEW_MS || nowMs - respondedMs > windowMs) {\n" +
      '      return { ok: false, reason: "stale_response", respondedAt: echo.respondedAt, windowMs };\n' +
      "    }\n" +
      '    if (respondedMs > nowMs + CLOCK_SKEW_MS) return { ok: false, reason: "response_from_future" };\n',
    replacement: "    const respondedMs = 0; const nowMs = 0; const issuedMs = 0; // RED CONTROL: freshness checks removed\n",
    testFile: TRANSPORT, pattern: "^case 3",
    expect: { proceed: true },
    measured: "all three freshness cases reach unexpected PROCEED" },
  { id: "RC4", cased: "4 wrong signing key", file: "vendor/raven-receipt-verifier/packages/verify-js/src/verifyReceiptV1.ts",
    anchor: '    return keyTrusted ? { keyTrusted: true } : { keyTrusted: false, reason: "key_untrusted" };\n',
    replacement: "    return { keyTrusted: true }; // RED CONTROL: key-trust refusal removed\n",
    testFile: IDENTITY, pattern: "^case 4a",
    expect: { actual: "stale" },
    measured: "wrong-key receipt refused as stale once key-trust refusal is removed, not PROCEED" },
  { id: "RC5", cased: "5 card tampered after listing", file: "src/live/agentACore.js",
    anchor:
      "    if (servedHash !== candidate.cardSha256 || wellKnown.json.agentId !== candidate.agentId) {\n" +
      '      return refuse(candidate.agentId, "card_check", "endpoint_card_mismatch", {\n' +
      "        servedAgentId: wellKnown.json.agentId ?? null,\n" +
      "      });\n" +
      "    }\n",
    replacement: "    // RED CONTROL: served-card comparison removed\n",
    testFile: IDENTITY, pattern: "^case 5",
    expect: { proceed: true },
    measured: "all three served-card mutations reach unexpected PROCEED" },
  { id: "RC6", cased: "6 duplicate agent id", file: "src/live/registryServer.js",
    anchor: '        if (entries.has(card.agentId)) return sendJson(res, 409, { error: "agent_id_taken" });\n',
    replacement: "        // RED CONTROL: duplicate-id refusal removed\n",
    testFile: IDENTITY, pattern: "^case 6b",
    expect: { actual: 201 },
    measured: "duplicate registration returns 201 rather than 409" },
  { id: "RC7", cased: "7 one-field tamper without re-signing", file: "vendor/raven-receipt-verifier/packages/verify-js/src/verifyReceiptV1.ts",
    anchor: "  const valid = reasons.length === 0;\n",
    replacement: "  const valid = true; // RED CONTROL: integrity gate removed\n",
    testFile: IDENTITY, pattern: "^case 7",
    expect: { proceed: true },
    measured: "tampered receipt reaches unexpected PROCEED" },
  { id: "RC8", cased: "8 mint mismatch", file: "vendor/raven-receipt-verifier/packages/verify-js/src/verifyReceiptV1ForSubject.ts",
    anchor: "      subjectMatches = subjectReasons.length === 0;\n",
    replacement: "      subjectMatches = true; // RED CONTROL: subject binding removed\n",
    testFile: IDENTITY, pattern: "^case 8",
    expect: { proceed: true },
    measured: "subject mismatch reaches unexpected PROCEED" },
  { id: "RC9a", cased: "9 hung agent (client timeout)", file: "src/live/http.js",
    anchor: "    signal: AbortSignal.timeout(timeoutMs),\n",
    replacement: "    // RED CONTROL: client timeout removed\n",
    testFile: TRANSPORT, pattern: "^case 9c", expectHang: true,
    expect: { timeout: true },
    measured: "test runner dies by outer timeout once the client timeout is removed" },
  { id: "RC9b", cased: "9 oversized response", file: "src/live/http.js",
    anchor: '  if (Buffer.byteLength(text) > MAX_BODY_BYTES) throw new Error("response_too_large");\n',
    replacement: "  // RED CONTROL: response size cap removed\n",
    testFile: TRANSPORT, pattern: "^case 9b",
    expect: { proceed: true },
    measured: "oversized response reaches unexpected PROCEED" },
  { id: "RC9c", cased: "9 malformed response object", file: "src/live/agentACore.js",
    anchor: '    if (!isProtocolMessage(evidenceResponse, "evidence.response")) return { ok: false, reason: "invalid_evidence_response" };\n',
    replacement: "    // RED CONTROL: response shape check removed\n",
    testFile: TRANSPORT, pattern: "^case 9a",
    expect: { matches: [/TypeError/, /challengeEcho/] },
    measured: "removed shape check yields an uncaught challengeEcho TypeError" },
  { id: "RC10", cased: "10 unreachable agent", file: "src/live/agentACore.js",
    anchor:
      "    let wellKnown;\n" +
      "    try {\n" +
      "      wellKnown = await loopbackJson(`${candidate.endpoint}/.well-known/raven-agent.json`);\n" +
      "    } catch {\n" +
      '      return refuse(candidate.agentId, "card_check", "endpoint_unreachable");\n' +
      "    }\n",
    replacement: "    const wellKnown = await loopbackJson(`${candidate.endpoint}/.well-known/raven-agent.json`); // RED CONTROL: unreachable-endpoint guard removed\n",
    testFile: TRANSPORT, pattern: "^case 10",
    expect: { matches: [/fetch failed/] },
    measured: "removed endpoint guard yields an uncaught fetch-failed error" },
  { id: "RC11", cased: "9d malformed-JSON body served to Agent A", file: "src/live/http.js",
    anchor:
      "  let json = null;\n" +
      "  try {\n" +
      '    json = text === "" ? null : JSON.parse(text);\n' +
      "  } catch {\n" +
      "    json = null;\n" +
      "  }\n" +
      "  return { status: res.status, json };\n",
    replacement:
      '  const json = text === "" ? null : JSON.parse(text); // RED CONTROL: malformed-body parse guard removed\n' +
      "  return { status: res.status, json };\n",
    testFile: TRANSPORT, pattern: "^case 9d",
    expect: { actual: "request", matches: [/'request'\s*\n\s*- 'transport'/] },
    measured: "unguarded parse throws into the generic request catch: refusal stage flips from transport to request, losing the invalid_evidence_response discrimination" },
  { id: "RC12", cased: "11 live-path challenge binding", file: "src/live/agentACore.js",
    anchor: "    if (verifyEvidence || evidenceResponse.source?.liveAcquisition === true) {\n",
    replacement: "    if (false) { // RED CONTROL: live-path challenge-binding gate removed\n",
    testFile: LIVEPATH, pattern: "^case 11",
    expect: { actual: "integrity_or_malformed" },
    measured: "with the binding gate removed, the moved-timestamp live receipts fall through to verification: refusal reason flips receipt_predates_challenge / receipt_timestamp_invalid -> integrity_or_malformed (stage flips challenge_binding -> verification); the precise live-binding refusal is lost" },
  { id: "RC13", cased: "12 live provider card label (a022ebf)", file: "src/live/agentBServer.js",
    anchor: "(evidenceProvider ? (evidenceProvider.evidenceSourceLabel ?? CUSTOM_SOURCE_LABEL) : FIXTURE_SOURCE_LABEL)",
    replacement: "FIXTURE_SOURCE_LABEL /* RED CONTROL: live-provider label precedence removed */",
    testFile: LIVEPATH, pattern: "^control: an honest Agent B with a plugged-in live provider",
    expect: { actual: "retained_fixture" },
    measured: "with the label precedence removed, an Agent B with a plugged-in live provider advertises retained_fixture again: the notEqual guard fails with actual 'retained_fixture' (Billy 2's M2 mutation)" },
];

// Import/setup failures: these mean the mutated tree never ran the intended
// test, so a nonzero exit would be meaningless. None of the expected throw
// observables (RC9c TypeError, RC10 fetch failed, RC11's caught SyntaxError)
// matches these patterns.
const SETUP_ERROR = /Cannot find module|ERR_MODULE_NOT_FOUND|ERR_UNKNOWN_FILE_EXTENSION|does not provide an export named|Cannot find package|SyntaxError/;
const PROCEED_ACTUAL = /\bPROCEED\b[^\n]*!==|actual:\s*["']?PROCEED["']?/;
const NOT_OK = /^not ok /m;

/** Classify one mutated run against its spec's expected observable. */
function classify(spec, r) {
  const log = r.log;
  if (spec.expect?.timeout) {
    const timedOut = r.error === "ETIMEDOUT";
    return { red: timedOut, why: timedOut ? "outer timeout as expected" : `expected ETIMEDOUT, got status=${r.status} error=${r.error}` };
  }
  if (r.error !== null && r.error !== undefined) {
    return { red: false, why: `runner-level process error ${r.error} (not a test outcome)` };
  }
  if (r.status === null) {
    return { red: false, why: "process failed to spawn or exited via signal without a status" };
  }
  if (SETUP_ERROR.test(log)) {
    return { red: false, why: "import/setup failure in mutated tree (module resolution / SyntaxError)" };
  }
  if (!NOT_OK.test(log)) {
    return { red: false, why: "no failing test assertion — the mutated run did not exercise the intended test" };
  }
  const failures = [];
  const e = spec.expect ?? {};
  if (e.proceed && !PROCEED_ACTUAL.test(log)) failures.push("expected an unexpected-PROCEED actual, none observed");
  if ("actual" in e) {
    const v = typeof e.actual === "number" ? String(e.actual) : e.actual;
    const re = new RegExp(`actual:\\s*["']?${v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']?\\b`);
    if (!re.test(log)) failures.push(`expected actual '${v}' in a failing diagnostic, not found`);
  }
  for (const m of e.matches ?? []) {
    if (!m.test(log)) failures.push(`expected log signature ${m} not found`);
  }
  if (!e.proceed && PROCEED_ACTUAL.test(log)) {
    failures.push("adversary unexpectedly reached PROCEED — not the measured observable for this control");
  }
  return failures.length === 0
    ? { red: true, why: spec.measured }
    : { red: false, why: failures.join("; ") };
}

function copyThrowaway(dir) {
  mkdirSync(path.join(dir, "apps"), { recursive: true });
  cpSync(PKG, path.join(dir, "apps", "worldsfair-agent-trust"), { recursive: true });
  cpSync(VENDOR_SRC, path.join(dir, "vendor", "raven-receipt-verifier"), { recursive: true });
}

function runTest(dir, testFile, pattern, timeoutMs = 90_000) {
  const cwd = path.join(dir, "apps", "worldsfair-agent-trust");
  const r = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--disable-warning=ExperimentalWarning",
      "--test", "--test-reporter=tap", "--test-name-pattern", pattern,
      `test/live-flow-adversarial/${testFile}`],
    { cwd, encoding: "utf8", timeout: timeoutMs, env: { ...process.env, PATH: process.env.PATH ?? "" } },
  );
  const log = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
  return { status: r.status, signal: r.signal, error: r.error?.code ?? null, log };
}

const results = [];

// GREEN sanity: every spec's test must pass on a pristine throwaway copy.
{
  const dir = mkdtempSync(path.join(tmpdir(), "red-control-pristine-"));
  copyThrowaway(dir);
  for (const spec of SPECS) {
    const r = runTest(dir, spec.testFile, spec.pattern);
    const pass = r.status === 0 && !r.error;
    results.push({ id: spec.id, mode: "pristine", cased: spec.cased, pass, status: r.status, error: r.error });
    writeFileSync(path.join(LOGDIR, `${spec.id}.pristine.tap`), r.log);
    assert.ok(pass, `${spec.id} pristine run must be GREEN (case ${spec.cased})`);
  }
  rmSync(dir, { recursive: true, force: true });
}

// RED: one mutation per fresh throwaway copy; the run must produce exactly the
// control's expected mutated observable — and nothing that merely looks red.
for (const spec of SPECS) {
  const dir = mkdtempSync(path.join(tmpdir(), `red-control-${spec.id}-`));
  copyThrowaway(dir);
  const target = path.join(dir, spec.file.startsWith("vendor/") ? "" : "apps/worldsfair-agent-trust", spec.file);
  const src = readFileSync(target, "utf8");
  const count = src.split(spec.anchor).length - 1;
  assert.equal(count, 1, `${spec.id}: anchor must appear exactly once in ${spec.file} (found ${count})`);
  writeFileSync(target, src.replace(spec.anchor, spec.replacement));

  const r = runTest(dir, spec.testFile, spec.pattern, spec.expectHang ? 45_000 : 90_000);
  const verdict = classify(spec, r);
  results.push({
    id: spec.id, mode: "mutated", cased: spec.cased, red: verdict.red, why: verdict.why,
    status: r.status, signal: r.signal, error: r.error,
    timedOut: r.error === "ETIMEDOUT",
  });
  writeFileSync(path.join(LOGDIR, `${spec.id}.mutated.tap`), r.log);
  rmSync(dir, { recursive: true, force: true });
}

const allRed = results.filter((r) => r.mode === "mutated").every((r) => r.red);
writeFileSync(path.join(LOGDIR, "red-controls-results.json"), JSON.stringify({ allRed, results }, null, 2));

for (const r of results) {
  console.log(`${r.mode === "pristine" ? "GREEN" : r.red ? "RED  " : "FAIL "} ${r.id.padEnd(5)} case ${r.cased} (exit ${r.status}${r.error ? `, ${r.error}` : ""}${r.timedOut ? ", timed out as expected" : ""})`);
  if (r.mode === "mutated") console.log(`      -> ${r.why}`);
}
if (KEEP_LOGS) console.log(`\nlogdir: ${LOGDIR}`);
console.log(allRed
  ? "ALL RED CONTROLS OK: every mutation produced its control's expected mutated observable; no import/setup errors (see red-controls-results.json)"
  : "SOME RED CONTROLS DID NOT PRODUCE THEIR EXPECTED OBSERVABLE — INVESTIGATE");
process.exit(allRed ? 0 : 1);
