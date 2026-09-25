/**
 * Launcher/server shutdown (R7 base tests kept; R8 adds REVIEW12 R7-1..R7-5 + O4).
 * Actual launcher, own process group (killpg == terminal Ctrl-C / terminal close).
 * Independent /bin/ps observation of worker + watchdog + adapter before signalling;
 * sampler measures disappearance; unrelated + same-command decoys must survive;
 * all test-side kills re-check identity. RAVEN_SHUTDOWN_ROOT selects the tree under test
 * (R7 worktree for RED, throwaway mutant copies for negative controls).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ROOT, sleep, alive, psTable, rowOf, stillOwned, startLauncher, socketsOf, hungCreate, postCreate,
  observeHungTree, spawnDecoys, decoysSurvive, startSampler, awaitExit, reapAll, rawCreate,
  createOwnershipTracker, sameIdentity, spawnSameTreeBystander,
} from './support/shutdown-harness.mjs';

const EXIT = { SIGHUP: 129, SIGINT: 130, SIGQUIT: 131, SIGTERM: 143 };
const evidence = (o) => {
  console.log('R8_EVIDENCE ' + JSON.stringify(o));
  if (process.env.RAVEN_SHUTDOWN_EVIDENCE) fs.appendFileSync(process.env.RAVEN_SHUTDOWN_EVIDENCE, JSON.stringify(o) + '\n');
};
const idOf = (r) => r && ({ pid: r.pid, ppid: r.ppid, pgid: r.pgid, lstart: r.lstart, command: r.command });

/**
 * Hung-adapter scenario. schedule: [{ at: msAfterFirstSignal, sig, to: 'pg'|'pid' }]
 * pre(ctx): optional hook after observation, before first signal (e.g. drop client, wait).
 */
async function hungScenario(name, { env = {}, schedule, pre, boundMs = 12000, holdSockets = false } = {}) {
  const l = await startLauncher(env);
  const decoys = spawnDecoys();
  // Raw TCP client: ctrl.abort() genuinely drops the connection (like a killed curl/tab).
  const client = await rawCreate(l.port, { name: 'shutdown-' + name, adapter_id: 'control-hang-ignore-term', input_base64: 'AA==' });
  const ctrl = { abort: client.drop };
  const req = client.response;
  const tree = await observeHungTree(l.pid);
  const owned = tree ? [tree.worker, tree.watchdog, tree.adapter] : [];
  try {
    assert.ok(tree, name + ': worker+watchdog+adapter not observed');
    const loopback = socketsOf(l.pid);
    const httpDuring = (await fetch(l.url + '/cases').catch(() => ({ status: 'error' }))).status;
    const held = [];
    if (holdSockets) held.push(...(await openHeldSockets(l.port)));
    if (pre) await pre({ l, tree, ctrl });
    const t0 = Date.now();
    const sampler = startSampler(owned, t0);
    for (const step of schedule) {
      const wait = t0 + step.at - Date.now();
      if (wait > 0) await sleep(wait);
      try { process.kill(step.to === 'pid' ? l.pid : -l.pid, step.sig); } catch { /* already gone */ }
    }
    const ended = await awaitExit(l, boundMs);
    const exitMs = ended.at - t0;
    await sleep(300);
    await sampler.stop();
    await Promise.race([req, sleep(50)]);
    held.forEach((s) => s.destroy());
    const survivors = owned.filter(stillOwned).map((r) => r.pid);
    // R9: show reparenting of surviving launcher descendants (current ppid vs. ppid when first proven).
    const survivorRows = owned.filter(stillOwned).map((r) => ({ pid: r.pid, ppidWhenProven: r.ppid, ppidNow: (rowOf(r.pid) || {}).ppid }));
    const rec = {
      name, root: ROOT, schedule, exit: { code: ended.code, signal: ended.signal }, exitMs,
      before: { launcher: idOf(l.self), worker: idOf(tree.worker), watchdog: idOf(tree.watchdog), adapter: idOf(tree.adapter) },
      removedAtMs: Object.fromEntries(Object.entries(sampler.seen).map(([k, v]) => [k, v.firstGoneMs])),
      survivorsAfterExit: survivors, survivorRows, decoys: decoys.map(idOf), decoysSurvived: decoysSurvive(decoys),
      httpDuringRun: httpDuring, loopback, stderr: l.io.err.slice(-600),
    };
    evidence(rec);
    return rec;
  } finally {
    ctrl.abort();
    if (alive(l.pid)) reapAll([l.self]);   // spawned by this test
    reapOwnedPids(owned);                  // proven launcher descendants: by pid only, identity re-checked
    reapAll(decoys);                       // spawned by this test
  }
}

