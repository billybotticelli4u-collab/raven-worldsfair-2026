// Test-only harness for launcher shutdown scenarios (R8). Not shipped runtime code.
// Independent observation uses /bin/ps directly; every test-side kill re-checks the
// recorded identity (pid + pgid + lstart + command) immediately before signalling.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ROOT = process.env.RAVEN_SHUTDOWN_ROOT ? path.resolve(process.env.RAVEN_SHUTDOWN_ROOT) : repoRoot;
export const LAUNCHER = path.join(ROOT, 'bin', 'raven-replay');
export const HANG_ADAPTER = path.join(ROOT, 'vendor/raven-replay-parser-sdk/adapters/example-parser/hang-ignore-term.mjs');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const PS = fs.existsSync('/bin/ps') ? '/bin/ps' : '/usr/bin/ps';

export function psTable() {
  const out = spawnSync(PS, ['-A', '-o', 'pid=', '-o', 'ppid=', '-o', 'pgid=', '-o', 'lstart=', '-o', 'command='],
    { encoding: 'utf8', env: { PATH: '', LANG: 'C', LC_ALL: 'C' } }).stdout || '';
  const rows = [];
  for (const line of out.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+\d+:\d+:\d+\s+\d+)\s+(.*)$/);
    if (m) rows.push({ pid: +m[1], ppid: +m[2], pgid: +m[3], lstart: m[4].replace(/\s+/g, ' '), command: m[5].trim() });
  }
  return rows;
}
export const rowOf = (pid) => psTable().find((r) => r.pid === pid) || null;
export const sameIdentity = (rec, live) => !!live && live.pid === rec.pid && live.pgid === rec.pgid &&
  live.lstart === rec.lstart && live.command === rec.command;
/** Alive AND still the same process (not a reused pid). */
export const stillOwned = (rec) => sameIdentity(rec, rowOf(rec.pid));

/** Identity-rechecked SIGKILL of a recorded process (and its group only if it leads it). */
export function reapChecked(rec) {
  if (!rec || !rec.pid) return false;
  if (!stillOwned(rec)) return false;
  try { if (rec.pgid === rec.pid) process.kill(-rec.pid, 'SIGKILL'); } catch { /* */ }
  try { process.kill(rec.pid, 'SIGKILL'); } catch { /* */ }
  return true;
}

export async function freePort() {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
}

export async function startLauncher(env = {}) {
  const port = await freePort();
  const child = spawn(LAUNCHER, ['--node', process.execPath, '--port', String(port)], {
    cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true, // own PG = terminal FG group
  });
  const io = { out: '', err: '' };
  child.stdout.on('data', (b) => { io.out += b; });
  child.stderr.on('data', (b) => { io.err += b; });
  const exit = new Promise((r) => child.once('exit', (code, signal) => r({ code, signal, at: Date.now() })));
  const t0 = Date.now();
  while (!/http:\/\/127\.0\.0\.1:\d+\/cases/.test(io.out) && Date.now() - t0 < 8000) await sleep(25);
  const m = io.out.match(/http:\/\/127\.0\.0\.1:(\d+)\/cases/);
  if (!m) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* */ } throw new Error('launcher did not start:\n' + io.out + io.err); }
  const url = 'http://127.0.0.1:' + m[1];
  const self = rowOf(child.pid);
  return { child, pid: child.pid, self, url, port: Number(m[1]), io, exit };
}

/** Loopback-only evidence: every TCP socket owned by pid has a 127.0.0.1 local address. */
export function socketsOf(pid) {
  const r = spawnSync('/usr/bin/ss', ['-Htanp'], { encoding: 'utf8' });
  if (r.status !== 0 && !r.stdout) return { available: false, lines: [] };
  const lines = (r.stdout || '').split('\n').filter((l) => l.includes('pid=' + pid + ','));
  const nonLoopback = lines.filter((l) => { const local = l.trim().split(/\s+/)[3] || ''; return !local.startsWith('127.0.0.1:'); });
  return { available: true, lines, nonLoopback };
}

export function postCreate(url, body, { signal } = {}) {
  return fetch(url + '/cases/create', {
    method: 'POST', headers: { Origin: url, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal,
  }).then(async (res) => ({ status: res.status, body: await res.text().catch(() => '') }))
    .catch((e) => ({ error: String(e && e.cause ? e.cause.code || e.cause : e) }));
}
export const hungCreate = (url, name, opts) => postCreate(url, { name, adapter_id: 'control-hang-ignore-term', input_base64: 'AA==' }, opts);

/** Find worker (child of server) + its SDK watchdog + detached hung adapter. */
export async function observeHungTree(serverPid, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = psTable();
    const worker = rows.find((r) => r.ppid === serverPid && r.command.includes('cases-exec-worker.mjs'));
    if (worker) {
      const watchdog = rows.find((r) => r.ppid === worker.pid && r.command.includes('watchdog-exec'));
      const adapter = watchdog && rows.find((r) => r.ppid === watchdog.pid && r.command.includes('hang-ignore-term.mjs'));
      if (watchdog && adapter) return { worker, watchdog, adapter, at: Date.now() };
    }
    await sleep(25);
  }
  return null;
}

