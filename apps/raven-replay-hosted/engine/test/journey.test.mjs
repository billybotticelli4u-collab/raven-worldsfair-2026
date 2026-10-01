import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const node = process.execPath;
const cli = path.join(root, 'src', 'cli.mjs');
const fixture = path.join(root, 'fixtures', 'legacy-transaction.base64');
const fixtureV0 = path.join(root, 'fixtures', 'v0-transaction.base64');

function run(args, opts = {}) {
  return spawnSync(node, [cli, ...args], {
    encoding: 'utf8',
    cwd: root,
    ...opts,
  });
}

test('runtime is exactly v22.18.0 for green milestone demos', () => {
  assert.equal(process.version, 'v22.18.0');
});

test('fresh journey: create → export → import → rerun MATCH → report', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'raven-sdk-journey-'));
  const casePath = path.join(dir, 'case.json');
  const exportDir = path.join(dir, 'export');
  const importPath = path.join(dir, 'imported.json');
  const reportPath = path.join(dir, 'report.json');

  const created = run(['create', '--adapter', 'solana-kit-tx-decode', '--name', 'kit-legacy-1', fixture, casePath]);
  assert.equal(created.status, 0, created.stderr + created.stdout);
  const createdJson = JSON.parse(created.stdout);
  assert.equal(createdJson.status, 'CREATED');
  assert.equal(createdJson.expected_result.decision, 'ACCEPT');
  assert.equal(createdJson.expected_result.version, 'legacy');
  const dig = createdJson.case_content_sha256;

  const exported = run(['export', casePath, exportDir]);
  assert.equal(exported.status, 0, exported.stderr + exported.stdout);
  assert.equal(fs.readFileSync(path.join(exportDir, 'REFERENCE.sha256'), 'utf8').trim(), dig);
  assert.match(fs.readFileSync(path.join(exportDir, 'LABEL.txt'), 'utf8'), /contains_raw_input=YES/);

  const imported = run(['import', exportDir, importPath]);
  assert.equal(imported.status, 0, imported.stderr + imported.stdout);
  assert.equal(JSON.parse(imported.stdout).reference, 'MATCH');

  const rerun = run(['rerun', '--expect-sha256', dig, importPath]);
  assert.equal(rerun.status, 0, rerun.stderr + rerun.stdout);
  const rerunJson = JSON.parse(rerun.stdout);
  assert.equal(rerunJson.exit_code, 0);
  assert.equal(rerunJson.results[0].status, 'MATCH');

  const report = run(['report', '--expect-sha256', dig, importPath, reportPath]);
  assert.equal(report.status, 0, report.stderr + report.stdout);
  const reportBody = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  assert.equal(reportBody.exit_code, 0);
  assert.equal(reportBody.counts.MATCH, 1);
  assert.equal(reportBody.limits.report_omits_raw_input, true);
  assert.equal(reportBody.limits.report_omits_reconstructible_wire, true);
  assert.ok(!JSON.stringify(reportBody).includes(fs.readFileSync(fixture, 'utf8').trim()));
  // No reconstructible wire.messageBytes / signatures payloads in default report
  assert.ok(!JSON.stringify(reportBody).includes('messageBytes'));
  assert.ok(!JSON.stringify(reportBody).includes('signatures'));
});

test('supported v0 fixture ACCEPT + MATCH', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'raven-sdk-v0-'));
  const casePath = path.join(dir, 'case.json');
  const created = run(['create', '--adapter', 'solana-kit-tx-decode', '--name', 'kit-v0-1', fixtureV0, casePath]);
  assert.equal(created.status, 0, created.stderr + created.stdout);
  const j = JSON.parse(created.stdout);
  assert.equal(j.expected_result.decision, 'ACCEPT');
  assert.equal(j.expected_result.version, 0);
  const rerun = run(['rerun', casePath]);
  assert.equal(rerun.status, 0, rerun.stderr + rerun.stdout);
  assert.equal(JSON.parse(rerun.stdout).results[0].status, 'MATCH');
});

test('expected refusal MATCH for truncated input', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'raven-sdk-refuse-'));
  const truncated = path.join(dir, 't.base64');
  fs.writeFileSync(truncated, 'AA==\n');
  const casePath = path.join(dir, 'case.json');
  const created = run(['create', '--adapter', 'solana-kit-tx-decode', '--name', 'kit-trunc', truncated, casePath]);
  assert.equal(created.status, 0, created.stderr + created.stdout);
  const j = JSON.parse(created.stdout);
  assert.equal(j.expected_result.decision, 'REJECT');
  const rerun = run(['rerun', casePath]);
  assert.equal(rerun.status, 0, rerun.stderr + rerun.stdout);
  assert.equal(JSON.parse(rerun.stdout).results[0].status, 'MATCH');
});