/** SIGKILL proven launcher descendants by pid only (never a process group), identity re-checked. */
function reapOwnedPids(recs) {
  for (const r of recs) if (r && stillOwned(r)) { try { process.kill(r.pid, 'SIGKILL'); } catch { /* gone */ } }
}

function assertClean(rec, expectCode) {
  assert.notEqual(rec.exit.code, 'TIMEOUT', rec.name + ': launcher did not exit in bound');
  assert.equal(rec.exit.code, expectCode, rec.name + ': exit ' + JSON.stringify(rec.exit) + ' stderr=' + rec.stderr);
  assert.deepEqual(rec.survivorsAfterExit, [], rec.name + ': owned processes survived launcher exit');
  const adapterGone = rec.removedAtMs[rec.before.adapter.pid];
  assert.ok(adapterGone !== null && adapterGone <= rec.exitMs + 50,
    rec.name + ': adapter not removed before exit (gone ' + adapterGone + ' ms, exit ' + rec.exitMs + ' ms)');
  assert.ok(rec.decoysSurvived, rec.name + ': a decoy was killed');
  assert.equal(rec.httpDuringRun, 200, rec.name + ': HTTP not responsive during run');
  if (rec.loopback.available) assert.deepEqual(rec.loopback.nonLoopback, [], rec.name + ': non-loopback socket');
}

async function openHeldSockets(port) {
  const partial = net.connect(port, '127.0.0.1');
  const empty = net.connect(port, '127.0.0.1');
  await Promise.all([partial, empty].map((s) => new Promise((r) => s.once('connect', r))));
  partial.write('GET /cases HTTP/1.1\r\nHost: 127.0.0.1:' + port + '\r\nX-Partial: ');
  [partial, empty].forEach((s) => s.on('error', () => {}));
  return [partial, empty];
}

// ---------------- base (kept from R7) ----------------
test('BASE Ctrl-C (SIGINT to process group): hung adapter removed; decoys survive', { timeout: 30000 }, async () => {
  assertClean(await hungScenario('ctrl-c', { schedule: [{ at: 0, sig: 'SIGINT', to: 'pg' }] }), 130);
});
test('BASE SIGTERM: hung adapter removed; decoys survive', { timeout: 30000 }, async () => {
  assertClean(await hungScenario('sigterm', { schedule: [{ at: 0, sig: 'SIGTERM', to: 'pid' }] }), 143);
});
test('BASE second signal during cleanup (TERM, TERM, INT)', { timeout: 30000 }, async () => {
  assertClean(await hungScenario('signal-during-cleanup', { schedule: [
    { at: 0, sig: 'SIGTERM', to: 'pid' }, { at: 200, sig: 'SIGTERM', to: 'pid' }, { at: 250, sig: 'SIGINT', to: 'pid' }] }), 143);
});

// ---------------- R7-1: cleanup already running, client disconnected ----------------
for (const [sig, at] of [['SIGINT', 1100], ['SIGTERM', 1500]]) {
  test(`R7-1 deadline cleanup in progress + client disconnected, ${sig} at +${at}ms: cleanup awaited`, { timeout: 30000 }, async () => {
    const rec = await hungScenario('r7-1-' + sig, {
      env: { RAVEN_TEST_EXEC_DEADLINE_MS: '1000' },
      pre: async ({ ctrl, tree }) => { ctrl.abort(); const w = tree.at + at - Date.now(); if (w > 0) await sleep(w); },
      schedule: [{ at: 0, sig, to: 'pg' }],
    });
    assertClean(rec, EXIT[sig]);
  });
}

