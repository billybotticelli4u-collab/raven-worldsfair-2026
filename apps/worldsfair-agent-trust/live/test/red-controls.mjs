// RED CONTROLS for LIVE-SOLANA. For each mutation: copy the code into a
// scratch tree, disable ONE verification / safety check, run the live test
// files, and require that at least one test FAILS. An unmutated control run
// must pass. Scratch trees are removed afterwards. Loopback stub only.
//
//   node --experimental-strip-types apps/worldsfair-agent-trust/live/test/red-controls.mjs
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const V = "vendor/raven-receipt-verifier/packages/verify-js/src";
const L = "apps/worldsfair-agent-trust/live/liveSolana.js";
const H = "apps/worldsfair-agent-trust/live/agentHooks.js";

const MUTATIONS = [
  ["vendor: skip signature check", `${V}/verifyReceiptV1.ts`, 'if (!signatureOk) reasons.push("signature_invalid");', "/* RED: signature check removed */"],
  ["vendor: skip payload-hash check", `${V}/verifyReceiptV1.ts`, "if (recomputed !== null && recomputed !== r.payloadHash) {", "if (false) {"],
  ["vendor: trust any signer key", `${V}/verifyReceiptV1.ts`, "const keyTrusted = keys.has(signerPublicKey);", "const keyTrusted = true;"],
  ["vendor: never stale", `${V}/verifyReceiptV1.ts`, "stale = ageSeconds > (r.maxAgeSeconds as number);", "stale = false;"],
  ["vendor: skip mint binding", `${V}/verifyReceiptV1ForSubject.ts`, "if (actual.mintAddress !== expected.mintAddress) {", "if (false) {"],
  ["live gate: skip receiptId check", L, "checks.receiptIdentity =\n", "checks.receiptIdentity = true ||\n"],
  ["live gate: skip payload-hash check", L, "checks.payloadHash = recomputed === r.payloadHash;", "checks.payloadHash = true;"],
  ["live gate: skip pinned-signer check", L, "checks.pinnedSigner = r.signerPublicKey === pin;", "checks.pinnedSigner = true;"],
  ["live gate: skip signature-by-pinned-key", L, "checks.signatureByPinnedKey = ed25519Verify(", "checks.signatureByPinnedKey = true || ed25519Verify("],
  ["live gate: skip rules check", L, 'checks.rulesSupportedValid = rules.rulesStatus === "supported_valid";', "checks.rulesSupportedValid = true;"],
  ["live gate: skip chain check", L, "checks.chain = r.chain === SOLANA_MAINNET;", "checks.chain = true;"],
  ["live gate: skip mint check", L, "checks.mintMatchesRequest = r.mintAddress === subject?.mintAddress;", "checks.mintMatchesRequest = true;"],
  ["live gate: skip token-program check", L, "checks.tokenProgramMatchesRequest = r.tokenProgramAddress === subject?.tokenProgramAddress;", "checks.tokenProgramMatchesRequest = true;"],
  ["live gate: skip future-skew check", L, "checks.notInFuture = ageSeconds !== null && ageSeconds >= -FRESHNESS_MAX_FUTURE_SKEW_SECONDS;", "checks.notInFuture = true;"],
  ["live gate: skip age bound", L, "checks.withinAgeBound = ageSeconds !== null && boundSeconds !== null && ageSeconds <= boundSeconds;", "checks.withinAgeBound = true;"],
  ["live: ignore live gates in verification", L, "const verified = base.result.verified === true && gatesOk;", "const verified = base.result.verified === true;"],
  ["live: ignore pinned verifier in verification", L, "const verified = base.result.verified === true && gatesOk;", "const verified = gatesOk;"],
  ["live: ignore Agent A decision", L, 'const decision = agentA.decision === "PROCEED" && liveGates.ok ? "PROCEED" : "REFUSE";', 'const decision = liveGates.ok ? "PROCEED" : "REFUSE";'],
  ["live: tamper control does not tamper", L, "if (isPlainObject(copy)) copy.slot = from + 1;", "/* RED: no tamper */"],
  ["live: redaction disabled", L, 'if (typeof s === "string" && s.length > 0) out = out.split(s).join("[REDACTED]");', "/* RED: no redaction */"],
  ["live: call cap disabled", L, "if (used >= max) {", "if (false) {"],
  ["live: more than one retry", L, "attempt <= 1 + MAX_RETRIES", "attempt <= 3 + MAX_RETRIES"],
  ["live: follow redirects", L, 'redirect: "manual",', 'redirect: "follow",'],
  ["live: allow any API base (allowlist off)", L, "if (!remoteOk && !loopback) {", "if (false) {"],
  ["live: accept a missing key", L, 'if (typeof raw !== "string" || raw.trim().length === 0) {', "if (false) {"],
  ["hooks: provider defaults the subject", H, "if (!isRequestedSubject(requested)) {", "if (false) {"],
];

function scratch() {
  const dir = mkdtempSync(path.join(tmpdir(), "raven-live-red-"));
  writeFileSync(path.join(dir, "package.json"), '{"type":"module"}\n');
  for (const p of ["apps/worldsfair-agent-trust/src", "apps/worldsfair-agent-trust/fixtures",
    "apps/worldsfair-agent-trust/live", V]) {
    mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
    cpSync(path.join(ROOT, p), path.join(dir, p), { recursive: true, filter: (s) => !s.includes(`${path.sep}runs`) });
  }
  mkdirSync(path.join(dir, "apps/raven-site"), { recursive: true });
  cpSync(path.join(ROOT, "apps/raven-site/agents.json"), path.join(dir, "apps/raven-site/agents.json"));
  return dir;
}

function runTests(dir) {
  const app = path.join(dir, "apps/worldsfair-agent-trust");
  const r = spawnSync(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", "--test", "--test-reporter=tap",
    "live/test/live-solana.test.js", "live/test/live-solana-hooks.test.js"],
  { cwd: app, encoding: "utf8", timeout: 180_000, env: { PATH: process.env.PATH } });
  const failed = [...r.stdout.matchAll(/^not ok \d+ - (.*)$/gm)].map((m) => m[1]);
  const pass = Number(/^# pass (\d+)/m.exec(r.stdout)?.[1] ?? 0);
  return { status: r.status, failed, pass };
}

let ok = true;
const control = scratch();
try {
  const c = runTests(control);
  console.log(`CONTROL (unmutated): exit ${c.status}, pass ${c.pass}, fail ${c.failed.length}`);
  if (c.status !== 0) ok = false;
} finally { rmSync(control, { recursive: true, force: true }); }

for (const [name, file, from, to] of MUTATIONS) {
  const dir = scratch();
  try {
    const target = path.join(dir, file);
    const src = readFileSync(target, "utf8");
    const count = src.split(from).length - 1;
    if (count !== 1) { console.log(`ERROR ${name}: target found ${count}x`); ok = false; continue; }
    writeFileSync(target, src.replace(from, to));
    const r = runTests(dir);
    const caught = r.status !== 0 && r.failed.length > 0;
    if (!caught) ok = false;
    console.log(`${caught ? "RED-OK " : "MISSED "} ${name}: exit ${r.status}, ${r.failed.length} failing -> ${r.failed.slice(0, 3).join(" | ")}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
console.log(ok ? `ALL ${MUTATIONS.length} RED CONTROLS CAUGHT; control green` : "RED CONTROLS INCOMPLETE");
process.exitCode = ok ? 0 : 1;
