// R6: four cleanup paths + nonempty adapter lstart from real hook (empty PATH).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { fork, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createCasesServer } from '../src/cases-server.mjs';
import {
  cleanupOwnedSession, captureIdentity, pidAlive, readOwnedRegistry,
  identityComplete,
} from '../src/process-supervisor.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const hook = pathToFileURL(path.join(root, 'src/adapter-observe-hook.mjs')).href;
// Like-for-like SDK input: decode fixture text → raw bytes → base64 (same bytes both sides)
const fixtureRaw = Buffer.from(
  fs.readFileSync(path.join(root, 'vendor/raven-replay-parser-sdk/fixtures/legacy-transaction.base64'), 'utf8').trim(),
  'base64'
);
const fixtureB64 = fixtureRaw.toString('base64');
const fixtureInputSha256 = crypto.createHash('sha256').update(fixtureRaw).digest('hex');
console.log('FIXTURE_INPUT_SHA256=' + fixtureInputSha256 + ' bytes=' + fixtureRaw.length);

const owned = new Set();
function track(...pids) { for (const p of pids) if (p) owned.add(Number(p)); }
after(async () => {
  for (const p of owned) {
    try { process.kill(-p, 'SIGKILL'); } catch { /* */ }
    try { process.kill(p, 'SIGKILL'); } catch { /* */ }
  }
  await new Promise((r) => setTimeout(r, 50));
});

function psLinesFor(pids) {
  const table = spawnSync('/bin/ps', ['-A', '-o', 'pid=,ppid=,pgid=,lstart=,command='], {
    encoding: 'utf8', shell: false, env: { PATH: '', LANG: 'C' },
  });
  const want = new Set(pids.map(Number));
  return (table.stdout || '').split('\n').map((l) => l.trim()).filter((l) => {
    const m = l.match(/^(\d+)/);
    return m && want.has(Number(m[1]));
  });
}

async function measureGet(base) {
  const t0 = Date.now();
  const status = await new Promise((resolve, reject) => {
    http.get(base + '/cases', (res) => { res.resume(); resolve(res.statusCode); }).on('error', reject);
  });
  return { status, ms: Date.now() - t0 };
}

async function forkWorker(adapterId) {
  const registryPath = path.join(os.tmpdir(), 'raven-4p-' + process.pid + '-' + Date.now() + '-' + Math.random().toString(16).slice(2) + '.jsonl');
  fs.writeFileSync(registryPath, '', { mode: 0o600 });
  const child = fork(path.join(root, 'src/cases-exec-worker.mjs'), [], {
    cwd: root,
    detached: true,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    env: {
      ...process.env,
      RAVEN_CASES_WORKER: '1',
      RAVEN_OWNED_REGISTRY: registryPath,
      NODE_OPTIONS: [process.env.NODE_OPTIONS, '--import ' + hook].filter(Boolean).join(' '),
    },
  });
  track(child.pid);
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('ready timeout')), 8000);
    child.on('message', (m) => {
      if (m?.type === 'ready') {
        clearTimeout(t);
        child.send({
          type: 'exec', id: 'x', op: 'create-sdk',
          payload: { name: 'four-path', input_base64: fixtureB64, adapter_id: adapterId },
        });
        resolve();
      }
    });
    child.on('error', reject);
  });
  await new Promise((r) => setTimeout(r, 600));
  const reg = readOwnedRegistry(registryPath);
  const adapterIds = (reg.identities || []).filter((id) => id.pid && id.pid !== child.pid);
  assert.ok(adapterIds.length >= 1, 'registry must have complete adapter identity: ' + JSON.stringify(reg));
  for (const id of adapterIds) {
    assert.ok(identityComplete(id), 'adapter identity incomplete: ' + JSON.stringify(id));
    assert.ok(id.lstart && id.lstart.length > 0, 'adapter lstart must be nonempty');
  }
  const adapterPgids = [...new Set(adapterIds.map((i) => i.pgid))];
  const adapterPids = [...new Set(adapterIds.map((i) => i.pid))];
  track(...reg.pids, ...adapterPgids, ...adapterPids);
  return {
    child, registryPath, reg, adapterPgids, adapterPids, adapterIds,
    workerPid: child.pid,
    workerId: captureIdentity(child.pid),
    sampleLstart: adapterIds[0].lstart,
  };
}

function assertGone(label, pids) {
  const alive = pids.filter(pidAlive);
  assert.equal(alive.length, 0, label + ' leftovers: ' + alive + ' ps=' + psLinesFor(pids).join(' | '));
}

