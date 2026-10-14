// Extends the earlier a79bbe5d browser regression on the reviewed b3ed3675 lineage.
// Real Chromium and real checks; only failure-display cases use intercepted responses.
// Node built-ins only. No browser download, dependency install or external service.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createOnboardingServer } from '../server.mjs';
import { adaptReport } from '../../raven-conformance/src/lib/displayAdapter.js';
import { loadProfile } from '../../raven-conformance/src/lib/runner.js';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let server, base, browser, exited, cdp, profile, reference;
let reply = null;
const requests = [], blocked = [], errors = [], measurements = [];

async function chromiumPath() {
  const candidates = process.env.RAVEN_CHROMIUM ? [process.env.RAVEN_CHROMIUM] : [
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ];
  for (const candidate of candidates) { try { await access(candidate, constants.X_OK); if ((await stat(candidate)).isFile()) return candidate; } catch {} }
  throw Error('Existing Chromium required for the layout regression; set RAVEN_CHROMIUM. Nothing is downloaded and this test is not skipped.');
}

function connect(url) {
  const socket = new WebSocket(url), pending = new Map();
  let id = 0;
  const ready = new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(Error('Chromium debugging connection failed')), { once: true });
  });
  const client = {
    onEvent: () => {},
    async send(method, params = {}) {
      await ready;
      const requestId = ++id;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(requestId); reject(Error(`Chromium command timed out: ${method}`)); }, 15000);
        pending.set(requestId, { resolve, reject, timer });
        socket.send(JSON.stringify({ id: requestId, method, params }));
      });
    },
    close() { socket.close(); },
  };
  socket.addEventListener('message', ({ data }) => {
    const m = JSON.parse(data);
    if (!m.id) { Promise.resolve(client.onEvent(m)).catch(error => errors.push(error.message)); return; }
    const p = pending.get(m.id);
    if (!p) return;
    clearTimeout(p.timer); pending.delete(m.id);
    if (m.error) p.reject(Error(m.error.message)); else p.resolve(m.result);
  });
  socket.addEventListener('close', () => {
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(Error('Chromium debugging connection closed')); }
    pending.clear();
  });
  return client;
}

async function evaluate(expression, awaitPromise = false) {
  const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (r.exceptionDetails) throw Error(r.exceptionDetails.text);
  return r.result.value;
}

async function waitFor(expression, ms = 20000) {
  const until = Date.now() + ms;
  while (Date.now() < until) { if (await evaluate(expression)) return; await wait(25); }
  throw Error(`Timed out waiting for ${expression}`);
}

async function navigate(width) {
  reply = null;
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: base });
  await waitFor("document.readyState === 'complete' && !document.querySelector('#target').disabled");
  await evaluate('document.fonts.ready', true);
}

const select = step => evaluate(`document.querySelector('[data-step="${step}"]').click()`);
const run = () => evaluate("document.querySelector('#run').click()");
const resultReady = () => waitFor("!document.querySelector('#result').hidden && !document.querySelector('#run').disabled");