/** Decoys: unrelated node loop + same-command adapter clone in its own PGID + sleep. */
export function spawnDecoys() {
  const procs = [
    spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore', detached: true }),
    spawn(process.execPath, ['--no-warnings', HANG_ADAPTER], { stdio: ['pipe', 'ignore', 'ignore'], detached: true }),
    spawn('/bin/sleep', ['300'], { stdio: 'ignore', detached: true }),
  ];
  procs.forEach((p) => p.unref());
  const t0 = Date.now();
  let recs = [];
  while (Date.now() - t0 < 2000) {
    recs = procs.map((p) => rowOf(p.pid));
    if (recs.every(Boolean)) break;
    spawnSync('/bin/sleep', ['0.02']);
  }
  return recs.filter(Boolean);
}
export const decoysSurvive = (decoys) => decoys.every(stillOwned);

/** Sample tracked identities every 25 ms until stop(); records last-seen time per pid. */
export function startSampler(recs, t0) {
  const seen = Object.fromEntries(recs.map((r) => [r.pid, { firstGoneMs: null }]));
  let stopFlag = false;
  const loop = (async () => {
    while (!stopFlag) {
      const rows = psTable();
      for (const r of recs) {
        const live = rows.find((x) => x.pid === r.pid);
        if (!sameIdentity(r, live) && seen[r.pid].firstGoneMs === null) seen[r.pid].firstGoneMs = Date.now() - t0;
      }
      await sleep(25);
    }
  })();
  return { seen, stop: async () => { stopFlag = true; await loop; } };
}

export async function awaitExit(l, boundMs) {
  return Promise.race([l.exit, sleep(boundMs).then(() => ({ code: 'TIMEOUT', signal: null, at: Date.now() }))]);
}

/** Final hygiene: identity-rechecked reap of everything recorded. */
export function reapAll(recs) {
  const reaped = [];
  for (const r of recs) if (r && reapChecked(r)) reaped.push(r.pid);
  return reaped;
}

/** Create over a raw TCP socket so the test can genuinely drop the client (FIN/RST), as a
 *  killed curl/browser tab would. Returns { socket, drop, response }. */
export async function rawCreate(port, body) {
  const socket = net.connect(port, '127.0.0.1');
  socket.on('error', () => {});
  await new Promise((r) => socket.once('connect', r));
  const json = JSON.stringify(body);
  let resp = '';
  socket.on('data', (b) => { resp += b; });
  const response = new Promise((r) => socket.once('close', () => r(resp)));
  socket.write('POST /cases/create HTTP/1.1\r\nHost: 127.0.0.1:' + port + '\r\nOrigin: http://127.0.0.1:' + port +
    '\r\nContent-Type: application/json\r\nContent-Length: ' + Buffer.byteLength(json) + '\r\nConnection: close\r\n\r\n' + json);
  return { socket, drop: () => socket.destroy(), response };
}

/**
 * R9 (Claude R8 review, T-1): ownership tracker. A process becomes owned ONLY when it is first
 * observed while its ppid chain reaches the launcher root (root identity verified) or an
 * already-owned live identity. Ownership is bound to the full identity recorded at that moment
 * (pid + pgid + lstart + command). A detached adapter therefore stays owned after it is reparented
 * to init or a subreaper, and a reused pid is never owned. Nothing is ever owned because of its
 * command line, working tree or start time alone.
 */
export function createOwnershipTracker(rootPid, rootRow = rowOf(rootPid)) {
  /** @type {Map<number, {rec: object, firstSeenAt: number, parentAtFirstSight: number}>} */
  const owned = new Map();
  const scan = (rows = psTable()) => {
    const byPid = new Map(rows.map((r) => [r.pid, r]));
    const anchors = new Set();
    if (rootRow && sameIdentity(rootRow, byPid.get(rootPid))) anchors.add(rootPid);
    for (const [pid, o] of owned) if (sameIdentity(o.rec, byPid.get(pid))) anchors.add(pid);
    for (let grew = true; grew;) {
      grew = false;
      for (const r of rows) {
        if (anchors.has(r.pid) || !anchors.has(r.ppid)) continue;
        anchors.add(r.pid);
        grew = true;
        const prev = owned.get(r.pid);
        if (!prev || !sameIdentity(prev.rec, r)) owned.set(r.pid, { rec: r, firstSeenAt: Date.now(), parentAtFirstSight: r.ppid });
      }
    }
    return owned;
  };
  /** Owned AND still the same live process. */
  const isOwned = (row) => { const o = row && owned.get(row.pid); return !!o && sameIdentity(o.rec, row); };
  const records = () => [...owned.values()].map((o) => o.rec);
  /** SIGKILL each owned identity that is still live, by pid only (never a process group). */
  const reapOwned = () => {
    const reaped = [];
    for (const rec of records()) {
      if (!stillOwned(rec)) continue;
      try { process.kill(rec.pid, 'SIGKILL'); reaped.push(rec.pid); } catch { /* gone */ }
    }
    return reaped;
  };
  return { scan, isOwned, records, reapOwned, owned };
}

/** Unrelated same-tree Node process (NOT a launcher descendant): the T-1 bystander control. */
export function spawnSameTreeBystander() {
  const p = spawn(process.execPath, ['--no-warnings', HANG_ADAPTER], { stdio: ['pipe', 'ignore', 'ignore'], detached: true });
  p.unref();
  let rec = null;
  for (let i = 0; i < 100 && !rec; i++) { rec = rowOf(p.pid); if (!rec) spawnSync('/bin/sleep', ['0.02']); }
  return rec;
}
