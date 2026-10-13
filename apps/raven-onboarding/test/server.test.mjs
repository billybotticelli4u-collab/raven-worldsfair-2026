import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createOnboardingServer, assertRuntime } from '../server.mjs';
import { runVerticalSlice } from '../../worldsfair-agent-trust/src/lib/runSlice.js';

let server, base;
before(async () => {
  server = createOnboardingServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await server.closeOnboarding(); });
const post = (path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('review runtime is explicit; unsupported Node is refused', () => {
  assert.doesNotThrow(() => assertRuntime('22.18.0'));
  for (const v of ['20.19.3', '22.17.0', '24.20.0', '26.9.0']) assert.throws(() => assertRuntime(v));
});

test('server is loopback-only and original pinned Kit bytes are served unchanged', async () => {
  assert.equal(server.address().address, '127.0.0.1');
  for (const version of ['3.0.3', '4.0.0', '8.3.0']) {
    const response = await fetch(`${base}/kit/decoder-vendor/kit-${version}.js`);
    assert.equal(response.status, 200);
    const source = readFileSync(new URL(`../../kit-compare/decoder-vendor/kit-${version}.js`, import.meta.url));
    const actual = Buffer.from(await response.arrayBuffer());
    assert.equal(createHash('sha256').update(actual).digest('hex'), createHash('sha256').update(source).digest('hex'));
  }
});

test('entry point labels evidence changes and makes no receipt handoff', async () => {
  const response = await fetch(base);
  const html = await response.text();
  assert.equal(response.status, 200);
  for (const text of ['Compare interpretations', 'Test against a profile', 'Check a receipt before deciding', 'liveAcquisition:false', 'comparison report is not converted into a receipt', 'PROCEED is Agent A']) assert.ok(html.includes(text), text);
  assert.match(response.headers.get('content-security-policy'), /connect-src 'self'/);
});

test('cross-origin, rebinding host, arbitrary uploads and unsupported methods refuse', async () => {
  assert.equal((await post('/api/receipt', { path: 'path_a_verified' }, { origin: 'https://attacker.invalid' })).status, 403);
  assert.equal((await post('/api/receipt', { path: 'path_a_verified' }, { 'sec-fetch-site': 'cross-site' })).status, 403);
  await new Promise((resolve, reject) => {
    const req = http.get(base, { headers: { host: 'attacker.invalid' } }, res => { assert.equal(res.statusCode, 403); res.resume(); res.on('end', resolve); }); req.on('error', reject);
  });
  for (const [path, body] of [['/api/receipt', { path: 'foreign' }], ['/api/receipt', { path: 'path_a_verified', receipt: {} }], ['/api/conformance', { target: '../foreign.mjs' }], ['/api/conformance', { target: 'SOL_CONFORMANT_REFERENCE', profile: 'foreign' }]]) assert.equal((await post(path, body)).status, 400);
  assert.equal((await fetch(base + '/api/receipt', { method: 'DELETE' })).status, 405);
  assert.equal((await fetch(base + '/%2e%2e/server.mjs')).status, 404);
});

test('existing upload byte cap and JSON validation remain in force', async () => {
  assert.equal((await fetch(base + '/api/receipt', { method: 'POST', body: 'x'.repeat(65537) })).status, 413);
  assert.equal((await fetch(base + '/api/receipt', { method: 'POST', body: '{' })).status, 400);
  assert.equal((await post('/api/receipt', [])).status, 400);
});

test('receipt endpoint preserves all five original machine exchanges byte-for-byte', async () => {
  for (const path of ['path_a_verified', 'path_b_tampered', 'path_b_wrong_subject', 'path_b_missing', 'path_b_exception']) {
    const response = await post('/api/receipt', { path });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), await runVerticalSlice(path));
  }
});

test('Conformance executes the real 30-vector targets and writes no source report', async () => {
  const directory = new URL('../../raven-conformance/reports/', import.meta.url);
  const beforeFiles = readdirSync(directory);
  const setup = await fetch(base + '/api/setup').then(r => r.json());
  assert.equal(setup.corpus.count, 30);
  for (const target of ['SOL_CONFORMANT_REFERENCE', 'SOL_BROKEN_SUBTLE', 'SOL_BROKEN_OBVIOUS']) {
    const response = await post('/api/conformance', { target });
    assert.equal(response.status, 200);
    const { report, display } = await response.json();
    assert.equal(report.results.length, 30);
    assert.equal(report.target.id, target);
    assert.equal(report.claimed_profile.name, setup.profile.id);
    assert.equal(display.counts.pass + display.counts.behavioral_divergence, 30);
    if (target === 'SOL_CONFORMANT_REFERENCE') assert.equal(display.counts.pass, 30);
    if (target === 'SOL_BROKEN_SUBTLE') {
      assert.equal(display.counts.pass, 27);
      assert.equal(display.counts.behavioral_divergence, 3);
      assert.deepEqual(display.results.filter(r => r.display.kind !== 'PASS').map(r => r.vector_id.slice(0, 3)), ['V03', 'V10', 'V16']);
    }
    if (target === 'SOL_BROKEN_OBVIOUS') assert.ok(display.counts.behavioral_divergence > 3);
  }
  assert.deepEqual(readdirSync(directory), beforeFiles);
});
