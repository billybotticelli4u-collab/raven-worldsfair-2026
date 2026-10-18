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
let loads = 0;
let reply = null;
const routes = new Map();
let holdConformance = false, heldRequest = null;
const startupHolds = new Set(), startupRequests = new Map();
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
  let id = 0, lastMethod = '';
  const ready = new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(Error('Chromium debugging connection failed')), { once: true });
  });
  const client = {
    onEvent: () => {},
    async send(method, params = {}) {
      await ready; lastMethod = method;
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
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(Error(`Chromium debugging connection closed during ${lastMethod}`)); }
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

async function navigate(width, ready = "document.readyState === 'complete' && !document.querySelector('#target').disabled") {
  reply = null;
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
  const previous = loads;
  await cdp.send('Page.navigate', { url: base });
  const until = Date.now() + 15000;
  while (loads === previous && Date.now() < until) await wait(25);
  assert.ok(loads > previous, 'new page load barrier');
  await waitFor(ready);
  await evaluate('document.fonts.ready', true);
}

const select = step => evaluate(`document.querySelector('[data-step="${step}"]').click()`);
const run = () => evaluate("document.querySelector('#run').click()");
const resultReady = () => waitFor("!document.querySelector('#result').hidden && !document.querySelector('#run').disabled");

function assertFit(state, label, width) {
  assert.equal(state.viewport, width, 'viewport positive control');
  assert.ok(state.client > 0 && state.client <= width, 'layout viewport is measured independently of scrollbars');
  assert.ok(state.scroll <= state.client + 1, `${label} overflows at ${width}px: ${state.scroll} > ${state.client}`);
  assert.ok(state.rootOverflow.every(value => !['hidden', 'clip'].includes(value)), 'root overflow must not hide text');
  for (const box of state.textBoxes.filter(box => box.visible)) {
    assert.ok(box.scroll <= box.width + 1, `${label} clips ${box.selector}`);
    assert.ok(box.left >= -1 && box.right <= state.client + 1, `${label} places ${box.selector} outside the readable viewport`);
    for (const text of box.textRects ?? []) {
      assert.ok(text.left >= -1 && text.right <= state.client + 1, `${label} places ${box.selector} text outside the readable viewport`);
      assert.ok(text.left >= box.left - 1 && text.right <= box.right + 1, `${label} clips ${box.selector} text outside its box`);
    }
  }
}

async function fit(label, width) {
  const state = await evaluate(`(() => ({
    viewport: innerWidth, client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth,
    rootOverflow: [document.documentElement, document.body].map(n => getComputedStyle(n).overflowX),
    identity: document.querySelector('#profile-detail').innerText,
    status: document.querySelector('#status').innerText,
    banner: document.querySelector('#facts > p')?.innerText ?? null,
    limits: document.querySelector('#limits').innerText,
    limitsVisible: document.querySelector('#limits').getClientRects().length > 0,
    textBoxes: ['#status', '#profile-detail', '#facts > p', '#setup-notice', '#reproduce'].map(selector => {
      const node = document.querySelector(selector);
      const rect = node?.getBoundingClientRect();
      const range = document.createRange();
      if (node) range.selectNodeContents(node);
      const textRects = node ? Array.from(range.getClientRects(), r => ({ left: r.left, right: r.right, width: r.width, height: r.height })).filter(r => r.width > 0 && r.height > 0) : [];
      return { selector, visible: Boolean(node?.getClientRects().length), scroll: node?.scrollWidth, width: node?.clientWidth, left: rect?.left, right: rect?.right, textRects };
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
  assertFit(state, label, width);
  assert.equal(state.limitsVisible, true, 'limits must remain rendered');
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
  browser = spawn(binary, ['--headless', '--disable-gpu', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-domain-reliability', '--metrics-recording-only', '--no-first-run', '--no-default-browser-check',
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
    if (m.method === 'Page.loadEventFired') loads++;
    if (m.method === 'Network.requestWillBeSent') requests.push(m.params.request.url);
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text);
    if (m.method !== 'Fetch.requestPaused') return;
    const { requestId, request } = m.params;
    if (!request.url.startsWith(base + '/')) {
      blocked.push(request.url); await cdp.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }); return;
    }
    if (holdConformance && request.url === base + '/api/conformance' && request.method === 'POST') { heldRequest = requestId; return; }
    const pathname = new URL(request.url).pathname;
    if (startupHolds.has(pathname)) { startupRequests.set(pathname, requestId); return; }
    const stub = routes.get(new URL(request.url).pathname) || (request.url === base + '/api/conformance' && request.method === 'POST' ? reply : null);
    if (stub) {
      await cdp.send('Fetch.fulfillRequest', { requestId, responseCode: stub.status,
        responseHeaders: [{ name: 'content-type', value: 'application/json' }], body: Buffer.from(stub.raw ?? JSON.stringify(stub.body)).toString('base64') });
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
      if (step === 'conformance') {
        assert.ok(before.identity.includes(`profile SHA-256 ${digest}`));
        const metadata = await fetch(base + '/api/setup').then(r => r.json());
        assert.ok(before.identity.includes(`corpus ${metadata.corpus.id}`));
        assert.ok(before.identity.endsWith(`corpus SHA-256 ${metadata.corpus.sha256}`));
      }
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
      report.summary = { overall: kind === 'skip' ? 'CONFORMANT' : 'DIVERGENT', execution_error_vector_ids: kind === 'skip' ? [] : kind === 'failure' ? ids : [ids[0]], skipped_vector_ids: kind === 'skip' ? ids : [], behavioral_divergence_vector_ids: kind === 'mixed' ? ids.slice(1) : [] };
      const adapted = adaptReport(report, loadProfile('raven-solana-txversion-experimental/0').data);
      assert.equal(adapted.ok, true); assert.equal(adapted.display.counts.pass, 0);
      reply = { status: 200, body: { report, display: adapted.display } };
      await run(); await resultReady(); const state = await fit(`banner-${kind}`, width);
      assert.ok(state.banner && ids.every(id => state.banner.includes(id)));
      assert.match(await evaluate("document.querySelector('#found').innerText"), /^0 matched;/);
      assert.equal(await evaluate("document.querySelector('#result-title').innerText"), 'Profile check has non-pass results.');
      assert.equal(JSON.parse(await evaluate("document.querySelector('#raw').textContent")).summary.overall, report.summary.overall, 'raw engine classification is preserved');
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


test('classic scrollbar width is allowed while overflow and clipping still fail', () => {
  const good = { viewport: 320, client: 305, scroll: 305, rootOverflow: ['visible', 'visible'], textBoxes: [{ visible: true, selector: '#status', scroll: 273, width: 273, left: 16, right: 289 }] };
  assert.doesNotThrow(() => assertFit(good, 'classic-scrollbar', 320));
  assert.doesNotThrow(() => assertFit({ ...good, client: 320, scroll: 320 }, 'overlay-scrollbar', 320));
  assert.throws(() => assertFit({ ...good, scroll: 321 }, 'overflow', 320), /overflows/);
  assert.throws(() => assertFit({ ...good, rootOverflow: ['hidden', 'hidden'] }, 'root-hiding', 320), /must not hide/);
  assert.throws(() => assertFit({ ...good, rootOverflow: ['clip', 'visible'] }, 'root-clipping', 320), /must not hide/);
  assert.throws(() => assertFit({ ...good, textBoxes: [{ ...good.textBoxes[0], scroll: 2525, width: 2525, right: 2541 }] }, 'wide-status', 320), /outside the readable viewport/);
});

test('profile setup failure stays explained across navigation; examples and receipt work independently', async () => {
  try {
    for (const stub of [{ status: 500, body: {} }, { status: 200, raw: '{' }, { status: 200, body: {} }]) {
      routes.set('/api/setup', stub);
      await navigate(320, "document.querySelector('#setup-notice').textContent.includes('Profile identities could not load') && !document.querySelector('#example').disabled");
      await select('conformance');
      assert.equal(await evaluate("document.querySelector('#run').disabled"), true);
      assert.match(await evaluate("document.querySelector('#status').innerText"), /Profile check unavailable.*Reload to retry/);
      await select('receipt'); await run(); await resultReady();
      assert.equal(await evaluate("document.querySelector('#result-title').innerText"), 'Agent A: PROCEED');
      await select('conformance');
      assert.match(await evaluate("document.querySelector('#status').innerText"), /Profile check unavailable/);
      await fit('setup-failure', 320);
      await select('compare'); await run(); await resultReady();
    }
  } finally { routes.clear(); }
});

test('example failure does not disable a healthy profile check or manually entered bytes', async () => {
  try {
    routes.set('/kit/decoder-cases.json', { status: 404, body: {} });
    await navigate(390);
    await waitFor("document.querySelector('#setup-notice').textContent.includes('Comparison examples could not load')");
    assert.equal(await evaluate("document.querySelector('#example').disabled"), true);
    await select('conformance'); await run(); await resultReady();
    assert.match(await evaluate("document.querySelector('#found').innerText"), /^27 matched; 3 behavioral differences/);
    await select('compare');
    await evaluate("document.querySelector('#bytes').value = '00'; document.querySelector('#bytes').dispatchEvent(new Event('input', { bubbles: true }))");
    await run(); await resultReady();
  } finally { routes.clear(); }
});

test('concurrent and malformed responses explain recovery without leaving a result', async () => {
  await navigate(390); await select('conformance');
  for (const [stub, hint] of [[{ status: 409, body: { error: 'run_in_progress' } }, /Another check is still running.*Wait for it to finish/], [{ status: 500, raw: '<html>error</html>' }, /unreadable response.*Retry/]]) {
    reply = stub; await run(); await waitFor("document.querySelector('#status').textContent.includes('Check did not finish')");
    assert.match(await evaluate("document.querySelector('#status').innerText"), hint);
    assert.equal(await evaluate("document.querySelector('#result').hidden && document.querySelector('#download').disabled"), true);
  }
});

test('decision tokens stay on one line inside scrollable tables and CLI uses monospace', async () => {
  for (const width of [320, 390, 1440]) {
    await navigate(width); await select('compare'); await run(); await resultReady();
    const tokens = await evaluate("Array.from(document.querySelectorAll('td.decision,td.token'), n => { const r = document.createRange(); r.selectNodeContents(n); return { text: n.textContent, lines: new Set(Array.from(r.getClientRects(), x => x.top)).size } })");
    assert.ok(tokens.some(t => t.text === 'ACCEPT') && tokens.some(t => t.text === 'REJECT'));
    assert.ok(tokens.every(t => t.lines === 1), JSON.stringify(tokens));
    await select('conformance'); await run(); await resultReady();
    assert.match(await evaluate("getComputedStyle(document.querySelector('#reproduce')).fontFamily"), /monospace/);
    await fit('readable-table', width);
  }
});

test('editing bytes marks a custom input; selecting the same example restores it', async () => {
  await navigate(390);
  const before = await evaluate("({ example: document.querySelector('#example').value, bytes: document.querySelector('#bytes').value })");
  await evaluate("document.querySelector('#bytes').value = '00'; document.querySelector('#bytes').dispatchEvent(new Event('input', { bubbles: true }))");
  assert.equal(await evaluate("document.querySelector('#example').value"), '');
  await evaluate(`document.querySelector('#example').value = ${JSON.stringify(before.example)}; document.querySelector('#example').dispatchEvent(new Event('change', { bubbles: true }))`);
  assert.equal(await evaluate("document.querySelector('#bytes').value"), before.bytes);
  assert.equal(await evaluate("document.querySelector('#result').hidden && document.querySelector('#download').disabled"), true);
});

test('a pending profile check explains the wait; cancellation leaves no result', async () => {
  await navigate(320); await select('conformance');
  holdConformance = true; heldRequest = null;
  try {
    await run();
    const until = Date.now() + 5000;
    while (!heldRequest && Date.now() < until) await wait(25);
    assert.ok(heldRequest, 'real request interception barrier');
    assert.match(await evaluate("document.querySelector('#status').innerText"), /can take over a minute.*does not stream progress.*no result is available/);
    await evaluate("document.querySelector('#cancel').click()");
    assert.equal(await evaluate("document.querySelector('#result').hidden && document.querySelector('#download').disabled"), true);
    assert.match(await evaluate("document.querySelector('#status').innerText"), /cancelled/);
  } finally {
    holdConformance = false;
    if (heldRequest) await cdp.send('Fetch.failRequest', { requestId: heldRequest, errorReason: 'Aborted' }).catch(error => { if (!/Invalid InterceptionId/.test(error.message)) throw error; });
    heldRequest = null;
  }
});

async function holdStartup(pathname, ready) {
  startupHolds.add(pathname); startupRequests.delete(pathname);
  await navigate(320, ready);
  const until = Date.now() + 5000;
  while (!startupRequests.has(pathname) && Date.now() < until) await wait(25);
  assert.ok(startupRequests.has(pathname), `real startup request held: ${pathname}`);
}
async function releaseStartup(pathname) {
  startupHolds.delete(pathname);
  const requestId = startupRequests.get(pathname); startupRequests.delete(pathname);
  if (requestId) await cdp.send('Fetch.continueRequest', { requestId });
}

test('N2 late examples preserve a user-selected Base64 encoding until an example is chosen', async () => {
  const pathname = '/kit/decoder-cases.json';
  try {
    await holdStartup(pathname, "document.readyState === 'complete' && !document.querySelector('#target').disabled");
    await evaluate("document.querySelector('#encoding').value = 'base64'; document.querySelector('#encoding').dispatchEvent(new Event('change', { bubbles: true }))");
    await releaseStartup(pathname);
    await waitFor("!document.querySelector('#example').disabled");
    assert.deepEqual(await evaluate("({ encoding: document.querySelector('#encoding').value, bytes: document.querySelector('#bytes').value, example: document.querySelector('#example').value })"), { encoding: 'base64', bytes: '', example: '' });
    await evaluate("const e = document.querySelector('#example'); e.value = Array.from(e.options).find(o => o.value.startsWith('E_')).value; e.dispatchEvent(new Event('change', { bubbles: true }))");
    assert.equal(await evaluate("document.querySelector('#encoding').value"), 'hex');
    await run(); await resultReady();
    assert.equal(await evaluate("document.querySelector('#result-title').textContent"), 'The readers disagree.');
  } finally { await releaseStartup(pathname); }
});

for (const pathname of ['/api/setup', '/kit/decoder-cases.json']) test(`N3 late startup keeps the visible validation failure (${pathname})`, async () => {
  try {
    await holdStartup(pathname, "document.readyState === 'complete' && !document.querySelector('#run').disabled");
    await evaluate("document.querySelector('#bytes').value = 'abc'; document.querySelector('#bytes').dispatchEvent(new Event('input', { bubbles: true }))");
    await run(); await waitFor("document.querySelector('#status').textContent.includes('Hex needs complete byte pairs')");
    const before = await evaluate("document.querySelector('#status').textContent");
    await releaseStartup(pathname);
    await waitFor(pathname === '/api/setup' ? "!document.querySelector('#target').disabled" : "!document.querySelector('#example').disabled");
    await wait(50);
    assert.equal(await evaluate("document.querySelector('#status').textContent"), before);
    assert.equal(await evaluate("document.querySelector('#result').hidden && document.querySelector('#download').disabled"), true);
  } finally { await releaseStartup(pathname); }
});

test('N4 layout guard rejects off-screen status text even when its box fits', async () => {
  await navigate(320);
  await evaluate("document.querySelector('#status').style.textIndent = '-9999px'");
  try { await assert.rejects(fit('offscreen-status-text-control', 320), /#status text outside the readable viewport/); }
  finally { await evaluate("document.querySelector('#status').style.textIndent = ''"); }
  await fit('status-text-restored-twin', 320);
});

test('N5 long synthetic setup notices remain fully readable on phone widths', async () => {
  for (const width of [320, 390]) {
    await navigate(width);
    await evaluate("const n = document.querySelector('#setup-notice'); n.hidden = false; n.textContent = 'Synthetic layout control: ' + 'setup_identity_'.repeat(24)");
    await fit('long-setup-notice-control', width);
  }
});