async function fit(label, width) {
  const state = await evaluate(`(() => ({
    viewport: innerWidth, scroll: document.documentElement.scrollWidth,
    identity: document.querySelector('#profile-detail').innerText,
    status: document.querySelector('#status').innerText,
    banner: document.querySelector('#facts > p')?.innerText ?? null,
    limits: document.querySelector('#limits').innerText,
    limitsVisible: document.querySelector('#limits').getClientRects().length > 0,
    textBoxes: ['#status', '#profile-detail', '#facts > p'].map(selector => {
      const node = document.querySelector(selector);
      return { selector, visible: Boolean(node?.getClientRects().length), scroll: node?.scrollWidth, width: node?.clientWidth };
    }),
    resultVisible: !document.querySelector('#result').hidden,
    downloadDisabled: document.querySelector('#download').disabled
  }))()`);
  measurements.push({ label, width, ...state });
  if (process.env.RAVEN_LAYOUT_ARTIFACTS) {
    const file = path.join(process.env.RAVEN_LAYOUT_ARTIFACTS, `${width}-${label}.png`);
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(file, Buffer.from(shot.data, 'base64'));
  }
  assert.equal(state.viewport, width, 'viewport positive control');
  assert.equal(state.scroll, width, `${label} overflows at ${width}px: ${state.scroll}`);
  assert.equal(state.limitsVisible, true, 'limits must remain rendered');
  for (const box of state.textBoxes.filter(box => box.visible)) assert.ok(box.scroll <= box.width + 1, `${label} clips ${box.selector}`);
  assert.equal(state.textBoxes[0].visible, true, 'status must remain rendered');
  if (label.startsWith('conformance') || label.startsWith('banner')) assert.equal(state.textBoxes[1].visible, true, 'profile identity must remain rendered');
  if (label.startsWith('banner')) assert.equal(state.textBoxes[2].visible, true, 'failure banner must remain rendered');
  assert.match(state.limits, /Nothing here submits a transaction, acquires fresh chain data or moves funds/);
  return state;
}

after(async () => {
  cdp?.close();
  if (Number.isInteger(browser?.pid)) {
    const kill = signal => { try { process.platform === 'win32' ? browser.kill(signal) : process.kill(-browser.pid, signal); } catch (e) { if (e.code !== 'ESRCH') throw e; } };
    kill('SIGTERM');
    let timer;
    const stopped = await Promise.race([exited.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), 1500); })]);
    clearTimeout(timer);
    if (!stopped) { kill('SIGKILL'); await exited; }
  }
  await server?.closeOnboarding();
  if (profile) await rm(profile, { recursive: true, force: true });
  if (process.env.RAVEN_LAYOUT_ARTIFACTS) await writeFile(path.join(process.env.RAVEN_LAYOUT_ARTIFACTS, 'measurements.json'), JSON.stringify({ measurements, requests, blocked, errors }, null, 2) + '\n');
});

before(async () => {
  console.log('LAYOUT_REGRESSION_INPUTS', JSON.stringify({ node: process.version,
    testSha256: createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex'),
    cssSha256: createHash('sha256').update(await readFile(new URL('../public/style.css', import.meta.url))).digest('hex') }));
  const binary = await chromiumPath();
  server = createOnboardingServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(base + '/api/conformance', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ target: 'SOL_CONFORMANT_REFERENCE' }) });
  assert.equal(response.status, 200);
  reference = await response.json();
  assert.equal(reference.display.counts.pass, 30);
  profile = await mkdtemp(path.join(os.tmpdir(), 'raven-onboarding-layout-'));
  browser = spawn(binary, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--host-resolver-rules=MAP * 0.0.0.0, EXCLUDE 127.0.0.1', 'about:blank'],
    { stdio: ['ignore', 'ignore', 'pipe'], detached: process.platform !== 'win32' });
  exited = new Promise(resolve => { browser.once('exit', resolve); browser.once('error', resolve); });
  let stderr = '';
  browser.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-8000); });
  let port;
  for (let i = 0; i < 200; i++) {
    const m = stderr.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
    if (m) { port = Number(m[1]); break; }
    if (browser.exitCode !== null) throw Error(`Chromium exited before its debugging port: ${stderr}`);
    await wait(25);
  }
  assert.ok(port, `Chromium did not expose a debugging port: ${stderr}`);
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json());
  cdp = connect(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  cdp.onEvent = async m => {
    if (m.method === 'Network.requestWillBeSent') requests.push(m.params.request.url);
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text);
    if (m.method !== 'Fetch.requestPaused') return;
    const { requestId, request } = m.params;
    if (!request.url.startsWith(base + '/')) {
      blocked.push(request.url); await cdp.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }); return;
    }
    if (reply && request.url === base + '/api/conformance' && request.method === 'POST') {
      await cdp.send('Fetch.fulfillRequest', { requestId, responseCode: reply.status,
        responseHeaders: [{ name: 'content-type', value: 'application/json' }], body: Buffer.from(JSON.stringify(reply.body)).toString('base64') });
    } else await cdp.send('Fetch.continueRequest', { requestId });
  };
  await cdp.send('Network.enable'); await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  await evaluate("fetch('https://example.com/raven-layout-positive-control').catch(() => {})", true);
  assert.ok(requests.some(url => url.startsWith('https://example.com/')), 'network observer positive control');
  assert.equal(blocked.length, 1, 'external requests are blocked, not merely recorded');
  requests.length = 0; blocked.length = 0;
});