// ---------------- R7-2: SIGHUP / SIGQUIT / repeated + mixed ----------------
const sequences = [
  ['SIGINT', 'SIGHUP'], ['SIGTERM', 'SIGHUP'], ['SIGHUP'], ['SIGQUIT'],
  ['SIGINT', 'SIGTERM'], ['SIGHUP', 'SIGINT'], ['SIGTERM', 'SIGQUIT'], ['SIGINT', 'SIGINT', 'SIGINT'],
  ['SIGQUIT', 'SIGHUP', 'SIGINT'], ['SIGINT', 'SIGHUP', 'SIGTERM', 'SIGQUIT'],
];
for (const seq of sequences) {
  test(`R7-2 signals ${seq.join('>')} to process group during cleanup: first signal wins, cleanup completes`, { timeout: 30000 }, async () => {
    const rec = await hungScenario('r7-2-' + seq.join('-'), { schedule: seq.map((sig, i) => ({ at: i * 300, sig, to: 'pg' })) });
    assertClean(rec, EXIT[seq[0]]);
  });
}

// ---------------- R7-3: held connections cannot block bounded shutdown ----------------
async function idleHeld(name, write, sig) {
  const l = await startLauncher();
  const decoys = spawnDecoys();
  const s = net.connect(l.port, '127.0.0.1');
  s.on('error', () => {});
  await new Promise((r) => s.once('connect', r));
  if (write) s.write(write);
  await sleep(150);
  const t0 = Date.now();
  try {
    process.kill(-l.pid, sig);
    const ended = await awaitExit(l, 8000);
    const rec = { name, root: ROOT, exit: { code: ended.code, signal: ended.signal }, exitMs: ended.at - t0,
      decoysSurvived: decoysSurvive(decoys), loopback: socketsOf(l.pid) };
    evidence(rec);
    return rec;
  } finally { s.destroy(); if (alive(l.pid)) reapAll([l.self]); reapAll(decoys); }
}
test('R7-3 partial request headers held: bounded exit', { timeout: 20000 }, async () => {
  const rec = await idleHeld('r7-3-partial-headers', 'GET /cases HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Slow: ', 'SIGINT');
  assert.equal(rec.exit.code, 130, JSON.stringify(rec)); assert.ok(rec.exitMs < 3000, 'exit took ' + rec.exitMs); assert.ok(rec.decoysSurvived);
});
test('R7-3 open TCP connection with no bytes held: bounded exit', { timeout: 20000 }, async () => {
  const rec = await idleHeld('r7-3-empty-tcp', null, 'SIGTERM');
  assert.equal(rec.exit.code, 143, JSON.stringify(rec)); assert.ok(rec.exitMs < 3000, 'exit took ' + rec.exitMs); assert.ok(rec.decoysSurvived);
});
test('R7-3 held sockets + hung adapter: cleanup completes, exit bounded', { timeout: 30000 }, async () => {
  const rec = await hungScenario('r7-3-held-plus-hung', { holdSockets: true, schedule: [{ at: 0, sig: 'SIGTERM', to: 'pid' }], boundMs: 8000 });
  assertClean(rec, 143);
  assert.ok(rec.exitMs < 5000, 'exit took ' + rec.exitMs);
});