test('crash / hang / excess / bad protocol cannot MATCH as refusal', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'raven-sdk-fail-'));
  const input = path.join(dir, 'in.base64');
  fs.writeFileSync(input, fs.readFileSync(fixture));

  for (const adapter of ['control-crash', 'control-hang', 'control-excess', 'control-bad-protocol']) {
    const casePath = path.join(dir, adapter + '.json');
    const created = run(['create', '--adapter', adapter, '--name', adapter, input, casePath], {
      timeout: 20000,
    });
    assert.notEqual(created.status, 0, 'create must refuse incomplete for ' + adapter);
    const body = JSON.parse(created.stdout);
    assert.equal(body.status, 'RUN_ERROR');
  }
});

test('unknown adapter refused; case cannot name packages', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'raven-sdk-unk-'));
  const casePath = path.join(dir, 'c.json');
  const r = run(['create', '--adapter', 'no-such-adapter', '--name', 'x', fixture, casePath]);
  assert.equal(r.status, 2);
  assert.match(r.stdout, /Unknown adapter|INVALID_CASE/i);
});

test('extension: example-parser-v1 without engine edit', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'raven-sdk-ext-'));
  const casePath = path.join(dir, 'c.json');
  const r = run(['create', '--adapter', 'example-parser-v1', '--name', 'ex1', fixture, casePath]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const rerun = run(['rerun', casePath]);
  assert.equal(rerun.status, 0);
  assert.equal(JSON.parse(rerun.stdout).results[0].status, 'MATCH');
});

test('version comparison against saved baseline detects label change; baseline intact', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'raven-sdk-cmp-'));
  const baseCase = path.join(dir, 'base.json');
  const out = path.join(dir, 'cmp.json');
  const created = run(['create', '--adapter', 'example-parser-v1', '--name', 'base-v1', fixture, baseCase]);
  assert.equal(created.status, 0, created.stderr + created.stdout);
  const dig = JSON.parse(created.stdout).case_content_sha256;
  const r = run([
    'compare-versions',
    '--baseline-case', baseCase,
    '--expect-sha256', dig,
    '--candidate', 'example-parser-v2',
    '--label', 'controlled-label-change',
    out,
  ]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const summary = JSON.parse(r.stdout);
  assert.equal(summary.changed, true);
  assert.equal(summary.comparison_complete, true);
  assert.ok(summary.difference_fields.some((f) => f.includes('label')));
  const body = JSON.parse(fs.readFileSync(out, 'utf8'));
  // Default comparison must NOT embed full baseline parsed (C3); case file stays intact.
  assert.equal(body.baseline.result_full_from_saved_baseline, null);
  assert.equal(body.baseline.detailed_export, false);
  assert.equal(body.baseline.result.decision, 'ACCEPT');
  assert.ok(body.baseline.result.decoded && body.baseline.result.decoded.field_digests);
  assert.equal(body.baseline.adapter_id, 'example-parser-v1');
  assert.match(String(body.baseline.note || body.baseline.note_default || ''), /baseline|digest|omit/i);
  // Explicit detailed opt-in restores labelled full baseline payload.
  const outD = path.join(dir, 'cmp-detailed.json');
  const rD = run([
    'compare-versions',
    '--baseline-case', baseCase,
    '--expect-sha256', dig,
    '--candidate', 'example-parser-v2',
    '--label', 'controlled-label-change-detailed',
    '--detailed',
    outD,
  ]);
  assert.equal(rD.status, 0, rD.stderr + rD.stdout);
  const bodyD = JSON.parse(fs.readFileSync(outD, 'utf8'));
  assert.equal(bodyD.baseline.detailed_export, true);
  assert.equal(bodyD.baseline.result_full_from_saved_baseline.decoded.label, 'baseline');
});

test('binding: altered adapter source → RUN_ERROR on rerun', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'raven-sdk-bind-'));
  const casePath = path.join(dir, 'c.json');
  const created = run(['create', '--adapter', 'example-parser-v1', '--name', 'bind1', fixture, casePath]);
  assert.equal(created.status, 0);
  const c = JSON.parse(fs.readFileSync(casePath, 'utf8'));
  c.bindings.adapter_source_sha256 = 'a'.repeat(64);
  const tampered = path.join(dir, 'tampered.json');
  fs.writeFileSync(tampered, JSON.stringify(c, null, 2));
  const rerun = run(['rerun', tampered]);
  assert.equal(rerun.status, 3);
  assert.equal(JSON.parse(rerun.stdout).results[0].status, 'RUN_ERROR');
  assert.match(JSON.parse(rerun.stdout).results[0].error, /Adapter source bytes differ/);
});

test('repeatability: two reruns agree', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'raven-sdk-rep-'));
  const casePath = path.join(dir, 'c.json');
  assert.equal(run(['create', '--adapter', 'solana-kit-tx-decode', '--name', 'rep', fixture, casePath]).status, 0);
  const a = JSON.parse(run(['rerun', casePath]).stdout);
  const b = JSON.parse(run(['rerun', casePath]).stdout);
  assert.deepEqual(a.results[0].actual_result, b.results[0].actual_result);
  assert.equal(a.results[0].status, 'MATCH');
  assert.equal(b.results[0].status, 'MATCH');
});
