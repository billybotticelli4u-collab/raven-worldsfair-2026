import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import net from 'node:net';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeDeterministicDigest, loadProbeTargets } from '../src/lib/runner.js';
import { sha256Hex } from '../src/lib/digest.js';

const app = fileURLToPath(new URL('..', import.meta.url));
const servers = [];
const reports = [];
let root;

function request(server, route, json, chunked = false) {
  const body = json === undefined ? undefined : JSON.stringify(json);
  return new Promise((resolve, reject) => {
    const headers = body === undefined ? {} : { 'content-type': 'application/json' };
    if (body !== undefined && !chunked) headers['content-length'] = Buffer.byteLength(body);
    const req = http.request({ host: '127.0.0.1', port: server.port, path: route,
      method: body === undefined ? 'GET' : 'POST', headers, agent: false }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', data => { text += data; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('HTTP deadline')));
    if (chunked) {
      for (let i = 0; i < body.length; i += 4096) req.write(body.slice(i, i + 4096));
      req.end();
    } else req.end(body);
  });
}

before(async () => {
  root = mkdtempSync(path.join(os.tmpdir(), 'raven replay instances with spaces '));
  for (const name of ['producer', 'fresh-instance']) {
    const dir = path.join(root, name);
    mkdirSync(dir);
    for (const item of ['src', 'targets', 'profiles', 'corpus', 'examples', 'public', 'interface', 'package.json']) {
      cpSync(path.join(app, item), path.join(dir, item), { recursive: true });
    }
    mkdirSync(path.join(dir, 'reports'));
    const reservation = net.createServer().listen(0, '127.0.0.1');
    await once(reservation, 'listening');
    const port = reservation.address().port;
    await new Promise(resolve => reservation.close(resolve));
    const env = { ...process.env, HOST: '127.0.0.1', PORT: String(port), NODE_ENV: 'development' };
    delete env.VERCEL;
    const child = spawn(process.execPath, ['src/server.js'], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
    servers.push({ child, port, dir });
    let output = '';
    child.stderr.on('data', data => { output += data; });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Startup deadline: ${output}`)), 8000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${output}`)); });
      child.stdout.on('data', data => {
        output += data;
        if (output.includes('listening on')) { clearTimeout(timer); resolve(); }
      });
    });
  }
  for (const [profile, target] of [['raven-canonical-envelope/1', 'CONFORMANT_REFERENCE'], ['solana', 'SOL_CONFORMANT_REFERENCE'], ['solana', 'SOL_BROKEN_SUBTLE']]) {
    const result = await request(servers[0], '/api/run', { profile, target });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    reports.push(result.body);
  }
});

after(async () => {
  for (const { child } of servers) {
    if (child.exitCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
      await exited;
      clearTimeout(timer);
    }
  }
  if (root) rmSync(root, { recursive: true, force: true });
});

// The adversary can recompute self-hashes; semantic re-execution must still disagree.
function rehash(report) {
  report.binding.deterministic_report_sha256 = computeDeterministicDigest(report);
  report.deterministic_report_sha256 = report.binding.deterministic_report_sha256;
  const { _written_path, report_content_digest_sha256, deterministic_report_sha256, ...body } = report;
  report.report_content_digest_sha256 = sha256Hex(JSON.stringify(body, null, 2) + '\n');
  return report;
}

test('reports replay on a separate instance with no report files: envelope, Solana reference and subtle', async () => {
  const fresh = servers[1];
  assert.deepEqual(readdirSync(path.join(fresh.dir, 'reports')), []);
  for (const { report, written_path } of reports) {
    const missing = await request(fresh, '/api/replay', { report_path: written_path });
    assert.equal(missing.status, 400);
    assert.equal(missing.body.error, 'invalid_report_path');
    assert.ok(Buffer.byteLength(JSON.stringify({ report })) <= 65536);
    const replay = await request(fresh, '/api/replay', { report });
    assert.equal(replay.status, 200, JSON.stringify(replay.body));
    assert.equal(replay.body.ok, true);
    assert.equal(replay.body.bundle_match, true);
    assert.equal(replay.body.semantic_match, true);
    assert.equal(replay.body.attestation, false);
    assert.equal(replay.body.original_overall, report.summary.overall);
  }
  assert.deepEqual(readdirSync(path.join(fresh.dir, 'reports')), []);
});