// ---------------- R7-4: new work during shutdown refused; nothing escapes ----------------
// R9 (T-1): "escaped" = a Node process first observed as a DESCENDANT of this launcher (by the
// ownership tracker) that was not part of the pre-signal in-flight tree. Same-tree processes
// that are not launcher descendants (bystanders, other test files' servers) are never tracked,
// never reported and never signalled. Only tracked identities and processes this test spawned
// itself are reaped.
async function newWorkScenario(name, { bystanderBefore = false, bystanderAfter = false } = {}) {
  const l = await startLauncher();
  const decoys = spawnDecoys();
  const bystanders = [];
  if (bystanderBefore) bystanders.push(spawnSameTreeBystander());
  const tracker = createOwnershipTracker(l.pid, l.self);
  const req = hungCreate(l.url, name + '-inflight');
  const tree = await observeHungTree(l.pid);
  tracker.scan();
  const known = new Set(tree ? [tree.worker.pid, tree.watchdog.pid, tree.adapter.pid] : []);
  const raw = net.connect(l.port, '127.0.0.1');
  raw.on('error', () => {});
  await new Promise((r) => raw.once('connect', r));
  let rawResp = '';
  raw.on('data', (b) => { rawResp += b; });
  const escaped = new Map();
  const reparented = new Map();
  const statuses = [];
  let stopWatch = false;
  const watcher = (async () => {
    while (!stopWatch) {
      const rows = psTable();
      tracker.scan(rows);
      const byPid = new Map(rows.map((r) => [r.pid, r]));
      for (const [pid, o] of tracker.owned) {
        const live = byPid.get(pid);
        if (!sameIdentity(o.rec, live)) continue;
        if (live.ppid !== o.parentAtFirstSight && !reparented.has(pid)) reparented.set(pid, { pid, from: o.parentAtFirstSight, to: live.ppid });
        if (known.has(pid) || escaped.has(pid)) continue;
        if (o.rec.command.startsWith(process.execPath + ' ')) escaped.set(pid, o.rec); // owned Node work (not the server's ps reads)
      }
      await sleep(15);
    }
  })();
  const t0 = Date.now();
  try {
    assert.ok(tree, 'in-flight tree not observed');
    process.kill(-l.pid, 'SIGINT');
    if (bystanderAfter) bystanders.push(spawnSameTreeBystander()); // starts AFTER the signal: start time alone never implies ownership
    const body = JSON.stringify({ name: name + '-raw', adapter_id: 'control-hang-ignore-term', input_base64: 'AA==' });
    await sleep(40);
    raw.write('POST /cases/create HTTP/1.1\r\nHost: 127.0.0.1:' + l.port + '\r\nOrigin: ' + l.url +
      '\r\nContent-Type: application/json\r\nContent-Length: ' + Buffer.byteLength(body) + '\r\n\r\n' + body);
    const flood = [];
    for (let i = 0; i < 60 && Date.now() - t0 < 1500; i++) {
      const c = new AbortController();
      if (i % 2) setTimeout(() => c.abort(), 30); // S10b: client drops the new request
      flood.push(hungCreate(l.url, name + '-flood-' + i, { signal: c.signal }).then((r) => statuses.push(r.status || r.error)));
      await sleep(25);
    }
    await Promise.allSettled(flood);
    const ended = await awaitExit(l, 15000);
    await sleep(400);
    stopWatch = true; await watcher;
    await Promise.race([req, sleep(50)]);
    const escapedAlive = [...escaped.values()].filter(stillOwned).map((r) => r.pid);
    const rec = { name, root: ROOT, exit: { code: ended.code, signal: ended.signal }, exitMs: ended.at - t0,
      escapedSpawned: [...escaped.values()].map(idOf), escapedAliveAfterExit: escapedAlive,
      trackedOwned: tracker.records().map(idOf), reparentedWhileTracked: [...reparented.values()],
      statusCounts: statuses.reduce((a, s) => { a[s] = (a[s] || 0) + 1; return a; }, {}),
      acceptedCount: statuses.filter((s) => s === 200).length,
      rawResponseStatus: (rawResp.match(/^HTTP\/1\.1 (\d+)/) || [])[1] || (rawResp ? 'other' : 'none'),
      inflightSurvivors: [tree.worker, tree.watchdog, tree.adapter].filter(stillOwned).map((r) => r.pid),
      bystanders: bystanders.map((b) => ({ ...idOf(b), trackedAsOwned: tracker.isOwned(rowOf(b.pid)) || tracker.owned.has(b.pid),
        reportedEscaped: escaped.has(b.pid), aliveAfterTest: stillOwned(b) })),
      decoysSurvived: decoysSurvive(decoys) };
    evidence(rec);
    return rec;
  } finally {
    stopWatch = true; raw.destroy();
    if (alive(l.pid)) reapAll([l.self]);                 // spawned by this test
    const reapedOwned = tracker.reapOwned();              // proven launcher descendants only, by pid
    if (reapedOwned.length) console.log('R9_REAPED_OWNED ' + JSON.stringify(reapedOwned));
    reapAll([...decoys, ...bystanders]);                  // spawned by this test (after the record)
  }
}
function assertNewWorkRefused(rec) {
  assert.equal(rec.exit.code, 130, JSON.stringify(rec));
  assert.deepEqual(rec.escapedSpawned, [], 'new owned processes spawned after stop');
  assert.deepEqual(rec.escapedAliveAfterExit, [], 'escaped processes alive after exit');
  assert.equal(rec.acceptedCount, 0, 'a create was accepted during shutdown');
  assert.ok(['503', 'none'].includes(rec.rawResponseStatus), 'held keep-alive socket not refused: ' + rec.rawResponseStatus);
  assert.deepEqual(rec.inflightSurvivors, []);
  assert.ok(rec.decoysSurvived);
}
test('R7-4 new creates during shutdown (new connections + held keep-alive + dropped clients): refused, no new owned processes', { timeout: 40000 }, async () => {
  assertNewWorkRefused(await newWorkScenario('r7-4-new-work'));
});
test('T-1 same-tree bystanders (started before and after the signal, not launcher descendants) are never tracked, reported or signalled', { timeout: 40000 }, async () => {
  const rec = await newWorkScenario('t-1-bystander', { bystanderBefore: true, bystanderAfter: true });
  assert.equal(rec.bystanders.length, 2);
  for (const b of rec.bystanders) {
    assert.ok(b.command.includes(ROOT + '/'), 'bystander must run a script from the same tree: ' + b.command);
    assert.equal(b.trackedAsOwned, false, 'bystander tracked as launcher-owned: ' + b.pid);
    assert.equal(b.reportedEscaped, false, 'bystander reported as escaped: ' + b.pid);
    assert.equal(b.aliveAfterTest, true, 'bystander was signalled/killed: ' + b.pid);
  }
  assertNewWorkRefused(rec);
});
test('T-1 ownership tracker keeps a genuine descendant after it is reparented, and reaps only owned identities', { timeout: 30000 }, async () => {
  // Synthetic launcher: root -> middle -> detached grandchild; middle exits so the grandchild is
  // reparented (to init or a subreaper). A same-command twin started by this test is NOT a descendant.
  const grand = 'setInterval(()=>{},1000)//r9-reparent-probe ' + ROOT;
  const middle = `const {spawn}=require('child_process');const g=spawn(process.execPath,['-e',${JSON.stringify(grand)}],{detached:true,stdio:'ignore'});g.unref();setTimeout(()=>process.exit(0),700);`;
  const rootSrc = `const {spawn}=require('child_process');spawn(process.execPath,['-e',${JSON.stringify(middle)}],{stdio:'ignore'});setInterval(()=>{},1000);`;
  const rootProc = spawn(process.execPath, ['-e', rootSrc], { stdio: 'ignore', detached: true });
  const twin = spawn(process.execPath, ['-e', grand], { stdio: 'ignore', detached: true });
  let rootRow = null; let twinRow = null;
  for (let i = 0; i < 100 && !(rootRow && twinRow); i++) { rootRow = rowOf(rootProc.pid); twinRow = rowOf(twin.pid); await sleep(20); }
  const tracker = createOwnershipTracker(rootProc.pid, rootRow);
  let grandRec = null; let reparentedTo = null;
  try {
    const t0 = Date.now();
    while (Date.now() - t0 < 5000) {
      const rows = psTable();
      tracker.scan(rows);
      grandRec = grandRec || tracker.records().find((r) => r.command.includes(' -e setInterval(()=>{},1000)//r9-reparent-probe') && r.pid !== twin.pid);
      if (grandRec) {
        const live = rows.find((r) => r.pid === grandRec.pid);
        const middleAlive = rows.some((r) => r.pid === grandRec.ppid);
        if (live && live.ppid !== grandRec.ppid && !middleAlive) { reparentedTo = live.ppid; break; }
      }
      await sleep(20);
    }
    const rec = { name: 't-1-reparent', grandchild: grandRec && idOf(grandRec), reparentedTo,
      stillOwnedAfterReparent: grandRec ? tracker.isOwned(rowOf(grandRec.pid)) : false,
      twin: idOf(twinRow), twinOwned: tracker.isOwned(rowOf(twin.pid)) || tracker.owned.has(twin.pid) };
    const reaped = tracker.reapOwned();
    await sleep(200);
    rec.reaped = reaped; rec.grandchildGoneAfterReap = grandRec ? !stillOwned(grandRec) : false; rec.twinAliveAfterReap = stillOwned(twinRow);
    evidence(rec);
    assert.ok(grandRec, 'grandchild never observed as a launcher descendant');
    assert.ok(reparentedTo !== null && reparentedTo !== grandRec.ppid, 'grandchild was not reparented');
    assert.equal(rec.stillOwnedAfterReparent, true, 'tracker lost the reparented descendant');
    assert.ok(reaped.includes(grandRec.pid) && rec.grandchildGoneAfterReap, 'reparented descendant not reaped');
    assert.equal(rec.twinOwned, false, 'same-command twin (not a descendant) was tracked');
    assert.equal(rec.twinAliveAfterReap, true, 'same-command twin was signalled');
  } finally {
    reapAll([rootRow, twinRow].filter(Boolean)); // spawned by this test
    if (grandRec) reapOwnedPids([grandRec]); // proven descendant
  }
});

