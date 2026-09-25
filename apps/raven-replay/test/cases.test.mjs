import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import childProcess, { spawnSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createCase, runCase, runCases, parseCase, caseDigest } from '../src/cases.mjs';
import { main } from '../src/cases-cli.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
const tx = fs.readFileSync(new URL('../examples/legacy-transaction.base64', import.meta.url), 'utf8').trim();
const good = createCase(tx, { name: 'legacy-accept' });
const refusal = createCase('AA==', { name: 'truncated-reject' });
const copy = x => structuredClone(x);

test('saved result reruns with retained reference, explicit claims and reproducible report', () => {
  const a = runCases([good.case], { expectedCaseSha256s: [good.case_content_sha256] });
  assert.equal(a.exit_code, 0); assert.equal(a.results[0].reference, 'MATCH');
  assert.equal(a.results[0].actual_result.decision, 'ACCEPT');
  assert.equal(a.limits.caller_identity, 'NOT_ESTABLISHED');
  assert.deepEqual(a, runCases([good.case], { expectedCaseSha256s: [good.case_content_sha256] }));
});

test('expected parser rejection is a matching complete execution, not an execution error or safety verdict', () => {
  const r = runCases([good.case, refusal.case]);
  assert.equal(r.exit_code, 0); assert.equal(r.counts.MATCH, 2);
  assert.equal(r.results[1].actual_result.decision, 'REJECT');
  assert.equal(r.results[1].execution, 'COMPLETE');
  assert.equal(r.results[1].reference, 'NOT_PROVIDED');
});

function changedExpectation() {
  const c = copy(good.case);
  c.expected_execution.parsed.reason = 'different expected result';
  c.expected_execution.stdout_base64 = Buffer.from(JSON.stringify(c.expected_execution.parsed) + '\n').toString('base64');
  return c;
}

test('completed output mismatch gives regression with precise field paths', () => {
  const r = runCase(changedExpectation());
  assert.equal(r.exit_code, 1); assert.equal(r.status, 'REGRESSION');
  assert.ok(r.differences.some(d => d.field === 'execution.parsed.reason'));
  assert.ok(r.differences.some(d => d.field === 'execution.stdout_base64'));
});

test('raw stdout differences are detected even when parsed meaning is unchanged', () => {
  const c = copy(good.case);
  c.expected_execution.stdout_base64 = Buffer.from(JSON.stringify(c.expected_execution.parsed, null, 2)).toString('base64');
  const r = runCase(c);
  assert.equal(r.status, 'REGRESSION');
  assert.deepEqual(r.differences.map(d => d.field), ['execution.stdout_base64']);
});

test('modified baseline with retained reference is rejected before execution', () => {
  const r = runCase(changedExpectation(), { expectedCaseSha256: good.case_content_sha256 });
  assert.equal(r.status, 'INVALID_CASE'); assert.equal(r.reference, 'MISMATCH'); assert.equal(r.execution, 'NOT_RUN');
});

test('co-replacing case and its supplied reference is a documented limit; original reference detects it', () => {
  const replacement = copy(refusal.case); replacement.name = good.case.name;
  assert.equal(runCase(replacement, { expectedCaseSha256: caseDigest(replacement) }).status, 'MATCH');
  assert.equal(runCase(replacement, { expectedCaseSha256: good.case_content_sha256 }).status, 'INVALID_CASE');
});

test('incomplete baseline and inconsistent parsed/raw expected output are refused', () => {
  const c = copy(good.case); c.expected_execution.complete = false;
  assert.equal(runCase(c).status, 'INVALID_CASE');
  const other = copy(good.case); other.expected_execution.parsed.decision = 'REJECT';
  assert.equal(runCase(other).status, 'INVALID_CASE');
});

test('malformed reference, altered input or unrecognized execution policy cannot run', () => {
  for (const d of ['', '0'.repeat(63), 'g'.repeat(64)]) assert.equal(runCase(good.case, { expectedCaseSha256: d }).execution, 'NOT_RUN');
  for (const mutate of [c => { c.input_base64 = 'AA=='; }, c => { c.bindings.tool_sha256 = '0'.repeat(64); },
    c => { c.command = 'curl'; }, c => { c.bindings.runtime = 'v24.0.0'; }]) {
    const c = copy(good.case); mutate(c); assert.equal(runCase(c).status, 'INVALID_CASE');
  }
});

test('batch preserves invalid cases and gives nonzero aggregate without hiding successful cases', () => {
  const c = copy(refusal.case); c.input_sha256 = '0'.repeat(64);
  const r = runCases([good.case, c]);
  assert.equal(r.exit_code, 2); assert.equal(r.counts.MATCH, 1); assert.equal(r.counts.INVALID_CASE, 1);
  assert.throws(() => runCases([])); assert.throws(() => runCases([good.case, good.case]));
  assert.throws(() => runCases(Array(11).fill(good.case))); assert.throws(() => runCases([good.case], { expectedCaseSha256s: [] }));
});