test('path replay stays compatible on the producer', async () => {
  const replay = await request(servers[0], '/api/replay', { report_path: reports[1].written_path });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.ok, true);
});

test('modified report with old digests is refused, and the execution lock is released', async () => {
  const report = structuredClone(reports[1].report);
  report.results[0].observed.decision = 'FORGED';
  const replay = await request(servers[1], '/api/replay', { report });
  assert.equal(replay.status, 409);
  assert.equal(replay.body.error, 'report_integrity_mismatch');
  assert.equal((await request(servers[1], '/api/health')).body.active_run, null);
});

test('recomputed self-hashes cannot hide changed outcomes', async () => {
  const report = structuredClone(reports[1].report);
  report.results[0].observed.decision = 'FORGED';
  const replay = await request(servers[1], '/api/replay', { report: rehash(report) });
  assert.equal(replay.status, 409);
  assert.equal(replay.body.bundle_match, true);
  assert.equal(replay.body.semantic_match, false);
  assert.equal(replay.body.ok, false);
});

test('recomputed self-hashes cannot change corpus, profile or target entry bindings', async () => {
  for (const mutate of [
    r => { r.corpus.sha256 = '0'.repeat(64); },
    r => { r.claimed_profile.version = 'forged'; },
    r => { r.target.entry = '../../outside.mjs'; },
  ]) {
    const report = structuredClone(reports[1].report); mutate(report);
    const replay = await request(servers[1], '/api/replay', { report: rehash(report) });
    assert.equal(replay.status, 409);
    assert.equal(replay.body.error, 'bundle_identity_mismatch');
    assert.equal(replay.body.bundle_match, false);
  }
});

test('HTTP object replay cannot select unknown or probe targets, or an unknown profile', async () => {
  for (const target of ['../../outside', loadProbeTargets()[0].id]) {
    const report = structuredClone(reports[0].report); report.target.id = target;
    const replay = await request(servers[1], '/api/replay', { report: rehash(report) });
    assert.equal(replay.status, 400);
    assert.equal(replay.body.error, 'unknown_target');
  }
  const report = structuredClone(reports[1].report); report.claimed_profile.name = 'unknown';
  const replay = await request(servers[1], '/api/replay', { report: rehash(report) });
  assert.equal(replay.status, 400);
  assert.equal(replay.body.error, 'unknown_profile');
  assert.equal((await request(servers[1], '/api/health')).body.active_run, null);
});

test('ambiguous replay selectors and malformed report objects are client errors', async () => {
  for (const report of [null, [], 'text', 42]) {
    const replay = await request(servers[1], '/api/replay', { report });
    assert.equal(replay.status, 400);
    assert.equal(replay.body.error, 'invalid_report');
  }
  const both = await request(servers[0], '/api/replay', { report: reports[1].report, report_path: reports[1].written_path });
  assert.equal(both.status, 400);
  assert.equal(both.body.error, 'ambiguous_report');
});

test('object replay retains the HTTP body cap for declared and chunked uploads', async () => {
  for (const chunked of [false, true]) {
    const replay = await request(servers[1], '/api/replay', { report: { padding: 'x'.repeat(65536) } }, chunked);
    assert.equal(replay.status, 413);
    assert.equal(replay.body.error, 'request_too_large');
  }
});

test('object replay shares the execution lock and leaves no persistent report', async () => {
  const pending = request(servers[1], '/api/replay', { report: reports[1].report });
  for (let i = 0; i < 100; i++) {
    if ((await request(servers[1], '/api/health')).body.active_run) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  try {
    assert.ok((await request(servers[1], '/api/health')).body.active_run);
    const competing = await request(servers[1], '/api/replay', { report: reports[1].report });
    assert.equal(competing.status, 409);
    assert.equal(competing.body.error, 'run_in_progress');
  } finally {
    const completed = await pending;
    assert.equal(completed.status, 200);
  }
  assert.equal((await request(servers[1], '/api/health')).body.active_run, null);
  assert.deepEqual(readdirSync(path.join(servers[1].dir, 'reports')), []);
});

test('browser replay sends the held report, never a server-local path', () => {
  const source = readFileSync(path.join(app, 'public/app.js'), 'utf8');
  assert.match(source, /JSON\.stringify\(\{ report: lastReport \}\)/);
  assert.doesNotMatch(source, /report_path: lastReportPath/);
});