// ---------------- R7-5: failed/unknown cleanup exits 1 with survivor list ----------------
test('R7-5 unreadable process identity during shutdown: exit 1 + possible-survivor diagnostic (never "gone")', { timeout: 40000 }, async () => {
  const rec = await hungScenario('r7-5-unknown', { env: { RAVEN_TEST_PS_PATH: 'missing' }, schedule: [{ at: 0, sig: 'SIGTERM', to: 'pid' }], boundMs: 25000 });
  assert.equal(rec.exit.code, 1, 'unknown cleanup must exit 1, got ' + JSON.stringify(rec.exit));
  assert.match(rec.stderr, /could not confirm that owned processes are gone; exiting 1/);
  assert.match(rec.stderr, /possibly still running: pid \d+/);
  assert.doesNotMatch(rec.stderr, /cleanup (ok|complete)|all gone/i);
  assert.ok(rec.decoysSurvived);
});
test('R7-5 clean completion is not masked as failure: successful create then SIGINT exits 130, no diagnostic', { timeout: 30000 }, async () => {
  const l = await startLauncher();
  try {
    const b64 = Buffer.from(fs.readFileSync(path.join(ROOT, 'vendor/raven-replay-parser-sdk/fixtures/legacy-transaction.base64'), 'utf8').trim()).toString('base64');
    const r = await postCreate(l.url, { name: 'clean', input_base64: b64, adapter_id: 'example-parser-v1' });
    assert.equal(r.status, 200, JSON.stringify(r));
    await sleep(400);
    const t0 = Date.now();
    process.kill(-l.pid, 'SIGINT');
    const ended = await awaitExit(l, 8000);
    evidence({ name: 'r7-5-clean-not-masked', exit: ended.code, exitMs: ended.at - t0, stderr: l.io.err });
    assert.equal(ended.code, 130);
    assert.doesNotMatch(l.io.err, /possibly still running/);
  } finally { if (alive(l.pid)) reapAll([l.self]); }
});
test('R7-5 diagnostic formatter lists identities from failed results and never claims gone', async () => {
  const mod = await import(pathToFileURL(path.join(ROOT, 'src/cases-server.mjs')).href);
  assert.equal(typeof mod.describeCleanupFailures, 'function', 'describeCleanupFailures missing');
  const text = mod.describeCleanupFailures([{ ok: false, unknown: true, rootPid: 10,
    identities: [{ pid: 11, pgid: 11, lstart: 'x', command: 'node adapter.mjs' }],
    results: [{ ok: false, refused: true, reason: 'unreadable', unknown: true }, { ok: false, reason: 'unreadable', unknown: true, pid: 12 }] }]);
  assert.match(text, /pid 11 \(pgid 11\) reason=unreadable node adapter\.mjs/);
  assert.match(text, /pid 12 reason=unreadable/);
  assert.match(text, /exiting 1/);
  assert.deepEqual(mod.SIGNAL_EXIT_CODES, { SIGHUP: 129, SIGINT: 130, SIGQUIT: 131, SIGTERM: 143 });
});

// ---------------- O4: no shipped switch restoring the defective launcher ----------------
test('O4 shipped launcher/server contain no runtime switch restoring force-kill behaviour', () => {
  for (const rel of ['bin/raven-replay', 'src/cases-server.mjs']) {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.doesNotMatch(text, /RAVEN_LAUNCHER_LEGACY_FORCE_KILL/, rel);
    assert.doesNotMatch(text, /kill -KILL/, rel);
  }
});
