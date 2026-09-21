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
test('profile discovery exposes envelope and Solana metadata with separate target families', async () => {
  const profiles = await request('/api/profiles');
  assert.equal(profiles.status, 200);
  assert.deepEqual(
    profiles.body.profiles.map(profile => profile.name),
    ['raven-canonical-envelope/1', 'raven-solana-txversion-experimental/0'],
  );

  const targets = await request('/api/targets?profile=solana');
  assert.equal(targets.status, 200);
  assert.equal(targets.body.profile, 'raven-solana-txversion-experimental/0');
  assert.deepEqual(
    targets.body.targets.map(target => target.id),
    ['SOL_CONFORMANT_REFERENCE', 'SOL_BROKEN_OBVIOUS', 'SOL_BROKEN_SUBTLE'],
  );

  const meta = await request('/api/meta?profile=solana');
  assert.equal(meta.status, 200);
  assert.equal(meta.body.profile.name, 'raven-solana-txversion-experimental/0');
  assert.equal(meta.body.corpus.id, 'raven-solana-txversion-demo-corpus/1.2');
  assert.equal(meta.body.corpus.vector_count, 12);
  assert.equal(meta.body.claim, 'The target matched this named experimental corpus.');
});
test('unknown profile selection fails closed before target execution', async () => {
  const meta = await request('/api/meta?profile=does-not-exist');
  assert.equal(meta.status, 400); assert.equal(meta.body.error, 'unknown_profile');
  const run = await request('/api/run', {
    method: 'POST',
    json: { profile: 'does-not-exist', target: 'SOL_CONFORMANT_REFERENCE' },
  });
  assert.equal(run.status, 400); assert.equal(run.body.error, 'unknown_profile');
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
test('Solana HTTP reference, broken target, report download and replay preserve profile binding', async () => {
  const reference = await request('/api/run', {
    method: 'POST',
    json: { profile: 'solana', target: 'SOL_CONFORMANT_REFERENCE', run_id: 'run_httpsolana' },
  });
  assert.equal(reference.status, 200);
  assert.equal(reference.body.report.claimed_profile.name, 'raven-solana-txversion-experimental/0');
  assert.equal(reference.body.report.summary.overall, 'CONFORMANT');
  assert.equal(reference.body.report.summary.pass, 12);
  assert.equal(reference.body.report.results.length, 12);

  const download = await request('/api/report/run_httpsolana');
  assert.equal(download.status, 200);
  assert.deepEqual(download.body.results, reference.body.report.results);
  const replay = await request('/api/replay', {
    method: 'POST',
    json: { report_path: 'reports/run_httpsolana.json' },
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.ok, true);
  assert.equal(replay.body.bundle_match, true);
  assert.equal(replay.body.semantic_match, true);

  const subtle = await request('/api/run', {
    method: 'POST',
    json: { profile: 'solana', target: 'SOL_BROKEN_SUBTLE' },
  });
  assert.equal(subtle.status, 200);
  assert.equal(subtle.body.report.summary.pass, 10);
  assert.deepEqual(
    subtle.body.report.results
      .filter(row => row.status === 'BEHAVIORAL_DIVERGENCE')
      .map(row => row.vector_id),
    ['V03_valid_v1', 'V16_valid_v1_two_instructions'],
  );
});
test('failed replay releases the execution lock', async () => {
  writeFileSync(path.join(dir, 'reports/run_bad.json'), '{');
  const r = await request('/api/replay', { method: 'POST', json: { report_path: 'reports/run_bad.json' } });
  assert.equal(r.status, 500);
  assert.equal((await request('/api/health')).body.active_run, null);
});

test('F1 rejected streaming upload closes the socket before the sender finishes', async (t) => {
  const socket = net.createConnection({ host: '127.0.0.1', port });
  const plannedBytes = 8 * 1024 * 1024;
  let response = '', sentBytes = 0, writer, observationTimer, socketError;
  const started = Date.now();
  // This observation window returns data, not a rejected deadline promise: the
  // assertions below must distinguish a remote close from our own cleanup.
  const observed = new Promise(resolve => {
    socket.on('data', data => { response += data.toString('utf8'); });
    socket.on('error', error => { socketError = error.code; });
    socket.once('close', () => resolve({ closed: true, elapsedMs: Date.now() - started }));
    observationTimer = setTimeout(() => resolve({ closed: false, elapsedMs: Date.now() - started }), 2000);
    socket.once('connect', () => {
      socket.write('POST /api/run HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\nConnection: keep-alive\r\n\r\n');
      const chunk = Buffer.alloc(16384, 0x20);
      writer = setInterval(() => {
        if (socket.destroyed || sentBytes >= plannedBytes) return;
        socket.write(`${chunk.length.toString(16)}\r\n`);
        socket.write(chunk); socket.write('\r\n');
        sentBytes += chunk.length;
      }, 5);
      // Deliberately never send the terminating chunk: the server must close us.
    });
  });
  let result;
  try { result = await observed; }
  finally { clearInterval(writer); clearTimeout(observationTimer); socket.destroy(); }
  t.diagnostic(JSON.stringify({ ...result, sentBytes, plannedBytes, socketError }));
  assert.equal((await request('/api/health')).body.ok, true);
  assert.match(response, /^HTTP\/1\.1 413 /);
  assert.match(response, /request_too_large/);
  assert.equal(result.closed, true, 'rejected upload must be closed by the server within 2 seconds');
  assert.match(response.split('\r\n\r\n')[0], /\r\nconnection:\s*close\r?$/im);
  assert.ok(sentBytes < 1024 * 1024, `server read cutoff must precede 1 MiB sent; observed ${sentBytes}`);
});

test('F1 SSE disconnect retains the lock until the real worker writes its report', async (t) => {
  const reportsBefore = new Set(readdirSync(path.join(dir, 'reports')));
  let response, startTimer;
  const stream = http.get({ host: '127.0.0.1', port, path: '/api/run-stream?target=CONFORMANT_REFERENCE', agent: false });
  const started = new Promise((resolve, reject) => {
    startTimer = setTimeout(() => reject(new Error('SSE did not emit run_started')), 8000);
    stream.once('error', reject);
    stream.once('response', res => {
      response = res;
      let text = '';
      res.on('data', data => {
        text += data;
        if (text.includes('"run_started"')) resolve();
      });
    });
  });
  let finished = false, newReports = [], postDisconnectMs;
  try {
    await started; clearTimeout(startTimer);
    assert.ok((await request('/api/health')).body.active_run, 'positive control: SSE worker is running');
    const disconnectedAt = Date.now();
    const closed = once(response, 'close');
    response.destroy(); stream.destroy(); await closed;
    const health = await request('/api/health');
    postDisconnectMs = Date.now() - disconnectedAt;
    assert.ok(health.body.active_run, 'SSE disconnect must not release the running worker lock');
    const blocked = await request('/api/run', { method: 'POST', json: { target: 'CONFORMANT_REFERENCE' } });
    assert.equal(blocked.status, 409); assert.equal(blocked.body.error, 'run_in_progress');
  } finally {
    clearTimeout(startTimer); response?.destroy(); stream.destroy();
    // Wait for the actual worker even when the mutant assertion fails, so a
    // failed test cannot tear down the app while its target is still running.
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      newReports = readdirSync(path.join(dir, 'reports')).filter(name => !reportsBefore.has(name));
      if (newReports.length && (await request('/api/health')).body.active_run === null) { finished = true; break; }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    t.diagnostic(JSON.stringify({ postDisconnectMs, finished, newReports }));
  }
  assert.ok(finished, 'SSE worker must finish and release its lock within 20 seconds');
  assert.equal(newReports.length, 1, 'disconnected SSE run still writes exactly one report');
  assert.match(newReports[0], /^run_[a-f0-9]+\.json$/);
  const report = await request(`/api/report/${newReports[0].slice(0, -5)}`);
  assert.equal(report.status, 200); assert.equal(report.body.summary.overall, 'CONFORMANT');
});

test('F1 HTTP replay refuses nested report and example files but admits a direct report', async () => {
  const live = await request('/api/run', { method: 'POST', json: { target: 'CONFORMANT_REFERENCE', run_id: 'run_f1replay' } });
  assert.equal(live.status, 200); assert.equal(live.body.report.summary.overall, 'CONFORMANT');
  const direct = 'reports/run_f1replay.json';
  const control = await request('/api/replay', { method: 'POST', json: { report_path: direct } });
  assert.equal(control.status, 200); assert.equal(control.body.ok, true);
  for (const root of ['reports', 'examples']) {
    const nested = `${root}/sub/run_sub.json`;
    mkdirSync(path.join(dir, root, 'sub'), { recursive: true });
    cpSync(path.join(dir, direct), path.join(dir, nested));
    for (const report_path of [nested, path.join(dir, nested)]) {
      const refused = await request('/api/replay', { method: 'POST', json: { report_path } });
      assert.equal(refused.status, 400, `nested replay must be refused: ${report_path}`);
      assert.equal(refused.body.error, 'invalid_report_path');
    }
  }
});
