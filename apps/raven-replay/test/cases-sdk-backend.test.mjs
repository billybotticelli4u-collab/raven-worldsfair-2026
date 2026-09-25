// Billy 2: SDK schema routing, adapters registry, admission under load, cleanup evidence (D6).
import { test, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { createCasesServer, LEGACY_SCHEMA, SDK_SCHEMA } from '../src/cases-server.mjs';
import { caseDigest } from '../src/cases.mjs';
import { pidAlive, cleanupOwnedSession, snapshotOwnedGroups } from '../src/process-supervisor.mjs';

const server = createCasesServer();
await new Promise(r => server.listen(0, '127.0.0.1', r));
after(() => new Promise(r => server.close(r)));
const base = 'http://127.0.0.1:' + server.address().port;
const port = server.address().port;

const read = rel => fs.readFileSync(new URL('../' + rel, import.meta.url), 'utf8');
const tx = read('examples/legacy-transaction.base64').trim();
const acceptCase = JSON.parse(read('examples/cases/legacy-accept.json'));
const fixtureB64 = Buffer.from(
  fs.readFileSync(new URL('../vendor/raven-replay-parser-sdk/fixtures/legacy-transaction.base64', import.meta.url), 'utf8').trim()
).toString('base64');

const post = (route, body, { origin = base, server: target = base } = {}) =>
  fetch(target + route, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body) });

test('GET /cases/adapters returns id/label/schema only from server registry', async () => {
  const r = await fetch(base + '/cases/adapters');
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.equal(data.schema, 'raven-replay-adapter-list/1');
  assert.ok(Array.isArray(data.adapters) && data.adapters.length >= 1);
  for (const a of data.adapters) {
    assert.deepEqual(Object.keys(a).sort(), ['id', 'label', 'schema']);
    assert.equal(a.schema, SDK_SCHEMA);
    assert.equal(typeof a.id, 'string');
    assert.equal(typeof a.label, 'string');
  }
  assert.ok(data.adapters.some(a => a.id === 'example-parser-v1'));
});

test('adapters route refuses non-loopback Host', async () => {
  const status = await new Promise((resolve, reject) => {
    const r = http.get(base + '/cases/adapters', { headers: { Host: 'evil.invalid' } }, res => {
      res.resume(); resolve(res.statusCode);
    });
    r.on('error', reject);
  });
  assert.equal(status, 403);
});

test('omit adapter_id keeps legacy create; allowlisted adapter_id uses SDK schema', async () => {
  const legacy = await post('/cases/create', { name: 'leg-ui', input_base64: tx });
  assert.equal(legacy.status, 200);
  const leg = await legacy.json();
  assert.equal(leg.case.schema, LEGACY_SCHEMA);

  const sdk = await post('/cases/create', { name: 'sdk-ui', input_base64: fixtureB64, adapter_id: 'example-parser-v1' });
  assert.equal(sdk.status, 200);
  const sd = await sdk.json();
  assert.equal(sd.case.schema, SDK_SCHEMA);
  assert.equal(sd.case.adapter_id, 'example-parser-v1');
  assert.equal(typeof sd.case_content_sha256, 'string');
});

test('unknown adapter_id is INVALID_CASE 400; no silent schema conversion', async () => {
  const r = await post('/cases/create', { name: 'x', input_base64: fixtureB64, adapter_id: 'not-a-real-adapter' });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).kind, 'INVALID_CASE');
});

test('import routes by exact schema; unknown schema refused; no conversion', async () => {
  const created = await (await post('/cases/create', { name: 'imp-sdk', input_base64: fixtureB64, adapter_id: 'example-parser-v1' })).json();
  const text = JSON.stringify(created.case);
  const ok = await post('/cases/import', { case_text: text });
  assert.equal(ok.status, 200);
  const imported = await ok.json();
  assert.equal(imported.case.schema, SDK_SCHEMA);
  assert.equal(imported.case_content_sha256, created.case_content_sha256);

  const unknown = await post('/cases/import', { case_text: JSON.stringify({ schema: 'raven-replay-case/999', name: 'x' }) });
  assert.equal(unknown.status, 400);
  assert.equal((await unknown.json()).kind, 'INVALID_CASE');
});

