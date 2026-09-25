#!/usr/bin/env node
/**
 * R6 Darwin/Linux probe — four paths + mismatch + nonempty lstart + unreadable.
 * Exit nonzero on any failure.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fork, spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createCasesServer } from '../src/cases-server.mjs';
import {
  cleanupOwnedSession, captureIdentity, captureIdentityResult, killOwnedIdentity,
  killProcessGroupGuarded, pidAlive, readOwnedRegistry, safeSignalIdentity,
  identityComplete,
} from '../src/process-supervisor.mjs';

const asJson = process.argv.includes('--json');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const hook = pathToFileURL(path.join(root, 'src/adapter-observe-hook.mjs')).href;
const fixtureRaw = Buffer.from(
  fs.readFileSync(path.join(root, 'vendor/raven-replay-parser-sdk/fixtures/legacy-transaction.base64'), 'utf8').trim(),
  'base64'
);
const fixtureB64 = fixtureRaw.toString('base64');
const fixtureInputSha256 = crypto.createHash('sha256').update(fixtureRaw).digest('hex');
const groupFixture = path.join(root, 'test/fixtures/group-child.mjs');

function psFor(pids) {
  const r = spawnSync('/bin/ps', ['-A', '-o', 'pid=,ppid=,pgid='], {
    encoding: 'utf8', shell: false, env: { PATH: '', LANG: 'C' },
  });
  const want = new Set(pids.map(Number));
  return (r.stdout || '').split('\n').map((l) => l.trim()).filter((l) => {
    const m = l.match(/^(\d+)/);
    return m && want.has(Number(m[1]));
  });
}

async function measureGet(base) {
  const t0 = Date.now();
  const r = await fetch(base + '/cases');
  await r.text();
  return { status: r.status, ms: Date.now() - t0 };
}

async function forkHang(adapterId = 'control-hang-ignore-term', { emptyPath = false } = {}) {
  const registryPath = path.join(os.tmpdir(), 'raven-probe-' + process.pid + '-' + Date.now() + '-' + Math.random().toString(16).slice(2) + '.jsonl');
  fs.writeFileSync(registryPath, '');
  const env = {
    ...process.env, RAVEN_CASES_WORKER: '1', RAVEN_OWNED_REGISTRY: registryPath,
    NODE_OPTIONS: [process.env.NODE_OPTIONS, '--import ' + hook].filter(Boolean).join(' '),
  };
  if (emptyPath) env.PATH = '';
  const child = fork(path.join(root, 'src/cases-exec-worker.mjs'), [], {
    cwd: root, detached: true, shell: false, stdio: ['pipe', 'pipe', 'pipe', 'ipc'], env,
  });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('ready timeout')), 8000);
    child.on('message', (m) => {
      if (m?.type === 'ready') {
        clearTimeout(t);
        child.send({
          type: 'exec', id: 'p', op: 'create-sdk',
          payload: { name: 'probe', input_base64: fixtureB64, adapter_id: adapterId },
        });
        resolve();
      }
    });
    child.on('error', reject);
  });
  await new Promise((r) => setTimeout(r, 600));
  const reg = readOwnedRegistry(registryPath);
  return { child, registryPath, reg, workerPid: child.pid, workerId: captureIdentity(child.pid) };
}

const results = [];
let failed = false;
function push(r) {
  results.push(r);
  if (!r.ok) failed = true;
}

// PATH1
{
  const { child, registryPath, reg, workerPid, workerId } = await forkHang('example-parser-v1');
  const adapters = (reg.identities || []).filter((i) => i.pid !== workerPid);
  const tracked = [...new Set([workerPid, ...reg.pids, ...adapters.map((a) => a.pgid)])];
  const lstarts = adapters.map((a) => a.lstart);
  const before = psFor(tracked);
  await new Promise((resolve) => {
    const t = setTimeout(resolve, 15000);
    child.on('exit', () => { clearTimeout(t); resolve(); });
  });
  await cleanupOwnedSession(workerPid, { registryPath, termMs: 200, killMs: 200 });
  await new Promise((r) => setTimeout(r, 6000));
  const alive = tracked.filter(pidAlive);
  push({
    path: 'normal_completion', before_ps: before, workerPid, worker_pgid: workerId && workerId.pgid,
    adapter_pgids: adapters.map((a) => a.pgid), sample_lstart: lstarts[0] || null,
    lstarts_nonempty: lstarts.every((s) => s && String(s).trim()),
    alive_after_6s: alive, ok: alive.length === 0 && lstarts.length >= 1 && lstarts.every((s) => s && String(s).trim()),
  });
  try { fs.unlinkSync(registryPath); } catch { /* */ }
  for (const p of tracked) {
    try { process.kill(-p, 'SIGKILL'); } catch { /* */ }
    try { process.kill(p, 'SIGKILL'); } catch { /* */ }
  }
}

