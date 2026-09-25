// R6: strict identity — per-field mismatch, empty fields refuse, unreadable ≠ gone.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  killProcessGroup, cleanupOwnedSession, pidAlive, captureIdentity,
  captureIdentityResult, safeSignalIdentity, killOwnedIdentity,
  killProcessGroupGuarded, identityComplete,
} from '../src/process-supervisor.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = path.join(root, 'test/fixtures/group-child.mjs');
const owned = [];

after(async () => {
  for (const p of owned) {
    try { process.kill(-p, 'SIGKILL'); } catch { /* */ }
    try { process.kill(p, 'SIGKILL'); } catch { /* */ }
  }
  await new Promise((r) => setTimeout(r, 50));
});

function readPids(pidfile) {
  if (!fs.existsSync(pidfile)) return [];
  return fs.readFileSync(pidfile, 'utf8').trim().split(/\n+/).filter(Boolean).map(Number);
}

async function spawnGroup(mode) {
  const pidfile = path.join(os.tmpdir(), `raven-sup-${process.pid}-${mode}-${Date.now()}.pids`);
  try { fs.unlinkSync(pidfile); } catch { /* */ }
  fs.writeFileSync(pidfile, '');
  const leader = spawn(process.execPath, [fixture, pidfile, mode], {
    stdio: 'ignore', shell: false, detached: true,
  });
  owned.push(leader.pid);
  await new Promise((r) => setTimeout(r, 250));
  const tracked = readPids(pidfile);
  owned.push(...tracked);
  return { leader, pgid: leader.pid, pidfile, tracked };
}

test('normal hang: group cleanup leaves zero survivors (independent pidfile check)', async () => {
  const { pgid, pidfile, tracked } = await spawnGroup('hang');
  assert.ok(tracked.length >= 1);
  assert.ok(tracked.every(pidAlive), 'fixture pids should be alive before cleanup');
  const t0 = Date.now();
  await killProcessGroup(pgid, { termMs: 300, killMs: 300 });
  const ms = Date.now() - t0;
  await new Promise((r) => setTimeout(r, 50));
  const survivors = tracked.filter(pidAlive);
  assert.equal(survivors.length, 0, 'survivors ' + survivors);
  console.log('LINUX_MEASURE normal_hang leftover=0 cleanup_ms=' + ms);
  try { fs.unlinkSync(pidfile); } catch { /* */ }
});

test('SIGTERM-resistant child dies by SIGKILL within bound', async () => {
  const { pgid, pidfile, tracked } = await spawnGroup('ignore-term');
  assert.ok(tracked.length >= 1 && tracked.every(pidAlive));
  const t0 = Date.now();
  await killProcessGroup(pgid, { termMs: 200, killMs: 400 });
  const ms = Date.now() - t0;
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(tracked.filter(pidAlive).length, 0);
  assert.ok(ms < 2000);
  console.log('LINUX_MEASURE ignore_term leftover=0 cleanup_ms=' + ms);
  try { fs.unlinkSync(pidfile); } catch { /* */ }
});

test('in-group grandchild cleaned with leader', async () => {
  const { pgid, pidfile, tracked } = await spawnGroup('spawn-child');
  assert.ok(tracked.length >= 2 && tracked.every(pidAlive));
  await killProcessGroup(pgid, { termMs: 300, killMs: 300 });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(tracked.filter(pidAlive).length, 0);
  console.log('LINUX_MEASURE in_group_grandchild leftover=0 tracked=' + tracked.length);
  try { fs.unlinkSync(pidfile); } catch { /* */ }
});

test('in-group SIGTERM-resistant grandchild cleaned by SIGKILL', async () => {
  const { pgid, pidfile, tracked } = await spawnGroup('spawn-child-ignore');
  assert.ok(tracked.length >= 2 && tracked.every(pidAlive));
  await killProcessGroup(pgid, { termMs: 200, killMs: 400 });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(tracked.filter(pidAlive).length, 0);
  console.log('LINUX_MEASURE resistant_grandchild leftover=0 tracked=' + tracked.length);
  try { fs.unlinkSync(pidfile); } catch { /* */ }
});

test('NEGATIVE CONTROL: without cleanup, pidfile pids remain alive; finally reaps', async () => {
  const { pgid, pidfile, tracked } = await spawnGroup('hang');
  assert.ok(tracked.every(pidAlive));
  await new Promise((r) => setTimeout(r, 400));
  const still = tracked.filter(pidAlive);
  assert.ok(still.length >= 1, 'negative control must observe leftovers when cleanup skipped');
  console.log('LINUX_MEASURE negative_no_cleanup leftovers=' + still.length);
  await cleanupOwnedSession(pgid, { termMs: 200, killMs: 200 });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(tracked.filter(pidAlive).length, 0, 'finally must clear');
  try { fs.unlinkSync(pidfile); } catch { /* */ }
});

test('documented limit: setsid escape survives single-group kill; finally clears by pidfile', async () => {
  const { pgid, pidfile, tracked } = await spawnGroup('setsid-escape');
  assert.ok(tracked.length >= 2 && tracked.every(pidAlive));
  await killProcessGroup(pgid, { termMs: 300, killMs: 300 });
  await new Promise((r) => setTimeout(r, 50));
  const survivors = tracked.filter(pidAlive);
  assert.ok(survivors.length >= 1, 'expected escaped survivor');
  console.log('LINUX_MEASURE setsid_escape survivors=' + survivors.length);
  for (const p of survivors) {
    try { process.kill(p, 'SIGKILL'); } catch { /* */ }
  }
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(tracked.filter(pidAlive).length, 0);
  try { fs.unlinkSync(pidfile); } catch { /* */ }
});

