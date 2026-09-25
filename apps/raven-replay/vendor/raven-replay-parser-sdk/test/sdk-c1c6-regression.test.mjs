/**
 * Regression tests for CODEX findings SDK-C1 … SDK-C6.
 * These would FAIL on a8f2fa7c and PASS after repair.
 * External watchdog wraps the C6 control so the suite itself cannot hang.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { resolveExecutionIdentity, executeAdapter, POLICY } from '../src/runner.mjs';
import { caseDigest, createCase, runCase, compareVersionsAgainstBaseline, summarizeParsed, summarizeFieldPath, summarizeDifferences, differences, renderSafeFieldPath, PINNED_REASON_CODES, PINNED_FIELD_NAMES } from '../src/cases.mjs';
import { canonical, normalizeValue } from '../src/normalize.mjs';
import { dependencyBinding } from '../src/binding.mjs';
import { packageRoot } from '../src/registry.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const node = process.execPath;
const cli = path.join(root, 'src', 'cli.mjs');
const fixture = path.join(root, 'fixtures', 'legacy-transaction.base64');
const input = fs.readFileSync(fixture, 'utf8').trim();
const sha = (x) => createHash('sha256').update(x).digest('hex');

function runCli(args, opts = {}) {
  return spawnSync(node, [cli, ...args], { encoding: 'utf8', cwd: root, ...opts });
}

// ---------- C1 ----------
test('C1: real transitive @solana/transactions mutation → RUN_ERROR (not MATCH)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c1-'));
  const casePath = path.join(dir, 'c.json');
  const created = runCli(['create', '--adapter', 'solana-kit-tx-decode', '--name', 'c1', fixture, casePath]);
  assert.equal(created.status, 0, created.stdout);
  const dig = JSON.parse(created.stdout).case_content_sha256;
  const before = resolveExecutionIdentity('solana-kit-tx-decode');
  assert.ok(before.closure_packages.includes('@solana/transactions'));

  const dep = path.join(root, 'node_modules/@solana/transactions/dist/index.node.mjs');
  const depBytes = fs.readFileSync(dep);
  try {
    fs.appendFileSync(dep, '\nprocess.stderr.write("C1_TRANSITIVE_MUTATION\\n");\n');
    const after = resolveExecutionIdentity('solana-kit-tx-decode');
    assert.notEqual(after.dependency_binding_sha256, before.dependency_binding_sha256,
      'binding must change when transitive execution bytes change');
    const rerun = runCli(['rerun', '--expect-sha256', dig, casePath]);
    assert.equal(rerun.status, 3, rerun.stdout);
    const body = JSON.parse(rerun.stdout);
    assert.equal(body.results[0].status, 'RUN_ERROR');
    assert.match(body.results[0].error, /Dependency installed-file inventory differs/);
    // Tool must refuse BEFORE executing changed code — execution NOT_RUN
    assert.equal(body.results[0].execution, 'NOT_RUN');
  } finally {
    fs.writeFileSync(dep, depBytes);
  }
});

test('C1: local helper mutation → RUN_ERROR', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c1h-'));
  const casePath = path.join(dir, 'c.json');
  assert.equal(runCli(['create', '--adapter', 'solana-kit-tx-decode', '--name', 'c1h', fixture, casePath]).status, 0);
  const dig = JSON.parse(fs.readFileSync(casePath, 'utf8'));
  // Use case digest from create via rerun path
  const helper = path.join(root, 'adapters/solana-kit-tx-decode/helpers.mjs');
  const helperBytes = fs.readFileSync(helper);
  const before = resolveExecutionIdentity('solana-kit-tx-decode');
  try {
    fs.writeFileSync(helper, helperBytes.toString().replace('helpers/1', 'helpers/MUTATED'));
    const after = resolveExecutionIdentity('solana-kit-tx-decode');
    assert.notEqual(after.dependency_binding_sha256, before.dependency_binding_sha256);
    const caseDig = caseDigest(JSON.parse(fs.readFileSync(casePath, 'utf8')));
    const rerun = runCli(['rerun', '--expect-sha256', caseDig, casePath]);
    assert.equal(rerun.status, 3);
    assert.equal(JSON.parse(rerun.stdout).results[0].status, 'RUN_ERROR');
    assert.equal(JSON.parse(rerun.stdout).results[0].execution, 'NOT_RUN');
  } finally {
    fs.writeFileSync(helper, helperBytes);
  }
});

// ---------- C2 ----------
test('C2: positive malformed-input → REJECT then MATCH', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c2pos-'));
  const trunc = path.join(dir, 't.base64');
  fs.writeFileSync(trunc, 'AA==\n');
  const casePath = path.join(dir, 'c.json');
  const created = runCli(['create', '--adapter', 'solana-kit-tx-decode', '--name', 'c2pos', trunc, casePath]);
  assert.equal(created.status, 0, created.stdout);
  assert.equal(JSON.parse(created.stdout).expected_result.decision, 'REJECT');
  assert.equal(runCli(['rerun', casePath]).status, 0);
});

test('C2: injected internal Error with each old regex term → RUN_ERROR (not REJECT baseline)', async (t) => {
  const terms = ['unexpected', 'byte', 'range', 'codec', 'decode', 'offset', 'empty', 'exceed', 'truncated', 'exhaust'];
  const dep = path.join(root, 'node_modules/@solana/transactions/dist/index.node.mjs');
  const depBytes = fs.readFileSync(dep);
  assert.ok(depBytes.toString().includes('function getTransactionDecoder() {'));
  for (const term of terms) {
    await t.test('internal fault containing: ' + term, () => {
      try {
        const text = depBytes.toString();
        fs.writeFileSync(
          dep,
          text.replace(
            'function getTransactionDecoder() {',
            'function getTransactionDecoder() { throw new Error("' + term + ' internal adapter fault");',
          ),
        );
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c2-' + term + '-'));
        const casePath = path.join(dir, 'c.json');
        // Binding will also differ because we mutated transitive file — that alone is RUN_ERROR.
        // For C2 we need the adapter itself to classify the error: call executeAdapter after
        // temporarily aligning... Actually mutating transitive changes binding, so create fails
        // at binding if we had a case. Fresh create: resolveExecutionIdentity succeeds with NEW
        // binding, then execute runs mutated decoder which throws plain Error → adapter exits 1
        // → incomplete → create returns RUN_ERROR (cannot save REJECT baseline). That is the fix.
        const created = runCli(['create', '--adapter', 'solana-kit-tx-decode', '--name', 'c2' + term, fixture, casePath]);
        assert.notEqual(created.status, 0, 'must not save REJECT baseline for internal fault: ' + term);
        const body = JSON.parse(created.stdout);
        assert.equal(body.status, 'RUN_ERROR');
        assert.ok(!fs.existsSync(casePath), 'no case file for internal fault');
      } finally {
        fs.writeFileSync(dep, depBytes);
      }
    });
  }
});

// ---------- C3 ----------
test('C3: default report cannot reconstruct fixture bytes; sentinel not leaked', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c3-'));
  const casePath = path.join(dir, 'c.json');
  const reportPath = path.join(dir, 'report.json');
  const created = runCli(['create', '--adapter', 'solana-kit-tx-decode', '--name', 'c3', fixture, casePath]);
  assert.equal(created.status, 0, created.stdout);
  const dig = JSON.parse(created.stdout).case_content_sha256;
  assert.equal(runCli(['report', '--expect-sha256', dig, casePath, reportPath]).status, 0);
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  assert.equal(report.limits.report_omits_reconstructible_wire, true);
  const text = JSON.stringify(report);
  assert.ok(!text.includes('messageBytes'));
  assert.ok(!text.includes('"signatures"'));
  // Reconstruction attempt: summarized decoded has digests/field names only — no wire payload
  const decodedSummary = report.results[0].actual_result.decoded;
  assert.ok(decodedSummary);
  assert.ok(Array.isArray(decodedSummary.field_names));
  assert.equal(decodedSummary.wire, undefined);
  assert.equal(decodedSummary.messageBytes, undefined);
  assert.ok(decodedSummary.decoded_sha256 && /^[a-f0-9]{64}$/.test(decodedSummary.decoded_sha256));
  // Cannot rebuild 215 fixture bytes from default report
  assert.ok(!text.includes(input));

  // Sentinel adapter
  const sCase = path.join(dir, 's.json');
  const sReport = path.join(dir, 's-report.json');
  const SENTINEL = 'RAW_SENTINEL_DO_NOT_ECHO_IN_DEFAULT_REPORT_7f3a9c';
  assert.equal(runCli(['create', '--adapter', 'example-sentinel-echo', '--name', 'sent', fixture, sCase]).status, 0);
  assert.equal(runCli(['report', sCase, sReport]).status, 0);
  const sBody = fs.readFileSync(sReport, 'utf8');
  assert.ok(!sBody.includes(SENTINEL), 'default report must not echo sentinel');

  // Detailed export is separately labelled and may include payloads
  const dReport = path.join(dir, 'detailed.json');
  assert.equal(runCli(['report', '--detailed', sCase, dReport]).status, 0);
  const d = JSON.parse(fs.readFileSync(dReport, 'utf8'));
  assert.equal(d.limits.detailed_export !== false, true);
  assert.match(String(d.limits.detailed_export), /OPT-IN|detailed/i);
  assert.ok(JSON.stringify(d).includes(SENTINEL), 'detailed opt-in may include sentinel');
});

// ---------- C4 ----------
test('C4: own __proto__ changes digest; changed-case → INVALID_CASE before execution', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4-'));
  const casePath = path.join(dir, 'c.json');
  assert.equal(runCli(['create', '--adapter', 'example-parser-v1', '--name', 'c4', fixture, casePath]).status, 0);
  const baseline = JSON.parse(fs.readFileSync(casePath, 'utf8'));
  const digest = caseDigest(baseline);
  const changed = JSON.parse(JSON.stringify(baseline));
  Object.defineProperty(changed.expected_execution.parsed.decoded, '__proto__', {
    value: null, enumerable: true, configurable: true, writable: true,
  });
  assert.ok(Object.hasOwn(changed.expected_execution.parsed.decoded, '__proto__'));
  assert.notEqual(caseDigest(changed), digest, 'own __proto__ must change canonical digest');
  const changedPath = path.join(dir, 'changed.json');
  fs.writeFileSync(changedPath, JSON.stringify(changed));
  const rerun = runCli(['rerun', '--expect-sha256', digest, changedPath]);
  assert.equal(rerun.status, 2, rerun.stdout);
  const body = JSON.parse(rerun.stdout);
  assert.equal(body.results[0].status, 'INVALID_CASE');
  assert.equal(body.results[0].reference, 'MISMATCH');
  assert.equal(body.results[0].execution, 'NOT_RUN');
});

test('C4 Option A: natives rejected at boundary; JSON lookalikes are plain data; own keys preserved', () => {
  // Option A: refuse native Map / Uint8Array / bigint at case/hash API boundary.
  assert.throws(() => canonical(new Map([['answer', 1]])), /Native Map refused/);
  assert.throws(() => normalizeValue(Uint8Array.from([1, 2, 3])), /Native Uint8Array refused/);
  assert.throws(() => normalizeValue(10n), /Native bigint refused/);
  // Plain JSON lookalikes are ordinary objects (no native collision possible under Option A).
  const lookalikeBytes = { $type: 'bytes', encoding: 'base64', data: Buffer.from([1, 2, 3]).toString('base64') };
  const lookalikeMap = { $type: 'Map', entries: [['answer', 1]] };
  const lookalikeBig = { $type: 'bigint', value: '10' };
  assert.equal(canonical(lookalikeBytes), canonical(JSON.parse(JSON.stringify(lookalikeBytes))));
  assert.notEqual(canonical(lookalikeMap), canonical({}));
  assert.notEqual(canonical(lookalikeBig), canonical(10));
  // Distinct plain objects still differ (Map-difference control retained as plain data).
  assert.notEqual(
    canonical({ $type: 'Map', entries: [['answer', 1]] }),
    canonical({ $type: 'Map', entries: [['answer', 2]] }),
  );
  // Own-key constructor/prototype-like keys preserved.
  const obj = { constructor: { name: 'x' }, prototype: { y: 1 }, ok: true };
  const n = normalizeValue(obj);
  assert.equal(n.constructor.name, 'x');
  assert.equal(n.prototype.y, 1);
  assert.equal(n.ok, true);
  const plain = { a: 1, nested: { b: [1, 2] } };
  assert.equal(canonical(plain), canonical(JSON.parse(JSON.stringify(plain))));
});

// ---------- C5 ----------
test('C5: saved baseline + retained digest required; baseline drift refused before candidate run', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c5-'));
  const baseCase = path.join(dir, 'base.json');
  assert.equal(runCli(['create', '--adapter', 'example-parser-v1', '--name', 'c5base', fixture, baseCase]).status, 0);
  const dig = caseDigest(JSON.parse(fs.readFileSync(baseCase, 'utf8')));
  const out = path.join(dir, 'cmp.json');
  const ok = runCli([
    'compare-versions', '--baseline-case', baseCase, '--expect-sha256', dig,
    '--candidate', 'example-parser-v2', '--label', 'ok', out,
  ]);
  assert.equal(ok.status, 0, ok.stdout);
  assert.ok(JSON.parse(ok.stdout).difference_fields.some((f) => f.includes('label')));

  // Edit baseline adapter source → must refuse
  const example = path.join(root, 'adapters/example-parser/v1.mjs');
  const exampleBytes = fs.readFileSync(example);
  try {
    fs.writeFileSync(example, exampleBytes.toString().replace("label: 'baseline'", "label: 'silently-replaced-baseline'"));
    const out2 = path.join(dir, 'cmp2.json');
    const bad = runCli([
      'compare-versions', '--baseline-case', baseCase, '--expect-sha256', dig,
      '--candidate', 'example-parser-v2', '--label', 'drift', out2,
    ]);
    assert.equal(bad.status, 3, bad.stdout);
    assert.match(bad.stdout, /Baseline adapter source bytes differ|RUN_ERROR/);
    assert.ok(!fs.existsSync(out2), 'must not write comparison on baseline drift');
  } finally {
    fs.writeFileSync(example, exampleBytes);
  }
});

// ---------- C6 ----------
test('C6: non-cooperating SIGTERM-ignore child → RUN_ERROR promptly; no surviving process; no saved case', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c6-'));
  const casePath = path.join(dir, 'must-not-save.json');
  const started = Date.now();
  // External suite watchdog: kill process group at 15s if still running
  const child = spawn(node, [cli, 'create', '--adapter', 'control-hang-ignore-term', '--name', 'c6', fixture, casePath], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (c) => { stdout += c; });
  child.stderr.on('data', (c) => { stderr += c; });
  const suiteWatchdog = setTimeout(() => {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* ignore */ }
  }, 15000);
  const { code } = await new Promise((resolve) => {
    child.on('close', (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(suiteWatchdog);
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 12000, 'must return promptly, elapsed=' + elapsed);
  assert.equal(code, 3);
  const body = JSON.parse(stdout);
  assert.equal(body.status, 'RUN_ERROR');
  assert.ok(!fs.existsSync(casePath), 'no saved passing baseline');
  // No surviving control-hang-ignore-term node listeners from this test's child group
  const ps = spawnSync('pgrep', ['-f', 'hang-ignore-term'], { encoding: 'utf8' });
  // pgrep exit 1 = no matches (good). If matches, fail.
  if (ps.status === 0 && ps.stdout.trim()) {
    // Filter out unrelated; our child should be dead
    assert.fail('surviving hang-ignore-term process: ' + ps.stdout);
  }
  assert.ok(POLICY.timeout_ms === 5000);
});

// ---------- Remaining findings after fd5dd8cb (C1C6R2) ----------

test('C1-remaining: shared helper under adapters/ outside entry dir is bound; mutation → RUN_ERROR', () => {
  const registryPath = path.join(root, 'adapters/registry.json');
  const regBytes = fs.readFileSync(registryPath);
  const controlsDir = path.join(root, 'adapters/codex-recheck-controls');
  const sharedDir = path.join(root, 'adapters/codex-recheck-shared');
  fs.mkdirSync(controlsDir, { recursive: true });
  fs.mkdirSync(sharedDir, { recursive: true });
  const helperPath = path.join(sharedDir, 'helper.mjs');
  fs.writeFileSync(helperPath, 'export const marker = "shared-helper/1";\n');
  fs.writeFileSync(
    path.join(controlsDir, 'adapter.mjs'),
    `import { marker } from '../codex-recheck-shared/helper.mjs';
let s = '';
process.stdin.on('data', (c) => { s += c; });
process.stdin.on('end', () => {
  process.stdout.write(JSON.stringify({
    decision: 'ACCEPT', version: 'legacy', reason: 'ok:shared-helper-control',
    decoded: { marker },
  }) + '\\n');
});
`,
  );
  const reg = JSON.parse(regBytes.toString());
  reg.adapters.push({
    id: 'codex-shared-helper-control',
    label: 'C1 shared helper control',
    entrypoint: 'codex-recheck-controls/adapter.mjs',
    output_contract: 'raven-adapter-parsed/1',
    dependency_packages: [],
  });
  fs.writeFileSync(registryPath, JSON.stringify(reg, null, 2) + '\n');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c1rem-'));
  const casePath = path.join(dir, 'c.json');
  try {
    const created = runCli(['create', '--adapter', 'codex-shared-helper-control', '--name', 'c1rem', fixture, casePath]);
    assert.equal(created.status, 0, created.stdout);
    const dig = JSON.parse(created.stdout).case_content_sha256;
    const before = resolveExecutionIdentity('codex-shared-helper-control');
    fs.appendFileSync(helperPath, 'process.stderr.write("C1_SHARED_HELPER_MUTATED\\n");\n');
    const after = resolveExecutionIdentity('codex-shared-helper-control');
    assert.notEqual(after.dependency_binding_sha256, before.dependency_binding_sha256,
      'shared helper under adapters/ must participate in binding');
    const rerun = runCli(['rerun', '--expect-sha256', dig, casePath]);
    assert.equal(rerun.status, 3, rerun.stdout);
    const body = JSON.parse(rerun.stdout);
    assert.equal(body.results[0].status, 'RUN_ERROR');
    assert.equal(body.results[0].execution, 'NOT_RUN');
  } finally {
    fs.writeFileSync(registryPath, regBytes);
    fs.rmSync(controlsDir, { recursive: true, force: true });
    fs.rmSync(sharedDir, { recursive: true, force: true });
  }
});

test('C2-remaining: construction fault 8078004 → RUN_ERROR (not REJECT baseline)', async () => {
  const adapterPath = path.join(root, 'adapters/solana-kit-tx-decode/adapter.mjs');
  const adapterBytes = fs.readFileSync(adapterPath);
  try {
    let atext = adapterBytes.toString();
    const needle = 'txDecoder = getTransactionDecoder();\n    messageDecoder = getCompiledTransactionMessageDecoder();';
    assert.ok(atext.includes(needle), 'adapter construction needle missing');
    atext = atext.replace(
      needle,
      needle + '\n    { const { SolanaError } = await import("@solana/errors"); throw new SolanaError(8078004); }',
    );
    fs.writeFileSync(adapterPath, atext);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c2rem-'));
    const casePath = path.join(dir, 'c.json');
    const created = runCli(['create', '--adapter', 'solana-kit-tx-decode', '--name', 'c2rem', fixture, casePath]);
    assert.notEqual(created.status, 0, 'construction fault must not save REJECT baseline');
    const body = JSON.parse(created.stdout);
    assert.equal(body.status, 'RUN_ERROR');
    assert.ok(!fs.existsSync(casePath));
  } finally {
    fs.writeFileSync(adapterPath, adapterBytes);
  }
});

test('C3-remaining: reason-echo REJECT cannot reconstruct input from default report', () => {
  const registryPath = path.join(root, 'adapters/registry.json');
  const regBytes = fs.readFileSync(registryPath);
  const controlsDir = path.join(root, 'adapters/codex-recheck-controls');
  fs.mkdirSync(controlsDir, { recursive: true });
  fs.writeFileSync(
    path.join(controlsDir, 'reason-echo.mjs'),
    `let s = '';
process.stdin.on('data', (c) => { s += c; });
process.stdin.on('end', () => {
  const req = JSON.parse(s);
  process.stdout.write(JSON.stringify({
    decision: 'REJECT', version: null, reason: req.input_base64, decoded: null,
  }) + '\\n');
});
`,
  );
  const reg = JSON.parse(regBytes.toString());
  reg.adapters.push({
    id: 'codex-reason-echo',
    label: 'C3 reason echo control',
    entrypoint: 'codex-recheck-controls/reason-echo.mjs',
    output_contract: 'raven-adapter-parsed/1',
    dependency_packages: [],
  });
  fs.writeFileSync(registryPath, JSON.stringify(reg, null, 2) + '\n');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c3rem-'));
  try {
    const casePath = path.join(dir, 'c.json');
    const reportPath = path.join(dir, 'report.json');
    const created = runCli(['create', '--adapter', 'codex-reason-echo', '--name', 'echo', fixture, casePath]);
    assert.equal(created.status, 0, created.stdout);
    assert.equal(runCli(['report', casePath, reportPath]).status, 0);
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    const text = JSON.stringify(report);
    assert.ok(!text.includes(input), 'default report must not contain fixture base64 from reason');
    assert.equal(report.limits.report_omits_reconstructible_wire, true);
    const expected = report.results[0].expected_result;
    assert.equal(expected.reason, undefined);
    assert.equal(expected.reason_omitted, true);
    assert.ok(expected.reason_sha256 && /^[a-f0-9]{64}$/.test(expected.reason_sha256));
    const dReport = path.join(dir, 'detailed.json');
    assert.equal(runCli(['report', '--detailed', casePath, dReport]).status, 0);
    assert.ok(fs.readFileSync(dReport, 'utf8').includes(input), 'detailed may include reason echo');
  } finally {
    fs.writeFileSync(registryPath, regBytes);
    fs.rmSync(controlsDir, { recursive: true, force: true });
  }
});

test('C3-remaining: default compare-versions omits full baseline; detailed opt-in restores it', () => {
  const registryPath = path.join(root, 'adapters/registry.json');
  const regBytes = fs.readFileSync(registryPath);
  const controlsDir = path.join(root, 'adapters/codex-recheck-controls');
  fs.mkdirSync(controlsDir, { recursive: true });
  fs.writeFileSync(
    path.join(controlsDir, 'kit-candidate.mjs'),
    `let s = '';
process.stdin.on('data', (c) => { s += c; });
process.stdin.on('end', () => {
  process.stdout.write(JSON.stringify({
    decision: 'ACCEPT', version: 'legacy', reason: 'ok:candidate-stub',
    decoded: { label: 'candidate-stub' },
  }) + '\\n');
});
`,
  );
  const reg = JSON.parse(regBytes.toString());
  reg.adapters.push({
    id: 'codex-kit-candidate-stub',
    label: 'stub',
    entrypoint: 'codex-recheck-controls/kit-candidate.mjs',
    output_contract: 'raven-adapter-parsed/1',
    dependency_packages: [],
  });
  fs.writeFileSync(registryPath, JSON.stringify(reg, null, 2) + '\n');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c3cmp-'));
  const baseCase = path.join(dir, 'base.json');
  const out = path.join(dir, 'cmp.json');
  try {
    // Create baseline AFTER stub is registered so adapters/ inventory matches at compare time.
    const created = runCli(['create', '--adapter', 'solana-kit-tx-decode', '--name', 'c3cmp', fixture, baseCase]);
    assert.equal(created.status, 0, created.stdout);
    const dig = JSON.parse(created.stdout).case_content_sha256;
    const cmp = runCli([
      'compare-versions', '--baseline-case', baseCase, '--expect-sha256', dig,
      '--candidate', 'codex-kit-candidate-stub', '--label', 'c3cmp', out,
    ]);
    assert.equal(cmp.status, 0, cmp.stdout);
    const body = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.ok(!JSON.stringify(body).includes(input), 'default comparison must not contain fixture base64');
    assert.equal(body.baseline.result_full_from_saved_baseline, null);
    assert.equal(body.baseline.detailed_export, false);
    const outD = path.join(dir, 'cmp-d.json');
    assert.equal(runCli([
      'compare-versions', '--baseline-case', baseCase, '--expect-sha256', dig,
      '--candidate', 'codex-kit-candidate-stub', '--label', 'c3cmp-d', '--detailed', outD,
    ]).status, 0);
    const bodyD = JSON.parse(fs.readFileSync(outD, 'utf8'));
    assert.equal(bodyD.baseline.detailed_export, true);
    assert.ok(bodyD.baseline.result_full_from_saved_baseline);
  } finally {
    fs.writeFileSync(registryPath, regBytes);
    fs.rmSync(controlsDir, { recursive: true, force: true });
  }
});

test('C6-remaining: valid JSON prefix + stdout overflow → RUN_ERROR; no MATCH', () => {
  const registryPath = path.join(root, 'adapters/registry.json');
  const regBytes = fs.readFileSync(registryPath);
  const controlsDir = path.join(root, 'adapters/codex-recheck-controls');
  fs.mkdirSync(controlsDir, { recursive: true });
  const valid = JSON.stringify({
    decision: 'ACCEPT', version: 'legacy', reason: 'ok:overflow-control', decoded: { answer: 1 },
  });
  fs.writeFileSync(
    path.join(controlsDir, 'valid-then-flood.mjs'),
    `import fs from 'node:fs';
let s = '';
process.stdin.on('data', (c) => { s += c; });
process.stdin.on('end', () => {
  process.stdout.write(${JSON.stringify(valid)});
  fs.writeSync(1, Buffer.alloc(131072, 0x58));
});
`,
  );
  const reg = JSON.parse(regBytes.toString());
  reg.adapters.push({
    id: 'codex-valid-then-flood',
    label: 'overflow',
    entrypoint: 'codex-recheck-controls/valid-then-flood.mjs',
    output_contract: 'raven-adapter-parsed/1',
    dependency_packages: [],
  });
  fs.writeFileSync(registryPath, JSON.stringify(reg, null, 2) + '\n');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c6ov-'));
  const casePath = path.join(dir, 'c.json');
  try {
    const created = runCli(['create', '--adapter', 'codex-valid-then-flood', '--name', 'ov', fixture, casePath]);
    assert.notEqual(created.status, 0, 'overflow must not create MATCH baseline');
    assert.equal(JSON.parse(created.stdout).status, 'RUN_ERROR');
    assert.ok(!fs.existsSync(casePath));
  } finally {
    fs.writeFileSync(registryPath, regBytes);
    fs.rmSync(controlsDir, { recursive: true, force: true });
  }
});

test('C6-remaining: stderr overflow after valid result → RUN_ERROR', () => {
  const registryPath = path.join(root, 'adapters/registry.json');
  const regBytes = fs.readFileSync(registryPath);
  const controlsDir = path.join(root, 'adapters/codex-recheck-controls');
  fs.mkdirSync(controlsDir, { recursive: true });
  const valid = JSON.stringify({
    decision: 'ACCEPT', version: 'legacy', reason: 'ok:stderr-overflow', decoded: { answer: 1 },
  });
  fs.writeFileSync(
    path.join(controlsDir, 'stderr-flood.mjs'),
    `import fs from 'node:fs';
let s = '';
process.stdin.on('data', (c) => { s += c; });
process.stdin.on('end', () => {
  process.stdout.write(${JSON.stringify(valid)} + '\n');
  fs.writeSync(2, Buffer.alloc(131072, 0x59));
});
`,
  );
  const reg = JSON.parse(regBytes.toString());
  reg.adapters.push({
    id: 'codex-stderr-flood',
    label: 'stderr overflow',
    entrypoint: 'codex-recheck-controls/stderr-flood.mjs',
    output_contract: 'raven-adapter-parsed/1',
    dependency_packages: [],
  });
  fs.writeFileSync(registryPath, JSON.stringify(reg, null, 2) + '\n');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c6se-'));
  const casePath = path.join(dir, 'c.json');
  try {
    const created = runCli(['create', '--adapter', 'codex-stderr-flood', '--name', 'se', fixture, casePath]);
    assert.notEqual(created.status, 0);
    assert.equal(JSON.parse(created.stdout).status, 'RUN_ERROR');
    assert.ok(!fs.existsSync(casePath));
  } finally {
    fs.writeFileSync(registryPath, regBytes);
    fs.rmSync(controlsDir, { recursive: true, force: true });
  }
});

test('C6-remaining: non-detached descendant does not survive successful completion', () => {
  const registryPath = path.join(root, 'adapters/registry.json');
  const regBytes = fs.readFileSync(registryPath);
  const controlsDir = path.join(root, 'adapters/codex-recheck-controls');
  fs.mkdirSync(controlsDir, { recursive: true });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c6desc-'));
  const pidfile = path.join(dir, 'descendant-pid.json');
  const descendant = path.join(controlsDir, 'descendant-listener.mjs');
  fs.writeFileSync(descendant, 'setInterval(() => {}, 1000);\n');
  const valid = JSON.stringify({
    decision: 'ACCEPT', version: 'legacy', reason: 'ok:descendant-control', decoded: { answer: 1 },
  });
  fs.writeFileSync(
    path.join(controlsDir, 'spawn-descendant.mjs'),
    `import fs from 'node:fs';
import { spawn } from 'node:child_process';
let s = '';
process.stdin.on('data', (c) => { s += c; });
process.stdin.on('end', () => {
  const child = spawn(process.execPath, [${JSON.stringify(descendant)}], { stdio: 'ignore' });
  fs.writeFileSync(${JSON.stringify(pidfile)}, JSON.stringify({ pid: child.pid, group: process.pid }));
  child.unref();
  process.stdout.write(${JSON.stringify(valid)} + '\\n');
});
`,
  );
  const reg = JSON.parse(regBytes.toString());
  reg.adapters.push({
    id: 'codex-spawn-descendant',
    label: 'descendant',
    entrypoint: 'codex-recheck-controls/spawn-descendant.mjs',
    output_contract: 'raven-adapter-parsed/1',
    dependency_packages: [],
  });
  fs.writeFileSync(registryPath, JSON.stringify(reg, null, 2) + '\n');
  const casePath = path.join(dir, 'c.json');
  try {
    const created = runCli(['create', '--adapter', 'codex-spawn-descendant', '--name', 'desc', fixture, casePath]);
    assert.equal(created.status, 0, created.stdout);
    assert.ok(fs.existsSync(pidfile));
    const { pid } = JSON.parse(fs.readFileSync(pidfile, 'utf8'));
    let alive = false;
    try { process.kill(pid, 0); alive = true; } catch { /* expected */ }
    assert.equal(alive, false, 'descendant must not survive after watchdog terminal cleanup');
  } finally {
    fs.writeFileSync(registryPath, regBytes);
    fs.rmSync(controlsDir, { recursive: true, force: true });
    try {
      const { pid } = JSON.parse(fs.readFileSync(pidfile, 'utf8'));
      try { process.kill(pid, 'SIGKILL'); } catch { /* ignore */ }
    } catch { /* ignore */ }
  }
});


// ---------- C3 pin-map (CODEX C1C6R2 remaining) ----------
test('C3-pin: short reason AA== is digested (not reason_code) in default report', () => {
  const registryPath = path.join(root, 'adapters/registry.json');
  const regBytes = fs.readFileSync(registryPath);
  const controlsDir = path.join(root, 'adapters/codex-recheck-controls');
  fs.mkdirSync(controlsDir, { recursive: true });
  fs.writeFileSync(
    path.join(controlsDir, 'short-reason-echo.mjs'),
    `let s = '';
process.stdin.on('data', (c) => { s += c; });
process.stdin.on('end', () => {
  const req = JSON.parse(s);
  process.stdout.write(JSON.stringify({
    decision: 'REJECT', version: null, reason: req.input_base64, decoded: null,
  }) + '\\n');
});
`,
  );
  const reg = JSON.parse(regBytes.toString());
  reg.adapters.push({
    id: 'codex-short-reason-echo',
    label: 'C3 short reason AA== control',
    entrypoint: 'codex-recheck-controls/short-reason-echo.mjs',
    output_contract: 'raven-adapter-parsed/1',
    dependency_packages: [],
  });
  fs.writeFileSync(registryPath, JSON.stringify(reg, null, 2) + '\n');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c3aa-'));
  try {
    const shortFix = path.join(dir, 'aa.b64');
    fs.writeFileSync(shortFix, 'AA==\n');
    const casePath = path.join(dir, 'c.json');
    const reportPath = path.join(dir, 'report.json');
    const created = runCli(['create', '--adapter', 'codex-short-reason-echo', '--name', 'aa', shortFix, casePath]);
    assert.equal(created.status, 0, created.stdout);
    assert.equal(runCli(['report', casePath, reportPath]).status, 0);
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    assert.equal(report.limits.report_omits_reconstructible_wire, true);
    const text = JSON.stringify(report);
    assert.ok(!text.includes('"reason_code":"AA=="'), 'AA== must not appear as reason_code');
    assert.ok(!/"reason_code"\s*:\s*"AA=="/.test(text));
    // Plaintext AA== must not appear as a JSON string value in the summary (digest hex is fine).
    const expected = report.results[0].expected_result;
    const actual = report.results[0].actual_result;
    assert.equal(expected.reason_code, undefined);
    assert.equal(actual.reason_code, undefined);
    assert.equal(expected.reason_omitted, true);
    assert.equal(actual.reason_omitted, true);
    assert.ok(expected.reason_sha256 && /^[a-f0-9]{64}$/.test(expected.reason_sha256));
    // Pinned code still readable
    const pinned = summarizeParsed({ decision: 'REJECT', version: null, reason: 'empty_input', decoded: null });
    assert.equal(pinned.reason_code, 'empty_input');
    assert.ok(PINNED_REASON_CODES.has('empty_input'));
  } finally {
    fs.writeFileSync(registryPath, regBytes);
    fs.rmSync(controlsDir, { recursive: true, force: true });
  }
});

test('C3-pin: identifier-shaped hex-chunk field names cannot reconstruct 215 fixture bytes', () => {
  const registryPath = path.join(root, 'adapters/registry.json');
  const regBytes = fs.readFileSync(registryPath);
  const controlsDir = path.join(root, 'adapters/codex-recheck-controls');
  fs.mkdirSync(controlsDir, { recursive: true });
  // Mirror CODEX probe: split input bytes into 24-byte hex chunks embedded in identifier keys.
  fs.writeFileSync(
    path.join(controlsDir, 'fieldnames-hex.mjs'),
    `let s = '';
process.stdin.on('data', (c) => { s += c; });
process.stdin.on('end', () => {
  const req = JSON.parse(s);
  const bytes = Buffer.from(req.input_base64, 'base64');
  const decoded = {};
  const chunk = 24;
  for (let i = 0, n = 0; i < bytes.length; i += chunk, n++) {
    const slice = bytes.subarray(i, Math.min(i + chunk, bytes.length));
    const key = 'part' + String(n).padStart(3, '0') + '_' + Buffer.from(slice).toString('hex');
    decoded[key] = null;
  }
  process.stdout.write(JSON.stringify({
    decision: 'ACCEPT', version: null, reason: 'ok:legacy_wire_decode', decoded,
  }) + '\\n');
});
`,
  );
  const reg = JSON.parse(regBytes.toString());
  reg.adapters.push({
    id: 'codex-fieldnames-hex',
    label: 'C3 fieldnames hex-chunk control',
    entrypoint: 'codex-recheck-controls/fieldnames-hex.mjs',
    output_contract: 'raven-adapter-parsed/1',
    dependency_packages: [],
  });
  fs.writeFileSync(registryPath, JSON.stringify(reg, null, 2) + '\n');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c3fn-'));
  try {
    const casePath = path.join(dir, 'c.json');
    const reportPath = path.join(dir, 'report.json');
    const created = runCli(['create', '--adapter', 'codex-fieldnames-hex', '--name', 'fn', fixture, casePath]);
    assert.equal(created.status, 0, created.stdout);
    assert.equal(runCli(['report', casePath, reportPath]).status, 0);
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    assert.equal(report.limits.report_omits_reconstructible_wire, true);
    const text = JSON.stringify(report);
    assert.ok(!text.includes('part000_'), 'raw part000_ keys must not appear');
    const names = report.results[0].actual_result.decoded.field_names;
    assert.ok(names.every((n) => /^field_[a-f0-9]{12}$/.test(n)), 'all names must be field_<sha12>');
    assert.ok(!/part\d{3}_[0-9a-f]+/i.test(text), 'partNNN_<hex> payload keys must not appear in default report');
    // Reconstruction attempt matching CODEX probe: concat hex after partNNN_ prefixes
    const parts = [...text.matchAll(/part\d{3}_([0-9a-f]+)/gi)].map((m) => m[1]);
    const recon = Buffer.from(parts.join(''), 'hex');
    const fixtureBytes = Buffer.from(input, 'base64');
    assert.equal(fixtureBytes.length, 215);
    assert.ok(recon.length < 215, 'must not reconstruct all 215 fixture bytes from default report field names');
    // Pinned top-level kit names remain readable via summarizeParsed on kit-shaped object
    const kitLike = summarizeParsed({
      decision: 'ACCEPT', version: 'legacy', reason: 'ok:legacy_wire_decode',
      decoded: { wire: { x: 1 }, message: { y: 2 }, sdk: { z: 3 } },
    });
    assert.deepEqual(kitLike.decoded.field_names.slice().sort(), ['message', 'sdk', 'wire']);
    assert.equal(kitLike.reason_code, 'ok:legacy_wire_decode');
    assert.ok(PINNED_FIELD_NAMES.has('wire'));
  } finally {
    fs.writeFileSync(registryPath, regBytes);
    fs.rmSync(controlsDir, { recursive: true, force: true });
  }
});

test('C3-pin: long/short unpinned keys in difference paths are digested; pinned label remains', () => {
  const longKey = 'x'.repeat(90);
  const shortWeird = 'a!';
  const diffs = [
    { field: 'comparison.parsed.decoded.label', expected_value_sha256: 'aa', actual_value_sha256: 'bb' },
    { field: 'comparison.parsed.decoded.' + longKey, expected_value_sha256: 'cc', actual_value_sha256: 'dd' },
    { field: 'comparison.parsed.decoded.' + shortWeird, expected_value_sha256: 'ee', actual_value_sha256: 'ff' },
    { field: 'comparison.parsed.decoded.part000_0191a27d261e5413a7ed9ffd233493e6b95d140ba2b5e637', expected_value_sha256: '11', actual_value_sha256: '22' },
  ];
  const safe = summarizeDifferences(diffs);
  assert.equal(safe[0].field, 'comparison.parsed.decoded.label');
  assert.ok(safe[1].field.startsWith('comparison.parsed.decoded.field_'));
  assert.ok(!safe[1].field.includes(longKey));
  assert.ok(safe[2].field.startsWith('comparison.parsed.decoded.field_'));
  assert.ok(!safe[2].field.includes(shortWeird));
  assert.ok(safe[3].field.startsWith('comparison.parsed.decoded.field_'));
  assert.ok(!safe[3].field.includes('part000_'));
  assert.equal(summarizeFieldPath('comparison.parsed.decoded.wire.messageBytes'), 'comparison.parsed.decoded.wire.messageBytes');
});

test('C3-pin: detailed export still labelled and may include unpinned reason/keys', () => {
  const registryPath = path.join(root, 'adapters/registry.json');
  const regBytes = fs.readFileSync(registryPath);
  const controlsDir = path.join(root, 'adapters/codex-recheck-controls');
  fs.mkdirSync(controlsDir, { recursive: true });
  fs.writeFileSync(
    path.join(controlsDir, 'short-reason-echo.mjs'),
    `let s = '';
process.stdin.on('data', (c) => { s += c; });
process.stdin.on('end', () => {
  const req = JSON.parse(s);
  process.stdout.write(JSON.stringify({
    decision: 'REJECT', version: null, reason: req.input_base64, decoded: null,
  }) + '\\n');
});
`,
  );
  const reg = JSON.parse(regBytes.toString());
  reg.adapters.push({
    id: 'codex-short-reason-echo',
    label: 'C3 short reason detailed control',
    entrypoint: 'codex-recheck-controls/short-reason-echo.mjs',
    output_contract: 'raven-adapter-parsed/1',
    dependency_packages: [],
  });
  fs.writeFileSync(registryPath, JSON.stringify(reg, null, 2) + '\n');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c3det-'));
  try {
    const shortFix = path.join(dir, 'aa.b64');
    fs.writeFileSync(shortFix, 'AA==\n');
    const casePath = path.join(dir, 'c.json');
    const dReport = path.join(dir, 'detailed.json');
    assert.equal(runCli(['create', '--adapter', 'codex-short-reason-echo', '--name', 'aa', shortFix, casePath]).status, 0);
    assert.equal(runCli(['report', '--detailed', casePath, dReport]).status, 0);
    const d = JSON.parse(fs.readFileSync(dReport, 'utf8'));
    assert.match(String(d.limits.detailed_export), /OPT-IN|detailed/i);
    assert.equal(d.schema, 'raven-replay-adapter-case-report/1-detailed');
    assert.equal(d.results[0].actual_result.reason, 'AA==');
  } finally {
    fs.writeFileSync(registryPath, regBytes);
    fs.rmSync(controlsDir, { recursive: true, force: true });
  }
});


// ---------- C3PATH: structured path provenance (CODEX C3 pin-map remaining) ----------
test('C3PATH: unpinned bracket-key label[<decimal>] cannot reconstruct 215 bytes (REGRESSION path)', () => {
  const registryPath = path.join(root, 'adapters/registry.json');
  const regBytes = fs.readFileSync(registryPath);
  const controlsDir = path.join(root, 'adapters/c3path-controls');
  fs.mkdirSync(controlsDir, { recursive: true });
  fs.writeFileSync(
    path.join(controlsDir, 'bracket-key.mjs'),
    `let s = '';
process.stdin.on('data', (c) => { s += c; });
process.stdin.on('end', () => {
  const req = JSON.parse(s);
  const decimal = Array.from(Buffer.from(req.input_base64, 'base64'), (b) => String(b).padStart(3, '0')).join('');
  const decoded = {};
  decoded['label[' + decimal + ']'] = 1;
  process.stdout.write(JSON.stringify({
    decision: 'ACCEPT', version: null, reason: 'empty_input', decoded,
  }) + '\\n');
});
`,
  );
  const reg = JSON.parse(regBytes.toString());
  reg.adapters.push({
    id: 'c3path-bracket-key',
    label: 'C3PATH bracket-key decimal control',
    entrypoint: 'c3path-controls/bracket-key.mjs',
    output_contract: 'raven-adapter-parsed/1',
    dependency_packages: [],
  });
  fs.writeFileSync(registryPath, JSON.stringify(reg, null, 2) + '\n');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c3path-br-'));
  try {
    const casePath = path.join(dir, 'c.json');
    const reportPath = path.join(dir, 'report.json');
    const created = runCli(['create', '--adapter', 'c3path-bracket-key', '--name', 'br', fixture, casePath]);
    assert.equal(created.status, 0, created.stdout);
    const c = JSON.parse(fs.readFileSync(casePath, 'utf8'));
    const key = Object.keys(c.expected_execution.parsed.decoded)[0];
    assert.ok(key.startsWith('label['), 'fixture key must be label[<decimal>]');
    c.expected_execution.parsed.decoded[key] = 0;
    fs.writeFileSync(casePath, JSON.stringify(c, null, 2));
    const digest = caseDigest(c);
    const rerun = runCli(['rerun', '--expect-sha256', digest, casePath]);
    assert.equal(rerun.status, 1, 'expect REGRESSION');
    const reported = runCli(['report', casePath, reportPath]);
    assert.ok(reported.status === 0 || reported.status === 1, reported.stdout);
    assert.ok(fs.existsSync(reportPath));
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    assert.equal(report.limits.report_omits_reconstructible_wire, true);
    assert.equal(report.results[0].status, 'REGRESSION');
    const text = JSON.stringify(report);
    assert.ok(!/label\[\d+\]/.test(text), 'raw label[<digits>] must not appear in default report');
    const fields = (report.results[0].differences || []).map((d) => d.field);
    for (const f of fields) {
      assert.ok(!f.includes('label['), 'must not expose label[ prefix with payload: ' + f);
      assert.ok(!/\[\d{2,}\]/.test(f), 'must not expose multi-digit bracket payload: ' + f);
      assert.match(f, /field_[a-f0-9]{12}/, 'unpinned bracket key path must be digested: ' + f);
    }
    // Reconstruction attempt matching CODEX probe
    const m = text.match(/label\[(\d+)\]/);
    assert.equal(m, null, 'no label[<digits>] to reconstruct from');
    const names = report.results[0].actual_result.decoded.field_names;
    assert.ok(names.every((n) => /^field_[a-f0-9]{12}$/.test(n)));
  } finally {
    fs.writeFileSync(registryPath, regBytes);
    fs.rmSync(controlsDir, { recursive: true, force: true });
  }
});

test('C3PATH: version-compare bracket-key cannot reconstruct 215 bytes', () => {
  const registryPath = path.join(root, 'adapters/registry.json');
  const regBytes = fs.readFileSync(registryPath);
  const controlsDir = path.join(root, 'adapters/c3path-controls');
  fs.mkdirSync(controlsDir, { recursive: true });
  fs.writeFileSync(
    path.join(controlsDir, 'bracket-key.mjs'),
    `let s = '';
process.stdin.on('data', (c) => { s += c; });
process.stdin.on('end', () => {
  const req = JSON.parse(s);
  const decimal = Array.from(Buffer.from(req.input_base64, 'base64'), (b) => String(b).padStart(3, '0')).join('');
  const decoded = {};
  decoded['label[' + decimal + ']'] = 1;
  process.stdout.write(JSON.stringify({
    decision: 'ACCEPT', version: null, reason: 'empty_input', decoded,
  }) + '\\n');
});
`,
  );
  fs.writeFileSync(
    path.join(controlsDir, 'safe-label.mjs'),
    `let s = '';
process.stdin.on('data', (c) => { s += c; });
process.stdin.on('end', () => {
  process.stdout.write(JSON.stringify({
    decision: 'ACCEPT', version: null, reason: 'empty_input', decoded: { label: 1 },
  }) + '\\n');
});
`,
  );
  const reg = JSON.parse(regBytes.toString());
  reg.adapters.push(
    {
      id: 'c3path-bracket-key',
      label: 'C3PATH bracket-key',
      entrypoint: 'c3path-controls/bracket-key.mjs',
      output_contract: 'raven-adapter-parsed/1',
      dependency_packages: [],
    },
    {
      id: 'c3path-safe-label',
      label: 'C3PATH safe label',
      entrypoint: 'c3path-controls/safe-label.mjs',
      output_contract: 'raven-adapter-parsed/1',
      dependency_packages: [],
    },
  );
  fs.writeFileSync(registryPath, JSON.stringify(reg, null, 2) + '\n');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c3path-vc-'));
  try {
    const casePath = path.join(dir, 'safe.json');
    const cmpPath = path.join(dir, 'cmp.json');
    const created = runCli(['create', '--adapter', 'c3path-safe-label', '--name', 'safe', fixture, casePath]);
    assert.equal(created.status, 0, created.stdout);
    const dig = JSON.parse(created.stdout).case_content_sha256;
    const cmp = runCli([
      'compare-versions', '--baseline-case', casePath, '--expect-sha256', dig,
      '--candidate', 'c3path-bracket-key', cmpPath,
    ]);
    assert.equal(cmp.status, 0, cmp.stdout);
    const comparison = JSON.parse(fs.readFileSync(cmpPath, 'utf8'));
    assert.equal(comparison.status, 'COMPLETE');
    const text = JSON.stringify(comparison);
    assert.ok(!/label\[\d+\]/.test(text), 'version comparison must not expose label[<digits>]');
    assert.equal(text.match(/label\[(\d+)\]/), null);
    for (const d of comparison.differences || []) {
      assert.ok(!d.field.includes('label['), 'diff field sanitized: ' + d.field);
      assert.ok(!/\[\d{3,}\]/.test(d.field), 'no long decimal index leak: ' + d.field);
    }
  } finally {
    fs.writeFileSync(registryPath, regBytes);
    fs.rmSync(controlsDir, { recursive: true, force: true });
  }
});

test('C3PATH: pinned-prefix / pure-bracket / dotted literal keys digested; real array [n] readable', () => {
  // Structured differences: literal keys never become indexes; real arrays do.
  const raw = differences(
    {
      complete: true, exit_code: 0, signal: null, error_code: null,
      stdin_sha256: 'a'.repeat(64), protocol_ok: true,
      parsed: {
        decision: 'ACCEPT', version: null, reason: 'empty_input',
        decoded: {
          'label[0]': 1,          // pinned-prefix + brackets as literal key
          '[0]': 2,               // pure bracket key
          '[123456789]': 3,       // pure long-bracket key
          'a.b': 4,               // dotted literal key
          signatures: [10, 20],   // real array (pinned name)
        },
      },
    },
    {
      complete: true, exit_code: 0, signal: null, error_code: null,
      stdin_sha256: 'a'.repeat(64), protocol_ok: true,
      parsed: {
        decision: 'ACCEPT', version: null, reason: 'empty_input',
        decoded: {
          'label[0]': 9,
          '[0]': 8,
          '[123456789]': 7,
          'a.b': 6,
          signatures: [10, 99],
        },
      },
    },
  );
  const safe = summarizeDifferences(raw);
  const fields = safe.map((d) => d.field);
  // No literal bracket / dotted payload in default fields
  assert.ok(fields.every((f) => !f.includes('label[')), fields.join(' | '));
  assert.ok(fields.every((f) => !f.includes('[123456789]')), fields.join(' | '));
  assert.ok(fields.every((f) => !f.includes('a.b')), fields.join(' | '));
  // Pure "[0]" as object key must not appear as a readable lone [0] path segment from key provenance.
  // Real array index on items must remain readable.
  const arrayHit = fields.find((f) => f.includes('signatures[1]'));
  assert.ok(arrayHit, 'real array traversal must show signatures[1]: ' + fields.join(' | '));
  assert.equal(arrayHit, 'execution.parsed.decoded.signatures[1]');
  // Each unpinned complete key → field_<sha12>
  const keyDiffs = fields.filter((f) => !f.includes('signatures['));
  assert.ok(keyDiffs.length >= 4, 'expect diffs for the four literal keys');
  for (const f of keyDiffs) {
    assert.match(f, /^execution\.parsed\.decoded\.field_[a-f0-9]{12}$/, f);
  }
  // Direct renderSafeFieldPath unit: index-only from kind===index
  assert.equal(
    renderSafeFieldPath([
      { kind: 'root', name: 'execution' },
      { kind: 'key', name: 'parsed' },
      { kind: 'key', name: 'decoded' },
      { kind: 'key', name: 'signatures' },
      { kind: 'index', index: 0 },
    ]),
    'execution.parsed.decoded.signatures[0]',
  );
  // Flat-string fallback must NOT peel brackets into indexes
  assert.ok(summarizeFieldPath('execution.parsed.decoded.label[0]').includes('field_'));
  assert.ok(!summarizeFieldPath('execution.parsed.decoded.[0]').endsWith('[0]') ||
    summarizeFieldPath('execution.parsed.decoded.[0]').includes('field_'));
  const pure = summarizeFieldPath('[0]');
  assert.match(pure, /^field_[a-f0-9]{12}$/);
});

test('C3PATH: incomplete comparison still digests short reason (prior CLOSED)', () => {
  const registryPath = path.join(root, 'adapters/registry.json');
  const regBytes = fs.readFileSync(registryPath);
  const controlsDir = path.join(root, 'adapters/c3path-controls');
  fs.mkdirSync(controlsDir, { recursive: true });
  fs.writeFileSync(
    path.join(controlsDir, 'short-reason.mjs'),
    `let s = '';
process.stdin.on('data', (c) => { s += c; });
process.stdin.on('end', () => {
  const req = JSON.parse(s);
  process.stdout.write(JSON.stringify({
    decision: 'REJECT', version: null, reason: req.input_base64, decoded: null,
  }) + '\\n');
});
`,
  );
  fs.writeFileSync(
    path.join(controlsDir, 'crash.mjs'),
    `throw new Error('controlled crash');\n`,
  );
  const reg = JSON.parse(regBytes.toString());
  reg.adapters.push(
    {
      id: 'c3path-short-reason',
      label: 'C3PATH short reason',
      entrypoint: 'c3path-controls/short-reason.mjs',
      output_contract: 'raven-adapter-parsed/1',
      dependency_packages: [],
    },
    {
      id: 'c3path-crash',
      label: 'C3PATH crash',
      entrypoint: 'c3path-controls/crash.mjs',
      output_contract: 'raven-adapter-parsed/1',
      dependency_packages: [],
    },
  );
  fs.writeFileSync(registryPath, JSON.stringify(reg, null, 2) + '\n');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c3path-inc-'));
  try {
    const shortFix = path.join(dir, 'aa.b64');
    fs.writeFileSync(shortFix, 'AA==\n');
    const casePath = path.join(dir, 'c.json');
    const incomplete = path.join(dir, 'incomplete.json');
    const created = runCli(['create', '--adapter', 'c3path-short-reason', '--name', 'aa', shortFix, casePath]);
    assert.equal(created.status, 0, created.stdout);
    const dig = JSON.parse(created.stdout).case_content_sha256;
    runCli([
      'compare-versions', '--baseline-case', casePath, '--expect-sha256', dig,
      '--candidate', 'c3path-crash', incomplete,
    ]);
    const ic = JSON.parse(fs.readFileSync(incomplete, 'utf8'));
    assert.equal(JSON.stringify(ic).includes('AA=='), false);
    assert.equal(ic.status, 'INCOMPLETE');
  } finally {
    fs.writeFileSync(registryPath, regBytes);
    fs.rmSync(controlsDir, { recursive: true, force: true });
  }
});