// PATH2
{
  const s = createCasesServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + s.address().port;
  const { registryPath, reg, workerPid, workerId } = await forkHang();
  const adapters = (reg.identities || []).filter((i) => i.pid !== workerPid);
  const tracked = [...new Set([workerPid, ...reg.pids, ...adapters.map((a) => a.pgid)])];
  const get1 = await measureGet(base);
  await cleanupOwnedSession(workerPid, { registryPath, termMs: 400, killMs: 400 });
  const get2 = await measureGet(base);
  await new Promise((r) => setTimeout(r, 6000));
  const alive = tracked.filter(pidAlive);
  push({
    path: 'forced_deadline', workerPid, worker_pgid: workerId && workerId.pgid,
    adapter_pgids: adapters.map((a) => a.pgid), sample_lstart: adapters[0] && adapters[0].lstart,
    alive_after_6s: alive, GET_ms: [get1.ms, get2.ms],
    ok: alive.length === 0 && adapters.length >= 1 && get1.status === 200 && get2.status === 200
      && get1.ms < 500 && get2.ms < 500 && identityComplete(adapters[0]),
  });
  try { fs.unlinkSync(registryPath); } catch { /* */ }
  for (const p of tracked) {
    try { process.kill(-p, 'SIGKILL'); } catch { /* */ }
    try { process.kill(p, 'SIGKILL'); } catch { /* */ }
  }
  await new Promise((r) => s.close(r));
}

// PATH3
{
  const s = createCasesServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + s.address().port;
  const { registryPath, reg, workerPid, workerId } = await forkHang();
  const adapters = (reg.identities || []).filter((i) => i.pid !== workerPid);
  const adapterPid = adapters[0] && adapters[0].pid;
  const before = psFor([workerPid, adapterPid]);
  try { process.kill(-workerPid, 'SIGKILL'); } catch { /* */ }
  try { process.kill(workerPid, 'SIGKILL'); } catch { /* */ }
  await new Promise((r) => setTimeout(r, 150));
  const adapterAliveAfterWorkerDeath = pidAlive(adapterPid);
  const get1 = await measureGet(base);
  await cleanupOwnedSession(workerPid, { registryPath, termMs: 400, killMs: 400 });
  const get2 = await measureGet(base);
  await new Promise((r) => setTimeout(r, 6000));
  const alive = [workerPid, adapterPid, ...reg.pids].filter(pidAlive);
  push({
    path: 'worker_failure', before_ps: before, workerPid, worker_pgid: workerId && workerId.pgid,
    adapter_pgid: adapterPid, sample_lstart: adapters[0] && adapters[0].lstart,
    adapter_alive_after_worker_sigkill: adapterAliveAfterWorkerDeath,
    alive_after_6s: alive, GET_ms: [get1.ms, get2.ms],
    ok: adapterAliveAfterWorkerDeath === true && alive.length === 0
      && get1.status === 200 && get2.status === 200 && get1.ms < 500 && get2.ms < 500,
  });
  try { fs.unlinkSync(registryPath); } catch { /* */ }
  for (const p of [workerPid, adapterPid, ...reg.pids]) {
    try { process.kill(-p, 'SIGKILL'); } catch { /* */ }
    try { process.kill(p, 'SIGKILL'); } catch { /* */ }
  }
  await new Promise((r) => s.close(r));
}

// PATH4
{
  const s = createCasesServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + s.address().port;
  const inflight = fetch(base + '/cases/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({ name: 'shutdown', input_base64: fixtureB64, adapter_id: 'control-hang-ignore-term' }),
  });
  await new Promise((r) => setTimeout(r, 700));
  const workerPgid = [...s._ravenLiveWorkers.keys()][0];
  const meta = s._ravenLiveWorkers.get(workerPgid);
  const reg = readOwnedRegistry(meta.registryPath);
  const tracked = [...new Set([workerPgid, ...reg.pids, ...reg.pgids])];
  const get1 = await measureGet(base);
  const getP = measureGet(base);
  await s._ravenShutdownWorkers();
  const get2 = await getP;
  try { await inflight; } catch { /* */ }
  await new Promise((r) => setTimeout(r, 6000));
  const alive = tracked.filter(pidAlive);
  push({
    path: 'server_shutdown', workerPid: workerPgid,
    adapter_pgids: reg.pgids.filter((g) => g !== workerPgid),
    sample_lstart: (reg.identities.find((i) => i.pid !== workerPgid) || reg.identities[0] || {}).lstart || null,
    GET_ms: [get1.ms, get2.ms], get_status: get2.status, alive_after_6s: alive,
    ok: alive.length === 0 && get2.status === 200 && get2.ms < 500 && reg.identities.length >= 1,
  });
  for (const p of tracked) {
    try { process.kill(-p, 'SIGKILL'); } catch { /* */ }
    try { process.kill(p, 'SIGKILL'); } catch { /* */ }
  }
  await new Promise((r) => s.close(r));
}

