/**
 * Red controls for the adversarial live-flow pack.
 *
 * For every adversarial case, this runner:
 *   1. copies apps/worldsfair-agent-trust + vendor/raven-receipt-verifier into
 *      a disposable throwaway directory (the real tree is never touched);
 *   2. applies ONE precise mutation that removes the check under test;
 *   3. runs the case's test against the mutated copy and requires it to FAIL
 *      (RED). A pristine run of the same test must PASS (GREEN sanity).
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
const KEEP_LOGS = Boolean(process.env.RED_CONTROL_LOGDIR);
const LOGDIR = KEEP_LOGS ? process.env.RED_CONTROL_LOGDIR : mkdtempSync(path.join(tmpdir(), "red-control-logs-"));
mkdirSync(LOGDIR, { recursive: true });

const SPECS = [
  { id: "RC1", cased: "1 replayed-same-challenge", file: "src/live/agentACore.js",
    anchor: '    if (consumedNonces.has(echo.nonce)) return { ok: false, reason: "nonce_replayed" };\n',
    replacement: "    // RED CONTROL: consumed-nonce check removed\n",
    testFile: TRANSPORT, pattern: "^case 1" },
  { id: "RC2", cased: "2 response-to-different-challenge", file: "src/live/agentACore.js",
    anchor: '    if (echo.nonce !== sent.nonce) return { ok: false, reason: "nonce_mismatch_replay" };\n',
    replacement: "    // RED CONTROL: nonce equality check removed\n",
    testFile: TRANSPORT, pattern: "^case 2" },
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
    testFile: TRANSPORT, pattern: "^case 3" },
  { id: "RC4", cased: "4 wrong signing key", file: "vendor/raven-receipt-verifier/packages/verify-js/src/verifyReceiptV1.ts",
    anchor: '    return keyTrusted ? { keyTrusted: true } : { keyTrusted: false, reason: "key_untrusted" };\n',
    replacement: "    return { keyTrusted: true }; // RED CONTROL: key-trust refusal removed\n",
    testFile: IDENTITY, pattern: "^case 4a" },
  { id: "RC5", cased: "5 card tampered after listing", file: "src/live/agentACore.js",
    anchor:
      "    if (servedHash !== candidate.cardSha256 || wellKnown.json.agentId !== candidate.agentId) {\n" +
      '      return refuse(candidate.agentId, "card_check", "endpoint_card_mismatch", {\n' +
      "        servedAgentId: wellKnown.json.agentId ?? null,\n" +
      "      });\n" +
      "    }\n",
    replacement: "    // RED CONTROL: served-card comparison removed\n",
    testFile: IDENTITY, pattern: "^case 5" },
  { id: "RC6", cased: "6 duplicate agent id", file: "src/live/registryServer.js",
    anchor: '        if (entries.has(card.agentId)) return sendJson(res, 409, { error: "agent_id_taken" });\n',
    replacement: "        // RED CONTROL: duplicate-id refusal removed\n",
    testFile: IDENTITY, pattern: "^case 6b" },
  { id: "RC7", cased: "7 one-field tamper without re-signing", file: "vendor/raven-receipt-verifier/packages/verify-js/src/verifyReceiptV1.ts",
    anchor: "  const valid = reasons.length === 0;\n",
    replacement: "  const valid = true; // RED CONTROL: integrity gate removed\n",
    testFile: IDENTITY, pattern: "^case 7" },
  { id: "RC8", cased: "8 mint mismatch", file: "vendor/raven-receipt-verifier/packages/verify-js/src/verifyReceiptV1ForSubject.ts",
    anchor: "      subjectMatches = subjectReasons.length === 0;\n",
    replacement: "      subjectMatches = true; // RED CONTROL: subject binding removed\n",
    testFile: IDENTITY, pattern: "^case 8" },
  { id: "RC9a", cased: "9 hung agent (client timeout)", file: "src/live/http.js",
    anchor: "    signal: AbortSignal.timeout(timeoutMs),\n",
    replacement: "    // RED CONTROL: client timeout removed\n",
    testFile: TRANSPORT, pattern: "^case 9c", expectHang: true },
  { id: "RC9b", cased: "9 oversized response", file: "src/live/http.js",
    anchor: '  if (Buffer.byteLength(text) > MAX_BODY_BYTES) throw new Error("response_too_large");\n',
    replacement: "  // RED CONTROL: response size cap removed\n",
    testFile: TRANSPORT, pattern: "^case 9b" },
  { id: "RC9c", cased: "9 malformed response object", file: "src/live/agentACore.js",
    anchor: '    if (!isProtocolMessage(evidenceResponse, "evidence.response")) return { ok: false, reason: "invalid_evidence_response" };\n',
    replacement: "    // RED CONTROL: response shape check removed\n",
    testFile: TRANSPORT, pattern: "^case 9a" },
  { id: "RC10", cased: "10 unreachable agent", file: "src/live/agentACore.js",
    anchor:
      "    let wellKnown;\n" +
      "    try {\n" +
      "      wellKnown = await loopbackJson(`${candidate.endpoint}/.well-known/raven-agent.json`);\n" +
      "    } catch {\n" +
      '      return refuse(candidate.agentId, "card_check", "endpoint_unreachable");\n' +
      "    }\n",
    replacement: "    const wellKnown = await loopbackJson(`${candidate.endpoint}/.well-known/raven-agent.json`); // RED CONTROL: unreachable-endpoint guard removed\n",
    testFile: TRANSPORT, pattern: "^case 10" },
];

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
  const timedOut = r.error?.code === "ETIMEDOUT" || (r.signal != null && r.error != null);
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

// RED: one mutation per fresh throwaway copy; the case test must fail.
for (const spec of SPECS) {
  const dir = mkdtempSync(path.join(tmpdir(), `red-control-${spec.id}-`));
  copyThrowaway(dir);
  const target = path.join(dir, spec.file.startsWith("vendor/") ? "" : "apps/worldsfair-agent-trust", spec.file);
  const src = readFileSync(target, "utf8");
  const count = src.split(spec.anchor).length - 1;
  assert.equal(count, 1, `${spec.id}: anchor must appear exactly once in ${spec.file} (found ${count})`);
  writeFileSync(target, src.replace(spec.anchor, spec.replacement));

  const r = runTest(dir, spec.testFile, spec.pattern, spec.expectHang ? 45_000 : 90_000);
  const red = r.status !== 0 || r.error !== null;
  results.push({
    id: spec.id, mode: "mutated", cased: spec.cased, red,
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
}
if (KEEP_LOGS) console.log(`\nlogdir: ${LOGDIR}`);
else { rmSync(LOGDIR, { recursive: true, force: true }); console.log("\nlogdir: removed (set RED_CONTROL_LOGDIR to keep logs)"); }
console.log(allRed ? "ALL RED CONTROLS OK: every removed check lets the adversary through" : "SOME RED CONTROLS DID NOT FAIL — INVESTIGATE");
process.exit(allRed ? 0 : 1);