test('malformed, oversized, unknown and incomplete cases fail closed', () => {
  for (const text of ['null', '{}', '[]', 'oops', ' '.repeat(128 * 1024 + 1)]) assert.throws(() => parseCase(text));
  for (const name of ['', '../case', '<script>', 'x'.repeat(65)]) assert.throws(() => createCase(tx, { name }));
  assert.throws(() => createCase('!@@!', { name: 'bad-input' }));
});

test('timeout/output-limit/failed subprocess injections become RUN_ERROR; cannot be saved as baselines', () => {
  const original = childProcess.spawnSync;
  try {
    for (const code of ['ETIMEDOUT', 'ENOBUFS', 'ENOENT']) {
      childProcess.spawnSync = () => ({ status: null, signal: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), error: { code } });
      syncBuiltinESMExports();
      const r = runCase(good.case);
      assert.equal(r.status, 'RUN_ERROR'); assert.equal(r.execution, 'INCOMPLETE'); assert.equal(r.exit_code, 3);
      assert.throws(() => createCase(tx, { name: 'incomplete' }), /Incomplete/);
    }
  } finally { childProcess.spawnSync = original; syncBuiltinESMExports(); }
});

test('runtime identity mismatch injection blocks execution with RUN_ERROR', () => {
  const original = Object.getOwnPropertyDescriptor(process, 'version');
  try {
    Object.defineProperty(process, 'version', { ...original, value: 'v24.0.0' });
    const r = runCase(good.case);
    assert.equal(r.status, 'RUN_ERROR'); assert.equal(r.execution, 'NOT_RUN');
    assert.throws(() => createCase(tx, { name: 'wrong-runtime' }), /Runtime mismatch/);
  } finally { Object.defineProperty(process, 'version', original); }
});

test('CLI saves with exclusive output, runs both outcomes and emits no raw input in reports', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'raven-cases-'));
  try {
    const input = path.join(tmp, 'input.base64'), output = path.join(tmp, 'case.json');
    fs.writeFileSync(input, tx);
    assert.equal(main(['save', input, output, 'cli-case']).exit_code, 0);
    const bytes = fs.readFileSync(output);
    assert.equal(main(['save', input, output, 'cli-case']).exit_code, 3);
    assert.deepEqual(bytes, fs.readFileSync(output));
    const r = main(['run', '--expect-sha256', caseDigest(parseCase(bytes.toString())), output]);
    assert.equal(r.exit_code, 0); assert.equal(JSON.stringify(r).includes(tx), false);
    const c = changedExpectation(); fs.writeFileSync(output, JSON.stringify(c));
    assert.equal(main(['run', output]).exit_code, 1);
    fs.writeFileSync(output, 'x'.repeat(128 * 1024 + 1));
    assert.equal(main(['run', output]).exit_code, 2);
    fs.writeFileSync(output, '{');
    assert.equal(main(['run', output]).exit_code, 2);
    assert.equal(main(['run', tmp]).exit_code, 2);
    assert.equal(main(['run', '--help', output]).exit_code, 2);
    const error = main(['run', path.join(tmp, 'absent')]);
    assert.equal(error.exit_code, 3); assert.equal(JSON.stringify(error).includes(tmp), false);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('CLI process has actual nonzero exit for regression, invalid input and changed local tool', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'raven-cases-process-'));
  try {
    fs.cpSync(path.join(root, 'src'), path.join(tmp, 'src'), { recursive: true });
    fs.cpSync(path.join(root, 'vendor'), path.join(tmp, 'vendor'), { recursive: true });
    const c = path.join(tmp, 'case.json'); fs.writeFileSync(c, JSON.stringify(changedExpectation()));
    const invoke = (...args) => spawnSync(process.execPath, [path.join(tmp, 'src/cases-cli.mjs'), ...args], { encoding: 'utf8' });
    const red = invoke('run', c); assert.equal(red.status, 1); assert.equal(JSON.parse(red.stdout).counts.REGRESSION, 1);
    fs.writeFileSync(c, '{}'); assert.equal(invoke('run', c).status, 2);
    fs.writeFileSync(c, JSON.stringify(good.case));
    fs.appendFileSync(path.join(tmp, 'vendor/solana-inspector.mjs'), '\n// altered\n');
    const bad = invoke('run', c); assert.equal(bad.status, 3); assert.equal(JSON.parse(bad.stdout).results[0].execution, 'NOT_RUN');
    fs.rmSync(path.join(tmp, 'vendor/solana-inspector.mjs'));
    assert.equal(invoke('run', c).status, 3);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