// MISMATCH per-field quick
{
  const pidfile = path.join(os.tmpdir(), 'raven-probe-mm-' + process.pid + '-' + Date.now() + '.pids');
  fs.writeFileSync(pidfile, '');
  const leader = spawn(process.execPath, [groupFixture, pidfile, 'ignore-term'], {
    stdio: 'ignore', shell: false, detached: true,
  });
  await new Promise((r) => setTimeout(r, 300));
  const real = captureIdentity(leader.pid);
  const fields = [
    { label: 'pgid', patch: { pgid: real.pgid === 1 ? 2 : 1 } },
    { label: 'lstart', patch: { lstart: 'Mon Jan  1 00:00:00 2000' } },
    { label: 'command', patch: { command: '/nonexistent/x' } },
    { label: 'empty-lstart', patch: { lstart: '' } },
    { label: 'empty-command', patch: { command: '' } },
  ];
  const fieldResults = [];
  let allSurvived = true;
  for (const f of fields) {
    const fake = { ...real, ...f.patch };
    const r = await safeSignalIdentity(fake, 'SIGKILL');
    const survived = pidAlive(leader.pid);
    fieldResults.push({ field: f.label, refused: !r.signaled, reason: r.reason, survived });
    if (r.signaled || !survived) allSurvived = false;
  }
  const guarded = await killProcessGroupGuarded(real.pgid === 1 ? 2 : 1, { leaderPid: leader.pid, termMs: 50, killMs: 50 });
  push({
    path: 'mismatch_control', fields: fieldResults, guarded_refused: Boolean(guarded.refused || guarded.ok === false),
    survived: pidAlive(leader.pid), ok: allSurvived && pidAlive(leader.pid),
  });
  try { process.kill(-leader.pid, 'SIGKILL'); } catch { /* */ }
  try { process.kill(leader.pid, 'SIGKILL'); } catch { /* */ }
  try { fs.unlinkSync(pidfile); } catch { /* */ }
}

// UNREADABLE
{
  const pidfile = path.join(os.tmpdir(), 'raven-probe-ur-' + process.pid + '-' + Date.now() + '.pids');
  fs.writeFileSync(pidfile, '');
  const leader = spawn(process.execPath, [groupFixture, pidfile, 'hang'], {
    stdio: 'ignore', shell: false, detached: true,
  });
  await new Promise((r) => setTimeout(r, 250));
  const real = captureIdentity(leader.pid);
  const prev = process.env.RAVEN_TEST_PS_PATH;
  process.env.RAVEN_TEST_PS_PATH = 'missing';
  let ur;
  try {
    const cap = captureIdentityResult(leader.pid);
    ur = await killOwnedIdentity(real, { termMs: 50, killMs: 50 });
    push({
      path: 'unreadable_ps',
      capture_status: cap.status,
      kill_ok: ur.ok,
      kill_reason: ur.reason,
      unknown: Boolean(ur.unknown),
      survived: pidAlive(leader.pid),
      ok: cap.status === 'unreadable' && ur.ok === false && pidAlive(leader.pid),
    });
  } finally {
    if (prev === undefined) delete process.env.RAVEN_TEST_PS_PATH;
    else process.env.RAVEN_TEST_PS_PATH = prev;
    try { process.kill(-leader.pid, 'SIGKILL'); } catch { /* */ }
    try { process.kill(leader.pid, 'SIGKILL'); } catch { /* */ }
    try { fs.unlinkSync(pidfile); } catch { /* */ }
  }
}

// EMPTY-PATH hook capture
{
  const { registryPath, reg, workerPid } = await forkHang('control-hang-ignore-term', { emptyPath: true });
  const adapters = (reg.identities || []).filter((i) => i.pid !== workerPid);
  const ok = adapters.length >= 1 && adapters.every((a) => identityComplete(a));
  push({
    path: 'hook_empty_path_lstart',
    sample_lstart: adapters[0] && adapters[0].lstart,
    n: adapters.length,
    ok,
  });
  await cleanupOwnedSession(workerPid, { registryPath, termMs: 400, killMs: 400 });
  try { fs.unlinkSync(registryPath); } catch { /* */ }
  for (const a of adapters) {
    try { process.kill(-a.pid, 'SIGKILL'); } catch { /* */ }
    try { process.kill(a.pid, 'SIGKILL'); } catch { /* */ }
  }
  try { process.kill(-workerPid, 'SIGKILL'); } catch { /* */ }
}

const report = {
  platform: process.platform,
  node: process.version,
  measured_on: process.platform === 'darwin' ? 'Darwin' : 'Linux',
  input_sha256: fixtureInputSha256,
  input_bytes: fixtureRaw.length,
  note: 'R6: absolute ps; no wildcard empty fields; exact command/lstart match; unreadable≠gone.',
  results,
  all_ok: results.every((r) => r.ok) && !failed,
};
if (asJson) console.log(JSON.stringify(report, null, 2));
else {
  console.log('# probe-sdk-adapter-cleanup', report.measured_on, 'all_ok=' + report.all_ok);
  for (const r of results) console.log(JSON.stringify(r));
}
process.exit(report.all_ok ? 0 : 1);
