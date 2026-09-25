#!/usr/bin/env node
/**
 * Portable cleanup measurement (Linux + Darwin) — R3.
 *
 *   node scripts/measure-cleanup.mjs
 *   node scripts/measure-cleanup.mjs --json > cleanup-measure.json
 *
 * Exit 0 only if every required scenario passes and finally-cleanup left
 * zero tracked PIDs alive. setsid-escape MUST show survivors after group
 * kill (documented limit) then finally reap them by recorded PIDs.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { killProcessGroup, cleanupOwnedSession, pidAlive } from '../src/process-supervisor.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const fixture = path.join(root, 'test/fixtures/group-child.mjs');
const asJson = process.argv.includes('--json');

function readPids(pidfile) {
  if (!fs.existsSync(pidfile)) return [];
  return fs.readFileSync(pidfile, 'utf8').trim().split(/\n+/).filter(Boolean).map(Number);
}

function reapPids(pids) {
  for (const p of pids) {
    try { process.kill(-p, 'SIGKILL'); } catch { /* */ }
    try { process.kill(p, 'SIGKILL'); } catch { /* */ }
  }
}

async function scenario(name, mode, { expectLeftoverAfterGroupKill = false, useSessionCleanup = false } = {}) {
  const pidfile = path.join(os.tmpdir(), `raven-cleanup-${process.pid}-${name}.pids`);
  try { fs.unlinkSync(pidfile); } catch { /* */ }
  fs.writeFileSync(pidfile, '');
  const leader = spawn(process.execPath, [fixture, pidfile, mode], {
    stdio: 'ignore', shell: false, detached: true,
  });
  const pgid = leader.pid;
  await new Promise((r) => setTimeout(r, 250));
  const tracked = readPids(pidfile);
  if (tracked.length < 1) {
    reapPids([pgid]);
    throw new Error(name + ': tracked PIDs empty before cleanup (fixture failed)');
  }
  if (!tracked.every(pidAlive)) {
    reapPids(tracked.concat(pgid));
    throw new Error(name + ': tracked PIDs not all alive before cleanup');
  }
  const t0 = Date.now();
  if (useSessionCleanup) await cleanupOwnedSession(pgid, { termMs: 300, killMs: 300 });
  else await killProcessGroup(pgid, { termMs: 300, killMs: 300 });
  const elapsedMs = Date.now() - t0;
  await new Promise((r) => setTimeout(r, 50));
  const survivors = tracked.filter(pidAlive);
  const ok = expectLeftoverAfterGroupKill ? survivors.length >= 1 : survivors.length === 0;
  // ALWAYS finally reap independently recorded PIDs (including escapees)
  reapPids(tracked.concat([pgid]));
  await new Promise((r) => setTimeout(r, 50));
  const afterFinally = tracked.filter(pidAlive);
  try { fs.unlinkSync(pidfile); } catch { /* */ }
  return {
    name, mode, platform: process.platform, node: process.version, pgid, tracked,
    survivorsAfterGroupKill: survivors,
    leftoverAfterGroupKill: survivors.length,
    expectLeftoverAfterGroupKill,
    finallyLeftover: afterFinally.length,
    cleanupElapsedMs: elapsedMs,
    ok: ok && afterFinally.length === 0,
    error: !ok ? 'leftover mismatch' : (afterFinally.length ? 'finally leak' : null),
  };
}

const results = [];
let failed = false;
try {
  results.push(await scenario('hang', 'hang'));
  results.push(await scenario('ignore-term', 'ignore-term'));
  results.push(await scenario('spawn-child', 'spawn-child'));
  results.push(await scenario('spawn-child-ignore', 'spawn-child-ignore'));
  results.push(await scenario('setsid-escape', 'setsid-escape', { expectLeftoverAfterGroupKill: true }));
} catch (e) {
  failed = true;
  results.push({ name: 'abort', ok: false, error: String(e && e.message || e) });
}

const report = {
  platform: process.platform,
  arch: os.arch(),
  node: process.version,
  measured_on: process.platform === 'darwin' ? 'Darwin' : process.platform === 'linux' ? 'Linux' : process.platform,
  note: 'setsid-escape expects survivors after single-group kill; finally reaps by pidfile. Use cleanupOwnedSession for SDK adapter chains.',
  results,
  all_ok: results.every((r) => r.ok),
};
if (asJson) console.log(JSON.stringify(report, null, 2));
else {
  console.log('# measure-cleanup', report.measured_on, report.node, 'all_ok=' + report.all_ok);
  for (const r of results) {
    console.log(`${r.name}: ok=${r.ok} leftover_after_group=${r.leftoverAfterGroupKill} finally=${r.finallyLeftover} ms=${r.cleanupElapsedMs} err=${r.error || '-'}`);
  }
}
process.exit(report.all_ok && !failed ? 0 : 1);