test('PER-FIELD MISMATCH: each wrong field refuses; target survives; finally reaps', async () => {
  const { leader, pidfile, tracked } = await spawnGroup('ignore-term');
  const real = captureIdentity(leader.pid);
  assert.ok(real && identityComplete(real), 'must capture complete live identity: ' + JSON.stringify(real));
  const cases = [
    { label: 'pgid', patch: { pgid: real.pgid === 1 ? 2 : 1 } },
    { label: 'lstart', patch: { lstart: 'Mon Jan  1 00:00:00 2000' } },
    { label: 'command', patch: { command: '/nonexistent/raven-mismatch-command' } },
    { label: 'empty-lstart', patch: { lstart: '' } },
    { label: 'empty-command', patch: { command: '' } },
    { label: 'substring-command', patch: { command: 'node' } },
  ];
  const results = [];
  for (const c of cases) {
    const fake = { ...real, ...c.patch };
    const term = await safeSignalIdentity(fake, 'SIGTERM');
    const kill = await safeSignalIdentity(fake, 'SIGKILL');
    const ownedKill = await killOwnedIdentity(fake, { termMs: 50, killMs: 50 });
    const survived = pidAlive(leader.pid);
    results.push({
      field: c.label,
      term_reason: term.reason,
      kill_reason: kill.reason,
      owned_refused: ownedKill.refused === true,
      survived,
    });
    assert.equal(term.signaled, false, c.label + ' TERM must refuse');
    assert.equal(kill.signaled, false, c.label + ' KILL must refuse');
    assert.equal(survived, true, c.label + ' must SURVIVE');
  }
  // pid pointing at unrelated live process (self)
  const wrongPid = {
    pid: process.pid,
    pgid: real.pgid,
    lstart: real.lstart,
    command: real.command,
  };
  const wp = await safeSignalIdentity(wrongPid, 'SIGKILL');
  assert.equal(wp.signaled, false);
  assert.equal(pidAlive(leader.pid), true);
  assert.equal(pidAlive(process.pid), true);
  results.push({ field: 'pid-unrelated', term_reason: wp.reason, survived: true });

  // positive control: exact identity kills
  const pos = await killOwnedIdentity(real, { termMs: 200, killMs: 200 });
  assert.equal(pos.ok, true);
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(pidAlive(leader.pid), false, 'positive control must kill');

  console.log('LINUX_MEASURE per_field_mismatch ' + JSON.stringify(results));
  for (const p of tracked) {
    try { process.kill(p, 'SIGKILL'); } catch { /* */ }
  }
  try { fs.unlinkSync(pidfile); } catch { /* */ }
});

test('UNREADABLE ps: cleanup reports not-successful; does not claim gone; target may survive', async () => {
  const { leader, pidfile, tracked } = await spawnGroup('hang');
  const real = captureIdentity(leader.pid);
  assert.ok(real && identityComplete(real));
  const prev = process.env.RAVEN_TEST_PS_PATH;
  process.env.RAVEN_TEST_PS_PATH = 'missing';
  try {
    const cap = captureIdentityResult(leader.pid);
    assert.equal(cap.status, 'unreadable', 'expected unreadable when ps missing: ' + JSON.stringify(cap));
    const kill = await killOwnedIdentity(real, { termMs: 50, killMs: 50 });
    assert.equal(kill.ok, false, 'must not report ok');
    assert.ok(kill.unknown || kill.reason === 'unreadable', 'must flag unreadable/unknown: ' + JSON.stringify(kill));
    assert.notEqual(kill.reason, 'gone');
    // Target still alive (could not verify → refuse to signal)
    assert.equal(pidAlive(leader.pid), true, 'unreadable must not kill as if gone');
    const cleaned = await cleanupOwnedSession(leader.pid, { termMs: 50, killMs: 50 });
    assert.equal(cleaned.ok, false);
    assert.ok(cleaned.unknown || cleaned.results.some((r) => r.reason === 'unreadable' || r.unknown));
    console.log('LINUX_MEASURE unreadable_ps ok=false unknown=true survived=1');
  } finally {
    if (prev === undefined) delete process.env.RAVEN_TEST_PS_PATH;
    else process.env.RAVEN_TEST_PS_PATH = prev;
    try { process.kill(-leader.pid, 'SIGKILL'); } catch { /* */ }
    try { process.kill(leader.pid, 'SIGKILL'); } catch { /* */ }
    for (const p of tracked) {
      try { process.kill(p, 'SIGKILL'); } catch { /* */ }
    }
    await new Promise((r) => setTimeout(r, 50));
    try { fs.unlinkSync(pidfile); } catch { /* */ }
  }
});

test('GONE vs UNREADABLE: ESRCH reports gone; missing ps reports unreadable', async () => {
  const gone = captureIdentityResult(99999999);
  assert.equal(gone.status, 'gone');
  const prev = process.env.RAVEN_TEST_PS_PATH;
  process.env.RAVEN_TEST_PS_PATH = 'missing';
  try {
    // Use our own pid — alive but ps unreadable
    const u = captureIdentityResult(process.pid);
    assert.equal(u.status, 'unreadable');
  } finally {
    if (prev === undefined) delete process.env.RAVEN_TEST_PS_PATH;
    else process.env.RAVEN_TEST_PS_PATH = prev;
  }
  console.log('LINUX_MEASURE gone_vs_unreadable ok');
});