test('mixed legacy/SDK batch refused; detailed on legacy refused; SDK detailed opt-in', async () => {
  const sdkCreated = await (await post('/cases/create', { name: 'mix-sdk', input_base64: fixtureB64, adapter_id: 'example-parser-v1' })).json();
  const mixed = await post('/cases/run', { cases: [acceptCase, sdkCreated.case] });
  assert.equal(mixed.status, 400);
  assert.match((await mixed.json()).error, /Mixed|homogeneous/i);

  const detailedLegacy = await post('/cases/run', { cases: [acceptCase], detailed: true });
  assert.equal(detailedLegacy.status, 400);
  assert.match((await detailedLegacy.json()).error, /detailed/i);

  const safe = await post('/cases/run', { cases: [sdkCreated.case] });
  assert.equal(safe.status, 200);
  const safeReport = await safe.json();
  assert.equal(safeReport.results[0].status, 'MATCH');
  assert.equal(safeReport.results[0].detailed_export, undefined);

  const det = await post('/cases/run', { cases: [sdkCreated.case], detailed: true });
  assert.equal(det.status, 200);
  const detReport = await det.json();
  assert.ok(detReport.results[0].detailed_export !== undefined);
});

test('SDK run compares retained reference independently; null = NOT_PROVIDED', async () => {
  const created = await (await post('/cases/create', { name: 'ref-sdk', input_base64: fixtureB64, adapter_id: 'example-parser-v1' })).json();
  const withRef = await (await post('/cases/run', {
    cases: [created.case],
    references: [created.case_content_sha256],
  })).json();
  assert.equal(withRef.exit_code, 0);
  assert.equal(withRef.results[0].reference, 'MATCH');

  const nullRef = await (await post('/cases/run', {
    cases: [created.case],
    references: [null],
  })).json();
  assert.equal(nullRef.results[0].reference, 'NOT_PROVIDED');

  const bad = await (await post('/cases/run', {
    cases: [created.case],
    references: ['0'.repeat(64)],
  })).json();
  assert.equal(bad.results[0].status, 'INVALID_CASE');
  assert.equal(bad.results[0].reference, 'MISMATCH');
});

test('admission stays responsive during in-flight run (GET bound + 429 BUSY)', async () => {
  const t0 = Date.now();
  const slow = post('/cases/create', { name: 'adm-slow', input_base64: fixtureB64, adapter_id: 'example-parser-v1' });
  // Give the create a moment to take the active slot
  await new Promise(r => setTimeout(r, 50));
  const getStarted = Date.now();
  const page = await fetch(base + '/cases');
  const getMs = Date.now() - getStarted;
  const adaptersStarted = Date.now();
  const adapters = await fetch(base + '/cases/adapters');
  const adaptersMs = Date.now() - adaptersStarted;
  const busy = await post('/cases/run', { cases: [acceptCase] });
  const slowRes = await slow;
  const totalMs = Date.now() - t0;

  assert.equal(page.status, 200);
  assert.equal(adapters.status, 200);
  assert.equal(busy.status, 429);
  assert.equal((await busy.json()).kind, 'BUSY');
  assert.equal(slowRes.status, 200);
  // Admission GETs must not wait for the create to finish
  assert.ok(getMs < 500, 'GET /cases took ' + getMs + 'ms');
  assert.ok(adaptersMs < 500, 'GET /cases/adapters took ' + adaptersMs + 'ms');
  console.log('ADMISSION_EVIDENCE get_cases_ms=' + getMs + ' get_adapters_ms=' + adaptersMs + ' total_with_create_ms=' + totalMs);
});

test('cleanup after normal SDK create: no leftover worker pgids', async () => {
  const r = await post('/cases/create', { name: 'clean-ok', input_base64: fixtureB64, adapter_id: 'example-parser-v1' });
  assert.equal(r.status, 200);
  const t0 = Date.now();
  await new Promise(r => setTimeout(r, 900)); // allow async group cleanup grace
  const cleanupMs = Date.now() - t0;
  assert.equal(server._ravenLiveWorkers.size, 0);
  console.log('CLEANUP_NORMAL liveWorkers=0 cleanup_wait_ms=' + cleanupMs);
});

