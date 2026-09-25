// Tests for the saved-case HTTP wrapper (src/cases-server.mjs). Authored by Claude.
// The library (src/cases.mjs) is not an HTTP security boundary; this wrapper is.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { createCasesServer, CREATE_BODY_LIMIT, RUN_BODY_LIMIT } from '../src/cases-server.mjs';
import { caseDigest, MAX_CASES } from '../src/cases.mjs';

const server = createCasesServer();
await new Promise(r => server.listen(0, '127.0.0.1', r));
after(() => new Promise(r => server.close(r)));
const base = 'http://127.0.0.1:' + server.address().port;

const read = rel => fs.readFileSync(new URL('../' + rel, import.meta.url), 'utf8');
const tx = read('examples/legacy-transaction.base64').trim();
const acceptText = read('examples/cases/legacy-accept.json');
const rejectText = read('examples/cases/truncated-reject.json');
const acceptCase = JSON.parse(acceptText);
const rejectCase = JSON.parse(rejectText);

const post = (route, body, { origin = base, type = 'application/json', server: target = base } = {}) =>
  fetch(target + route, { method: 'POST', headers: { 'Content-Type': type, Origin: origin }, body: JSON.stringify(body) });
const hostStatus = (path, host) => new Promise((resolve, reject) => {
  const r = http.get(base + path, { headers: { Host: host } }, res => { res.resume(); resolve(res.statusCode); });
  r.on('error', reject);
});

// ---------- security boundary ----------

test('the saved-case page is served with the same strict headers as the original', async () => {
  const r = await fetch(base + '/cases');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /^text\/html/);
  assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.match(await r.text(), /Saved cases/);
});

test('a non-loopback Host is refused on saved-case routes', async () => {
  assert.equal(await hostStatus('/cases', 'unrelated.invalid'), 403);
  assert.equal(await hostStatus('/cases.js', 'unrelated.invalid'), 403);
});