test('PATH1 normal completion: independent observations; nonempty lstart; GET; both gone', async () => {
  const s = createCasesServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + s.address().port;
  let snap = { all: [] };
  try {
    const { child, registryPath, reg, adapterPgids, adapterPids, workerPid, workerId, sampleLstart } =
      await forkWorker('example-parser-v1');
    snap = { all: [...new Set([workerPid, ...reg.pids, ...adapterPgids, ...adapterPids])] };
    const beforePs = psLinesFor(snap.all);
    const getDuring = [await measureGet(base)];
    await new Promise((resolve) => {
      const t = setTimeout(resolve, 15000);
      child.on('exit', () => { clearTimeout(t); resolve(); });
    });
    await cleanupOwnedSession(workerPid, { registryPath, termMs: 200, killMs: 200 });
    await new Promise((r) => setTimeout(r, 6000));
    getDuring.push(await measureGet(base));
    assertGone('path1', snap.all);
    assert.ok(getDuring.every((g) => g.status === 200 && g.ms < 500), JSON.stringify(getDuring));
    console.log('LINUX_FOUR_PATH normal_completion worker=' + workerPid
      + ' worker_pgid=' + (workerId && workerId.pgid)
      + ' adapter_pids=' + adapterPids.join(',')
      + ' adapter_pgids=' + adapterPgids.join(',')
      + ' sample_lstart=' + JSON.stringify(sampleLstart)
      + ' before_ps_n=' + beforePs.length
      + ' alive_at_plus6s=[]'
      + ' GET_ms=' + getDuring.map((g) => g.ms).join(',')
      + ' input_sha256=' + fixtureInputSha256);
    try { fs.unlinkSync(registryPath); } catch { /* */ }
  } finally {
    for (const p of snap.all) {
      try { process.kill(-p, 'SIGKILL'); } catch { /* */ }
      try { process.kill(p, 'SIGKILL'); } catch { /* */ }
    }
    await new Promise((r) => s.close(r));
  }
});

test('PATH2 forced deadline: gone @+6s; GET during cleanup; nonempty lstart', async () => {
  const s = createCasesServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + s.address().port;
  const { registryPath, reg, adapterPgids, adapterPids, workerPid, workerId, sampleLstart } =
    await forkWorker('control-hang-ignore-term');
  const all = [...new Set([workerPid, ...reg.pids, ...adapterPgids, ...adapterPids])];
  try {
    assert.ok(adapterPgids.every(pidAlive));
    const getDuring = [await measureGet(base)];
    const cleaned = await cleanupOwnedSession(workerPid, { registryPath, termMs: 400, killMs: 400 });
    getDuring.push(await measureGet(base));
    await new Promise((r) => setTimeout(r, 6000));
    assertGone('path2', all);
    assert.ok(getDuring.every((g) => g.status === 200 && g.ms < 500));
    console.log('LINUX_FOUR_PATH forced_deadline worker=' + workerPid
      + ' worker_pgid=' + (workerId && workerId.pgid)
      + ' adapter_pids=' + adapterPids.join(',')
      + ' adapter_pgids=' + adapterPgids.join(',')
      + ' sample_lstart=' + JSON.stringify(sampleLstart)
      + ' cleanup_pgids=' + cleaned.pgids.join(',')
      + ' alive_at_plus6s=[]'
      + ' GET_ms=' + getDuring.map((g) => g.ms).join(','));
  } finally {
    for (const p of all) {
      try { process.kill(-p, 'SIGKILL'); } catch { /* */ }
      try { process.kill(p, 'SIGKILL'); } catch { /* */ }
    }
    try { fs.unlinkSync(registryPath); } catch { /* */ }
    await new Promise((r) => s.close(r));
  }
});

test('PATH3 worker failure: adapter reparented then gone; GET; nonempty lstart', async () => {
  const s = createCasesServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + s.address().port;
  const { registryPath, reg, adapterPgids, adapterPids, workerPid, workerId, sampleLstart } =
    await forkWorker('control-hang-ignore-term');
  const adapterPid = adapterPids[0];
  const all = [...new Set([workerPid, adapterPid, ...reg.pids, ...adapterPgids])];
  try {
    const beforePs = psLinesFor([workerPid, adapterPid]);
    assert.ok(beforePs.length >= 2, 'ps must see worker+adapter');
    try { process.kill(-workerPid, 'SIGKILL'); } catch { /* */ }
    try { process.kill(workerPid, 'SIGKILL'); } catch { /* */ }
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(pidAlive(workerPid), false);
    assert.equal(pidAlive(adapterPid), true, 'adapter reparented alive');
    const getDuring = [await measureGet(base)];
    const cleaned = await cleanupOwnedSession(workerPid, { registryPath, termMs: 400, killMs: 400 });
    getDuring.push(await measureGet(base));
    assert.ok(
      cleaned.pgids.includes(adapterPid) || cleaned.identities.some((i) => i.pid === adapterPid),
      'cleanup must include adapter'
    );
    await new Promise((r) => setTimeout(r, 6000));
    assertGone('path3', all);
    assert.ok(getDuring.every((g) => g.status === 200 && g.ms < 500));
    console.log('LINUX_FOUR_PATH worker_failure worker=' + workerPid
      + ' worker_pgid=' + (workerId && workerId.pgid)
      + ' adapter_pid=' + adapterPid
      + ' sample_lstart=' + JSON.stringify(sampleLstart)
      + ' cleanup_pgids=' + cleaned.pgids.join(',')
      + ' alive_at_plus6s=[]'
      + ' GET_ms=' + getDuring.map((g) => g.ms).join(','));
  } finally {
    for (const p of all) {
      try { process.kill(-p, 'SIGKILL'); } catch { /* */ }
      try { process.kill(p, 'SIGKILL'); } catch { /* */ }
    }
    try { fs.unlinkSync(registryPath); } catch { /* */ }
    await new Promise((r) => s.close(r));
  }
});