test('cleanup after SDK hang create (watchdog timeout → RUN_ERROR): no leftovers', async () => {
  const t0 = Date.now();
  const r = await post('/cases/create', { name: 'clean-hang', input_base64: fixtureB64, adapter_id: 'control-hang' });
  const elapsed = Date.now() - t0;
  assert.equal(r.status, 500);
  assert.equal((await r.json()).kind, 'RUN_ERROR');
  await new Promise(r => setTimeout(r, 900));
  assert.equal(server._ravenLiveWorkers.size, 0);
  assert.ok(elapsed >= 4000 && elapsed < 15000, 'hang elapsed unexpected: ' + elapsed);
  console.log('CLEANUP_TIMEOUT elapsed_ms=' + elapsed + ' liveWorkers=0 (SDK watchdog preserved)');
});

test('cleanup on server close during in-flight hang: supervisor reaps workers', async () => {
  // Dedicated server so we can close mid-flight without breaking other tests
  const s = createCasesServer();
  await new Promise(r => s.listen(0, '127.0.0.1', r));
  const b = 'http://127.0.0.1:' + s.address().port;
  const inflight = fetch(b + '/cases/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: b },
    body: JSON.stringify({ name: 'shutdown-hang', input_base64: fixtureB64, adapter_id: 'control-hang' }),
  });
  await new Promise(r => setTimeout(r, 200));
  assert.ok(s._ravenLiveWorkers.size >= 1, 'expected live worker during hang create');
  const workerPgidList = [...s._ravenLiveWorkers.keys()];
  assert.ok(workerPgidList.length >= 1, 'expected live worker during hang create');
  // Concurrent GET latency while cleanup runs (async, must not stall event loop)
  const cleanupPromise = s._ravenShutdownWorkers();
  const getStarted = Date.now();
  // Use the main test server base for GET admission during cleanup of `s`
  // (loopback page on `s` itself)
  const pageP = fetch(b + '/cases').then(async r => ({ status: r.status, ms: Date.now() - getStarted }));
  await cleanupPromise;
  const page = await pageP;
  await new Promise(r => s.close(r));
  try { await inflight; } catch { /* */ }
  const cleanupMs = Date.now() - getStarted;
  await new Promise(r => setTimeout(r, 500));
  const still = workerPgidList.filter(pidAlive);
  assert.equal(still.length, 0, 'worker pids still alive: ' + still.join(','));
  assert.equal(page.status, 200);
  assert.ok(page.ms < 500, 'GET during cleanup too slow: ' + page.ms);
  console.log('CLEANUP_SHUTDOWN cleanup_ms=' + cleanupMs + ' get_during_cleanup_ms=' + page.ms + ' tracked_workers_alive=0');
});

test('legacy create still works unchanged through forked worker', async () => {
  const r = await post('/cases/create', { name: 'legacy-still', input_base64: tx });
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.equal(data.case.schema, LEGACY_SCHEMA);
  assert.equal(typeof data.case_content_sha256, 'string');
  assert.equal(data.case_content_sha256, caseDigest(data.case));
});