test('saved-case writes require the exact same origin and exact JSON content type', async () => {
  const body = { name: 'n', input_base64: tx };
  assert.equal((await post('/cases/create', body, { origin: 'https://unrelated.invalid' })).status, 403);
  assert.equal((await fetch(base + '/cases/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).status, 403);
  assert.equal((await post('/cases/create', body, { type: 'text/plain' })).status, 403);
});

test('oversized request bodies are refused before any work', async () => {
  const create = await post('/cases/create', { name: 'big', input_base64: 'a'.repeat(CREATE_BODY_LIMIT + 1) });
  assert.equal(create.status, 413);
  const run = await post('/cases/run', { cases: [{ pad: 'a'.repeat(RUN_BODY_LIMIT + 1) }] });
  assert.equal(run.status, 413);
});

test('source files, raw public paths and unknown case routes are not served', async () => {
  assert.equal((await fetch(base + '/src/cases-server.mjs')).status, 404);
  assert.equal((await fetch(base + '/public/cases.js')).status, 404);
  assert.equal((await post('/cases/delete', {})).status, 404);
  assert.equal((await fetch(base + '/cases/run')).status, 404);
});

test('request fields are an exact contract: unknown keys, including paths, are refused', async () => {
  const extra = await post('/cases/create', { name: 'n', input_base64: tx, path: '/etc/passwd' });
  assert.equal(extra.status, 400);
  const pathOnly = await post('/cases/run', { path: '/tmp/case.json' });
  assert.equal(pathOnly.status, 400);
  const importPath = await post('/cases/import', { file: '/tmp/case.json' });
  assert.equal(importPath.status, 400);
});

// ---------- create / import ----------

test('create returns a case and its canonical content digest from the core', async () => {
  const r = await post('/cases/create', { name: 'ui-created', input_base64: tx });
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.equal(data.case.name, 'ui-created');
  assert.match(data.case_content_sha256, /^[a-f0-9]{64}$/);
  assert.equal(data.case_content_sha256, caseDigest(data.case));
  assert.equal(data.limits.caller_identity, 'NOT_ESTABLISHED');
});

test('malformed create input is a 400 with the core message, not a created case', async () => {
  const badB64 = await post('/cases/create', { name: 'bad', input_base64: 'not base64!' });
  assert.equal(badB64.status, 400);
  assert.equal((await badB64.json()).kind, 'INVALID_CASE');
  const badName = await post('/cases/create', { name: '', input_base64: tx });
  assert.equal(badName.status, 400);
});

test('import parses untrusted text with the core and reports the core digest', async () => {
  const r = await post('/cases/import', { case_text: acceptText });
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.equal(data.case.name, acceptCase.name);
  assert.equal(data.case_content_sha256, caseDigest(acceptCase));
});

test('malformed or hostile imported text is refused, never rendered as a case', async () => {
  const notJson = await post('/cases/import', { case_text: '{not json' });
  assert.equal(notJson.status, 400);
  assert.equal((await notJson.json()).kind, 'INVALID_CASE');
  const markupName = await post('/cases/import', { case_text: JSON.stringify({ ...acceptCase, name: '<img src=x onerror=alert(1)>' }) });
  assert.equal(markupName.status, 400);
  const unknownField = await post('/cases/import', { case_text: JSON.stringify({ ...acceptCase, run: 'rm -rf /' }) });
  assert.equal(unknownField.status, 400);
});

// ---------- run ----------

test('rerunning one saved case reproduces it', async () => {
  const report = await (await post('/cases/run', { cases: [acceptCase] })).json();
  assert.equal(report.exit_code, 0);
  assert.equal(report.counts.MATCH, 1);
  assert.equal(report.results[0].reference, 'NOT_PROVIDED');
});

test('an expected parser REJECT can MATCH, and both decisions stay visible', async () => {
  const report = await (await post('/cases/run', { cases: [acceptCase, rejectCase] })).json();
  assert.equal(report.counts.MATCH, 2);
  const reject = report.results.find(r => r.name === rejectCase.name);
  assert.equal(reject.status, 'MATCH');
  assert.equal(reject.expected_result.decision, 'REJECT');
  assert.equal(reject.actual_result.decision, 'REJECT');
});

test('a null reference means NOT_PROVIDED for that case, not a malformed digest', async () => {
  const report = await (await post('/cases/run', { cases: [acceptCase, rejectCase], references: [caseDigest(acceptCase), null] })).json();
  assert.equal(report.exit_code, 0);
  assert.equal(report.results[0].reference, 'MATCH');
  assert.equal(report.results[1].reference, 'NOT_PROVIDED');
});

test('a supplied reference that differs makes that case INVALID_CASE', async () => {
  const report = await (await post('/cases/run', { cases: [acceptCase], references: ['0'.repeat(64)] })).json();
  assert.equal(report.results[0].status, 'INVALID_CASE');
  assert.equal(report.results[0].reference, 'MISMATCH');
  assert.equal(report.exit_code, 2);
});

test('a changed saved expectation is reported as REGRESSION with changed field paths', async () => {
  const parsed = { ...acceptCase.expected_execution.parsed, reason: 'ok:changed-expectation' };
  const altered = structuredClone(acceptCase);
  altered.name = 'altered-expectation';
  altered.expected_execution.parsed = parsed;
  altered.expected_execution.stdout_base64 = Buffer.from(JSON.stringify(parsed) + '\n').toString('base64');
  const report = await (await post('/cases/run', { cases: [altered] })).json();
  assert.equal(report.results[0].status, 'REGRESSION');
  const fields = report.results[0].differences.map(d => d.field);
  assert.ok(fields.includes('execution.parsed.reason'), JSON.stringify(fields));
});

test('batches are bounded and names must be unique, as whole-request 400s', async () => {
  const many = Array.from({ length: MAX_CASES + 1 }, (_, i) => ({ ...acceptCase, name: 'c' + i }));
  assert.equal((await post('/cases/run', { cases: many })).status, 400);
  const dup = await post('/cases/run', { cases: [acceptCase, acceptCase] });
  assert.equal(dup.status, 400);
  assert.equal((await dup.json()).kind, 'INVALID_CASE');
  assert.equal((await post('/cases/run', { cases: [] })).status, 400);
});

// ---------- work and concurrency limits ----------

test('a total-work budget refuses further executions with 429 and Retry-After', async () => {
  const small = createCasesServer({ workBudget: { max: 3, windowMs: 60_000 } });
  await new Promise(r => small.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + small.address().port;
  try {
    const first = await post('/cases/run', { cases: [acceptCase, rejectCase] }, { origin: url, server: url });
    assert.equal(first.status, 200);
    const second = await post('/cases/run', { cases: [acceptCase, rejectCase] }, { origin: url, server: url });
    assert.equal(second.status, 429);
    assert.ok(Number(second.headers.get('retry-after')) > 0);
  } finally { await new Promise(r => small.close(r)); }
});

test('only one saved-case request runs at a time; an overlapping one gets 429 BUSY', async () => {
  const port = server.address().port;
  const slow = new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path: '/cases/import', method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: base } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    r.on('error', reject);
    r.write('{"case_text":');                       // body deliberately left open
    setTimeout(() => r.end(JSON.stringify(acceptText) + '}'), 300);
  });
  await new Promise(r => setTimeout(r, 100));
  const overlapping = await post('/cases/import', { case_text: acceptText });
  assert.equal(overlapping.status, 429);
  assert.equal((await overlapping.json()).kind, 'BUSY');
  assert.equal(await slow, 200);
});

test('a stalled request body is cut off with 408 and does not keep the busy slot', async () => {
  const quick = createCasesServer({ bodyTimeoutMs: 200 });
  await new Promise(r => quick.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + quick.address().port;
  try {
    const stalled = await new Promise(resolve => {
      const r = http.request({ host: '127.0.0.1', port: quick.address().port, path: '/cases/import', method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: url } }, res => { res.resume(); resolve(res.statusCode); });
      r.on('error', () => resolve('connection error without a response'));
      r.setTimeout(3000, () => { r.destroy(); resolve('no response within 3 s'); });
      r.write('{"case_text":');                     // never finished
    });
    assert.equal(stalled, 408);
    assert.equal((await post('/cases/import', { case_text: acceptText }, { origin: url, server: url })).status, 200);
  } finally { await new Promise(r => quick.close(r)); }
});

test('the four saved-case interface files are served from an exact list with their types', async () => {
  for (const [path, type] of [['/cases', /^text\/html/], ['/cases.js', /^text\/javascript/], ['/cases-view.mjs', /^text\/javascript/], ['/cases.css', /^text\/css/]]) {
    const r = await fetch(base + path);
    assert.equal(r.status, 200, path);
    assert.match(r.headers.get('content-type'), type, path);
  }
  assert.equal((await fetch(base + '/cases.html')).status, 404);
  assert.equal((await fetch(base + '/cases.js?x=1')).status, 404);
});

// ---------- original flow intact ----------

test('the original capture/replay flow is served unchanged through the wrapper', async () => {
  const page = await (await fetch(base + '/')).text();
  assert.equal(page, read('public/index.html'));
  const cap = await post('/capture', { tx });
  assert.equal(cap.status, 200);
  assert.equal((await post('/capture', { tx }, { origin: 'https://unrelated.invalid' })).status, 403);
});
