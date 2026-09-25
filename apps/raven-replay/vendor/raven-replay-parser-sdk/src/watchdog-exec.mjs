#!/usr/bin/env node
/**
 * Hard-deadline adapter executor (Unix process-group).
 * Parent may also apply an outer SIGKILL; this module guarantees the registered
 * child process group is SIGKILL'd when the deadline elapses even if the child
 * ignores SIGTERM. Not a security sandbox.
 *
 * Overflow of stdout OR stderr beyond the byte cap is a hard failure (exit 125),
 * even when a valid JSON prefix was already emitted. Captured bytes may still be
 * forwarded for diagnosis, but the parent must treat exit 125 as RUN_ERROR.
 *
 * Process-group cleanup runs on EVERY terminal path (success, overflow, timeout,
 * spawn error). Clearing the timer alone must never leave same-group descendants.
 *
 * argv: <timeout_ms> <entrypoint_abs>
 * stdin → child stdin; child stdout/stderr forwarded; exit:
 *   child exit code on clean exit (no overflow)
 *   124 on hard-deadline kill
 *   125 on stdout/stderr overflow
 *   1 on spawn error
 *   128 on other signals
 */
import { spawn } from 'node:child_process';

const timeoutMs = Number(process.argv[2]);
const entry = process.argv[3];
if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 600000 || typeof entry !== 'string' || !entry) {
  console.error('watchdog-exec: invalid args');
  process.exit(2);
}

const child = spawn(process.execPath, ['--no-warnings', entry], {
  stdio: ['pipe', 'pipe', 'pipe'],
  detached: true, // own process group on Unix — kill(-pid) reaps descendants we spawn
  env: process.env,
  cwd: process.cwd(),
});

const maxOut = Number(process.env.RAVEN_WATCHDOG_MAX_OUT || 65536);
const outChunks = [];
const errChunks = [];
let outBytes = 0;
let errBytes = 0;
let timedOut = false;
let stdoutOverflow = false;
let stderrOverflow = false;
let finished = false;
let groupReaped = false;

function killGroup(reason) {
  if (reason === 'timeout') timedOut = true;
  if (!child.pid || groupReaped) return;
  groupReaped = true;
  try { process.kill(-child.pid, 'SIGKILL'); } catch {
    try { child.kill('SIGKILL'); } catch { /* ignore */ }
  }
}

function finish(exitCode) {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  // ALWAYS reap the process group on every terminal path — including success —
  // so non-detached same-group descendants cannot survive parent completion.
  killGroup('terminal');
  try { process.stdout.write(Buffer.concat(outChunks)); } catch { /* ignore */ }
  try { process.stderr.write(Buffer.concat(errChunks)); } catch { /* ignore */ }
  process.exit(exitCode);
}

child.stdout.on('data', (c) => {
  outBytes += c.length;
  if (outBytes > maxOut) {
    stdoutOverflow = true;
    // Persist overflow state; stop storing further chunks; terminate group.
    killGroup('overflow');
    return;
  }
  outChunks.push(c);
});
child.stderr.on('data', (c) => {
  errBytes += c.length;
  if (errBytes > maxOut) {
    stderrOverflow = true;
    killGroup('overflow');
    return;
  }
  errChunks.push(c);
});

process.stdin.on('data', (c) => {
  try { if (child.stdin.writable) child.stdin.write(c); } catch { /* ignore */ }
});
process.stdin.on('end', () => {
  try { child.stdin.end(); } catch { /* ignore */ }
});
process.stdin.on('error', () => {});

const timer = setTimeout(() => killGroup('timeout'), timeoutMs);
timer.unref?.();

child.on('error', (err) => {
  console.error(String(err && err.message ? err.message : err));
  finish(1);
});
child.on('close', (code, signal) => {
  if (stdoutOverflow || stderrOverflow) {
    finish(125);
    return;
  }
  if (timedOut || signal === 'SIGKILL') {
    finish(124);
    return;
  }
  if (signal) {
    finish(128);
    return;
  }
  finish(code == null ? 1 : code);
});