test('WORK_BUDGET kind with 429 and Retry-After (distinct from BUSY)', async () => {
  const small = createCasesServer({ workBudget: { max: 1, windowMs: 60_000 } });
  await new Promise(r => small.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + small.address().port;
  try {
    const first = await post('/cases/create', { name: 'wb1', input_base64: tx }, { origin: url, server: url });
    assert.equal(first.status, 200);
    const second = await post('/cases/create', { name: 'wb2', input_base64: tx }, { origin: url, server: url });
    assert.equal(second.status, 429);
    const body = await second.json();
    assert.equal(body.kind, 'WORK_BUDGET');
    assert.match(body.error, /Local work budget used/);
    assert.ok(Number(second.headers.get('retry-after')) >= 1);
  } finally { await new Promise(r => small.close(r)); }
});

test('NEGATIVE CONTROL: RAVEN_TEST_DISABLE_CLEANUP leaves worker alive; finally reaps all SDK groups', async () => {
  const prev = process.env.RAVEN_TEST_DISABLE_CLEANUP;
  process.env.RAVEN_TEST_DISABLE_CLEANUP = '1';
  process.env.RAVEN_TEST_EXEC_DEADLINE_MS = '400';
  const s = createCasesServer();
  await new Promise(r => s.listen(0, '127.0.0.1', r));
  const b = 'http://127.0.0.1:' + s.address().port;
  let leaked = [];
  let snapPids = [];
  try {
    assert.equal(s._ravenCleanupDisabled, true);
    const inflight = fetch(b + '/cases/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: b },
      body: JSON.stringify({ name: 'neg-dis', input_base64: fixtureB64, adapter_id: 'control-hang' }),
    });
    await new Promise(r => setTimeout(r, 200));
    leaked = [...s._ravenLiveWorkers.keys()];
    assert.ok(leaked.length >= 1, 'expected in-flight worker pgid');
    // Snapshot while worker still up so adapter/watchdog are recorded
    const snap = await snapshotOwnedGroups(leaked[0]);
    snapPids = snap.pids;
    assert.ok(snapPids.length >= 1, 'expected nonempty ownership snapshot');
    try { await inflight; } catch { /* */ }
    await new Promise(r => setTimeout(r, 200));
    const alive = leaked.filter(pidAlive);
    assert.ok(alive.length >= 1, 'cleanup-disabled must leave worker alive; alive=' + alive);
    console.log('LINUX_MEASURE negative_disable_cleanup leftovers=' + alive.length + ' snap_pids=' + snapPids.length);
  } finally {
    // C3: finally cleanup ALL owned groups (worker + adapter), not just worker pgid
    for (const p of leaked) {
      await cleanupOwnedSession(p, { termMs: 300, killMs: 300 });
    }
    for (const p of snapPids) {
      try { process.kill(-p, 'SIGKILL'); } catch { /* */ }
      try { process.kill(p, 'SIGKILL'); } catch { /* */ }
    }
    await new Promise(r => setTimeout(r, 100));
    const still = [...leaked, ...snapPids].filter(pidAlive);
    assert.equal(still.length, 0, 'finally must leave zero leftovers: ' + still);
    if (prev === undefined) delete process.env.RAVEN_TEST_DISABLE_CLEANUP;
    else process.env.RAVEN_TEST_DISABLE_CLEANUP = prev;
    delete process.env.RAVEN_TEST_EXEC_DEADLINE_MS;
    await new Promise(r => s.close(r));
  }
});

test('C1: SDK hang-ignore-term adapter group is reaped (not left past deadline)', async () => {
  const s = createCasesServer();
  await new Promise(r => s.listen(0, '127.0.0.1', r));
  const b = 'http://127.0.0.1:' + s.address().port;
  let workerPgid = null;
  let snap = null;
  try {
    const inflight = fetch(b + '/cases/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: b },
      body: JSON.stringify({
        name: 'c1-hang-ignore',
        input_base64: fixtureB64,
        adapter_id: 'control-hang-ignore-term',
      }),
    });
    await new Promise(r => setTimeout(r, 300));
    workerPgid = [...s._ravenLiveWorkers.keys()][0];
    assert.ok(workerPgid, 'expected live worker');
    snap = await snapshotOwnedGroups(workerPgid);
    assert.ok(snap.pids.length >= 2, 'expected watchdog/adapter in snapshot, got ' + JSON.stringify(snap.rows));
    const foreign = snap.pgids.filter(g => g !== workerPgid);
    assert.ok(foreign.length >= 1, 'expected detached adapter pgid distinct from worker');
    // Force shutdown cleanup (same path as deadline/failure)
    await s._ravenShutdownWorkers();
    try { await inflight; } catch { /* */ }
    // Wait past 5s SDK deadline — adapter must NOT still be alive
    await new Promise(r => setTimeout(r, 6000));
    const alive = snap.pids.filter(pidAlive);
    assert.equal(alive.length, 0, 'C1 leftover after deadline: ' + alive + ' rows=' + JSON.stringify(snap.rows));
    console.log('LINUX_MEASURE C1_adapter_reaped snap_pids=' + snap.pids.length + ' pgids=' + snap.pgids.join(',') + ' leftover=0');
  } finally {
    if (workerPgid) await cleanupOwnedSession(workerPgid, { termMs: 200, killMs: 200 });
    if (snap) for (const p of snap.pids) {
      try { process.kill(-p, 'SIGKILL'); } catch { /* */ }
      try { process.kill(p, 'SIGKILL'); } catch { /* */ }
    }
    await new Promise(r => s.close(r));
  }
});
