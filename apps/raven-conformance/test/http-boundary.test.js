import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cpSync, mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Real HTTP routes and real demo runner, confined to a disposable app copy.
const app = fileURLToPath(new URL('..', import.meta.url));
let dir, child, port;
before(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'raven-http-'));
  for (const name of ['src', 'targets', 'profiles', 'corpus', 'examples', 'public', 'interface', 'package.json']) {
    cpSync(path.join(app, name), path.join(dir, name), { recursive: true });
  }
  mkdirSync(path.join(dir, 'reports'));
  mkdirSync(path.join(dir, 'examples-neighbor'));
  writeFileSync(path.join(dir, 'examples-neighbor/canary.json'), JSON.stringify({ outside_canary: true }));
  symlinkSync(path.join(dir, 'examples-neighbor/canary.json'), path.join(dir, 'examples/sample-report-ESCAPE.json'));
  symlinkSync(path.join(dir, 'examples-neighbor/canary.json'), path.join(dir, 'reports/run_escape.json'));
  const reservation = net.createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  child = spawn(process.execPath, ['src/server.js'], {
    cwd: dir, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stderr.on('data', data => { output += data; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start: ${output}`)), 8000);
    child.once('error', reject);
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`server exited ${code}: ${output}`)); });
    child.stdout.on('data', data => {
      output += data;
      if (output.includes('listening on')) { clearTimeout(timer); resolve(); }
    });
  });
});
after(async () => {
  if (child && child.exitCode === null) { child.kill(); await once(child, 'exit'); }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function request(route, { method = 'GET', raw, json, chunked = false } = {}) {
  const body = raw ?? (json === undefined ? undefined : JSON.stringify(json));
  return new Promise((resolve, reject) => {
    const headers = body === undefined ? {} : { 'content-type': 'application/json' };
    if (body !== undefined && !chunked) headers['content-length'] = Buffer.byteLength(body);
    const req = http.request({ host: '127.0.0.1', port, path: route, method, headers, agent: false }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', data => { text += data; });
      res.on('end', () => {
        let value; try { value = JSON.parse(text); } catch { value = text; }
        resolve({ status: res.statusCode, body: value, headers: res.headers });
      });
    });
    req.setTimeout(20000, () => req.destroy(new Error('HTTP test deadline')));
    req.on('error', reject);
    if (body !== undefined) {
      if (chunked) { for (let i = 0; i < body.length; i += 8192) req.write(body.slice(i, i + 8192)); }
      else req.write(body);
    }
    req.end();
  });
}

test('health and malformed JSON controls', async () => {
  assert.equal((await request('/api/health')).body.ok, true);
  const r = await request('/api/run', { method: 'POST', raw: '{' });
  assert.equal(r.status, 400); assert.equal(r.body.error, 'invalid_json');
});
for (const json of [null, [], 'target', 42]) test(`non-object request ${JSON.stringify(json)} is a client error`, async () => {
  for (const route of ['/api/run', '/api/replay']) {
    const r = await request(route, { method: 'POST', json });
    assert.equal(r.status, 400); assert.equal(r.body.error, 'invalid_request');
  }
});
for (const chunked of [false, true]) test(`body limit rejects ${chunked ? 'chunked' : 'declared'} oversized upload`, async () => {
  const r = await request('/api/run', { method: 'POST', chunked, raw: JSON.stringify({ target: 'unknown', pad: 'x'.repeat(65536) }) });
  assert.equal(r.status, 413); assert.equal(r.body.error, 'request_too_large');
  assert.equal((await request('/api/health')).body.ok, true);
});
test('exact body limit remains a normal request', async () => {
  const raw = JSON.stringify({ target: 'unknown' }).padEnd(65536, ' ');
  const r = await request('/api/run', { method: 'POST', raw });
  assert.equal(r.status, 400); assert.equal(r.body.error, 'unknown_target');
});
test('unfinished upload expires while the server stays responsive', async () => {
  const start = Date.now();
  const pending = new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/api/run', method: 'POST', agent: false }, res => {
      let body = ''; res.on('data', data => { body += data; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    });
    req.setTimeout(8000, () => req.destroy(new Error('upload was not expired')));
    req.on('error', reject); req.write('{'); // Deliberately never send EOF.
  });
  assert.equal((await request('/api/health')).body.ok, true);
  const r = await pending;
  assert.equal(r.status, 408); assert.equal(r.body.error, 'request_timeout');
  assert.ok(Date.now() - start < 7500);
  assert.equal((await request('/api/health')).body.active_run, null);
});
for (const timeout_ms of ['3000', -1, 0, 99, 1.5, 10001, null]) test(`invalid HTTP timeout ${timeout_ms} does not start work`, async () => {
  const r = await request('/api/run', { method: 'POST', json: { target: 'CONFORMANT_REFERENCE', timeout_ms } });
  assert.equal(r.status, 400); assert.equal(r.body.error, 'invalid_timeout');
});
test('run ID traversal is rejected before execution or report writes', async () => {
  const before = readdirSync(dir);
  const r = await request('/api/run', { method: 'POST', json: { target: 'CONFORMANT_REFERENCE', run_id: '../outside' } });
  assert.equal(r.status, 400); assert.equal(r.body.error, 'invalid_run_id');
  assert.deepEqual(readdirSync(dir), before);
});
test('recorded IDs cannot escape into a similarly prefixed directory or symlink', async () => {
  for (const id of ['x%2F..%2F..%2Fexamples-neighbor%2Fcanary', 'ESCAPE', '%ZZ']) {
    const r = await request(`/api/recorded/${id}`);
    assert.ok([400, 404].includes(r.status), JSON.stringify(r));
    assert.equal(JSON.stringify(r.body).includes('outside_canary'), false);
  }
});
test('saved report symlink cannot expose another file', async () => {
  const r = await request('/api/report/run_escape');
  assert.equal(r.status, 404); assert.equal(JSON.stringify(r.body).includes('outside_canary'), false);
});
test('HTTP replay rejects files outside report/example roots, including symlinks', async () => {
  for (const report_path of ['examples-neighbor/canary.json', path.join(dir, 'examples-neighbor/canary.json'), 'reports/run_escape.json']) {
    const r = await request('/api/replay', { method: 'POST', json: { report_path } });
    assert.equal(r.status, 400); assert.equal(r.body.error, 'invalid_report_path');
  }
});
test('one execution lock covers SSE, probes and replay', async () => {
  const stream = http.get({ host: '127.0.0.1', port, path: '/api/run-stream?target=CONFORMANT_REFERENCE', agent: false });
  const ended = new Promise((resolve, reject) => { stream.once('error', reject); stream.once('response', res => { res.resume(); res.once('end', resolve); }); });
  for (let i = 0; i < 100; i++) {
    if ((await request('/api/health')).body.active_run) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.ok((await request('/api/health')).body.active_run);
  try {
    assert.equal((await request('/api/run-probes', { method: 'POST' })).status, 409);
    assert.equal((await request('/api/replay', { method: 'POST', json: { report_path: 'examples/sample-report-BROKEN_SUBTLE.json' } })).status, 409);
  } finally { await ended; }
  assert.equal((await request('/api/health')).body.active_run, null);
});
test('live reference/subtle runs, download and replay preserve exact decisions', async () => {
  const reference = await request('/api/run', { method: 'POST', json: { target: 'CONFORMANT_REFERENCE', run_id: 'run_httpcontrol', timeout_ms: 3000 } });
  assert.equal(reference.status, 200); assert.equal(reference.body.report.summary.overall, 'CONFORMANT');
  const total = reference.body.report.results.length;
  assert.ok(total > 0); assert.equal(reference.body.report.summary.pass, total);
  const download = await request('/api/report/run_httpcontrol');
  assert.equal(download.status, 200);
  assert.deepEqual(download.body.results, reference.body.report.results);
  const duplicate = await request('/api/run', { method: 'POST', json: { target: 'BROKEN_SUBTLE', run_id: 'run_httpcontrol' } });
  assert.equal(duplicate.status, 409); assert.equal(duplicate.body.error, 'run_id_exists');
  assert.deepEqual((await request('/api/report/run_httpcontrol')).body, download.body);
  const replay = await request('/api/replay', { method: 'POST', json: { report_path: 'reports/run_httpcontrol.json' } });
  assert.equal(replay.status, 200); assert.equal(replay.body.ok, true);
  const subtle = await request('/api/run', { method: 'POST', json: { target: 'BROKEN_SUBTLE' } });
  assert.equal(subtle.status, 200); assert.equal(subtle.body.report.summary.pass, total - 2);
  assert.deepEqual(subtle.body.report.results.filter(row => row.status === 'BEHAVIORAL_DIVERGENCE').map(row => row.vector_id), ['V07_unexpected_top_level_field', 'V08_unexpected_extension_key']);
});
test('failed replay releases the execution lock', async () => {
  writeFileSync(path.join(dir, 'reports/run_bad.json'), '{');
  const r = await request('/api/replay', { method: 'POST', json: { report_path: 'reports/run_bad.json' } });
  assert.equal(r.status, 500);
  assert.equal((await request('/api/health')).body.active_run, null);
});