test('every step fits before and after real checks, keeping the complete profile identity and limits', { timeout: 90000 }, async () => {
  const digest = createHash('sha256').update(await readFile(loadProfile('raven-solana-txversion-experimental/0').path)).digest('hex');
  for (const width of [320, 390, 1440]) {
    await navigate(width);
    for (const step of ['compare', 'conformance', 'receipt']) {
      await select(step); const before = await fit(`${step}-before`, width);
      if (step === 'conformance') assert.ok(before.identity.endsWith(`profile SHA-256 ${digest}`));
      await run(); await resultReady();
      const title = await evaluate("document.querySelector('#result-title').innerText");
      assert.match(title, step === 'compare' ? /readers disagree/i : step === 'conformance' ? /Engine result:/ : /Agent A: PROCEED/);
      if (step === 'conformance') assert.match(await evaluate("document.querySelector('#found').innerText"), /27 matched; 3 behavioral differences; 0 other/);
      const after = await fit(`${step}-after`, width); assert.equal(after.downloadDisabled, false);
    }
  }
  assert.deepEqual(errors, []); assert.deepEqual(blocked, []);
  assert.ok(requests.every(url => url.startsWith(base + '/')), 'no external product requests');
});

test('failure, skip and mixed banners fit on phones without hiding or crediting failed vectors', async () => {
  for (const width of [320, 390]) {
    await navigate(width); await select('conformance');
    for (const kind of ['failure', 'skip', 'mixed']) {
      const report = structuredClone(reference.report);
      const ids = report.results.map(r => r.vector_id);
      report.results = report.results.map((r, i) => ({ ...r, status: kind === 'failure' ? 'TIMEOUT' : kind === 'skip' ? 'SKIPPED_VECTOR' : i ? 'BEHAVIORAL_DIVERGENCE' : 'TIMEOUT' }));
      report.summary = { overall: 'INCOMPLETE', execution_error_vector_ids: kind === 'skip' ? [] : kind === 'failure' ? ids : [ids[0]], skipped_vector_ids: kind === 'skip' ? ids : [], behavioral_divergence_vector_ids: kind === 'mixed' ? ids.slice(1) : [] };
      const adapted = adaptReport(report, loadProfile('raven-solana-txversion-experimental/0').data);
      assert.equal(adapted.ok, true); assert.equal(adapted.display.counts.pass, 0);
      reply = { status: 200, body: { report, display: adapted.display } };
      await run(); await resultReady(); const state = await fit(`banner-${kind}`, width);
      assert.ok(state.banner && ids.every(id => state.banner.includes(id)));
      assert.match(await evaluate("document.querySelector('#found').innerText"), /^0 matched;/);
    }
  }
});

test('a long path-shaped server error remains readable and leaves no stale result or download', async () => {
  for (const width of [320, 390]) {
    await navigate(width); await select('conformance'); await run(); await resultReady();
    const message = 'EACCES: permission denied, open /retained/public/example/' + 'long_target_identity_'.repeat(16) + '.mjs';
    reply = { status: 500, body: { error: 'run_failed', message } };
    await run(); await waitFor("document.querySelector('#status').textContent.includes('Check did not finish')");
    const state = await fit('long-server-error', width);
    assert.ok(state.status.includes(message)); assert.equal(state.resultVisible, false); assert.equal(state.downloadDisabled, true);
  }
  assert.deepEqual(errors, []); assert.deepEqual(blocked, []);
});