test('PATH4 server shutdown: gone; GET during cleanup', async () => {
  const s = createCasesServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + s.address().port;
  let snapPids = [];
  try {
    const inflight = fetch(base + '/cases/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: base },
      body: JSON.stringify({
        name: 'p4-shutdown', input_base64: fixtureB64, adapter_id: 'control-hang-ignore-term',
      }),
    });
    await new Promise((r) => setTimeout(r, 700));
    const workerPgid = [...s._ravenLiveWorkers.keys()][0];
    assert.ok(workerPgid, 'expected live worker');
    const meta = s._ravenLiveWorkers.get(workerPgid);
    const reg = readOwnedRegistry(meta.registryPath);
    assert.ok(reg.identities.length >= 1, 'complete identities required');
    for (const id of reg.identities) assert.ok(identityComplete(id), JSON.stringify(id));
    const sampleLstart = reg.identities.find((i) => i.pid !== workerPgid)?.lstart || reg.identities[0].lstart;
    snapPids = [...new Set([workerPgid, ...reg.pids, ...reg.pgids])];
    track(...snapPids);
    const getDuring = [await measureGet(base)];
    const getP = measureGet(base);
    await s._ravenShutdownWorkers();
    const get = await getP;
    getDuring.push(get);
    assert.equal(get.status, 200);
    assert.ok(get.ms < 500, 'GET during shutdown too slow: ' + get.ms);
    try { await inflight; } catch { /* */ }
    await new Promise((r) => setTimeout(r, 6000));
    assertGone('path4', snapPids);
    console.log('LINUX_FOUR_PATH server_shutdown worker=' + workerPgid
      + ' adapter_pgids=' + reg.pgids.filter((g) => g !== workerPgid).join(',')
      + ' sample_lstart=' + JSON.stringify(sampleLstart)
      + ' alive_at_plus6s=[]'
      + ' GET_ms=' + getDuring.map((g) => g.ms).join(','));
  } finally {
    for (const p of snapPids) {
      try { process.kill(-p, 'SIGKILL'); } catch { /* */ }
      try { process.kill(p, 'SIGKILL'); } catch { /* */ }
    }
    await new Promise((r) => s.close(r));
  }
});

test('HOOK empty-PATH: real adapter identity has nonempty lstart', async () => {
  // Simulate watchdog env: PATH=''
  const registryPath = path.join(os.tmpdir(), 'raven-hookpath-' + process.pid + '-' + Date.now() + '.jsonl');
  fs.writeFileSync(registryPath, '', { mode: 0o600 });
  const child = fork(path.join(root, 'src/cases-exec-worker.mjs'), [], {
    cwd: root, detached: true, shell: false, stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    env: {
      ...process.env,
      PATH: '', // critical: same as SDK watchdog sanitized env
      RAVEN_CASES_WORKER: '1',
      RAVEN_OWNED_REGISTRY: registryPath,
      NODE_OPTIONS: '--import ' + hook,
    },
  });
  track(child.pid);
  try {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('ready timeout')), 8000);
      child.on('message', (m) => {
        if (m?.type === 'ready') {
          clearTimeout(t);
          child.send({
            type: 'exec', id: 'h', op: 'create-sdk',
            payload: { name: 'hook-path', input_base64: fixtureB64, adapter_id: 'control-hang-ignore-term' },
          });
          resolve();
        }
      });
      child.on('error', reject);
    });
    await new Promise((r) => setTimeout(r, 700));
    const raw = fs.readFileSync(registryPath, 'utf8');
    const lines = raw.split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const ids = lines.filter((e) => e.schema === 'raven-owned-identity/1');
    assert.ok(ids.length >= 1, 'expected identity records: ' + raw);
    for (const id of ids) {
      assert.ok(id.lstart && String(id.lstart).trim().length > 0, 'empty lstart under PATH="": ' + JSON.stringify(id));
      assert.ok(id.command && String(id.command).trim().length > 0, 'empty command');
    }
    console.log('LINUX_HOOK_EMPTY_PATH sample_lstart=' + JSON.stringify(ids[0].lstart)
      + ' command=' + JSON.stringify(ids[0].command).slice(0, 80)
      + ' n=' + ids.length);
    await cleanupOwnedSession(child.pid, { registryPath, termMs: 400, killMs: 400 });
  } finally {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* */ }
    try { process.kill(child.pid, 'SIGKILL'); } catch { /* */ }
    const reg = readOwnedRegistry(registryPath);
    for (const p of [...reg.pids, ...reg.pgids]) {
      try { process.kill(-p, 'SIGKILL'); } catch { /* */ }
      try { process.kill(p, 'SIGKILL'); } catch { /* */ }
    }
    try { fs.unlinkSync(registryPath); } catch { /* */ }
  }
});
