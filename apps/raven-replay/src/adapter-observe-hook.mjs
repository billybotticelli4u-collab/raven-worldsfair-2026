// Preloaded via NODE_OPTIONS --import into cases-exec-worker. Patches CJS
// child_process. Forwards observe hook ONLY into watchdog-exec.mjs children.
// Records COMPLETE detached adapter identity (pid,pgid,lstart,command).
// Uses absolute /bin/ps or /usr/bin/ps — never PATH (SDK watchdog has PATH='').
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { hrtime } from 'node:process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parsePsIdentityLine,
  identityComplete,
  normalizeIdentityText,
  resolvePsPath,
} from './process-identity.mjs';

const registryPath = process.env.RAVEN_OWNED_REGISTRY;
if (registryPath) {
  const require = createRequire(import.meta.url);
  const cp = require('child_process');
  const origSpawn = cp.spawn;
  const origSpawnSync = cp.spawnSync;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const hookUrl = pathToFileURL(path.join(here, 'adapter-observe-hook.mjs')).href;

  function append(entry) {
    try { fs.appendFileSync(registryPath, JSON.stringify(entry) + '\n', { mode: 0o600 }); }
    catch { /* */ }
  }

  function isNodeExec(file) {
    const f = String(file || '');
    return f === process.execPath || /(?:^|[/\\])node(?:\.exe)?$/i.test(f);
  }

  function argsIncludeWatchdog(args) {
    return (args || []).some((a) => String(a).includes('watchdog-exec.mjs'));
  }

  function forwardObserveEnv(env) {
    const e = { ...(env || process.env) };
    e.RAVEN_OWNED_REGISTRY = registryPath;
    const flag = '--import ' + hookUrl;
    const prev = e.NODE_OPTIONS || '';
    if (!String(prev).includes('adapter-observe-hook.mjs')) {
      e.NODE_OPTIONS = prev ? (prev + ' ' + flag) : flag;
    }
    return e;
  }

  function captureIdentitySync(pid) {
    const psPath = resolvePsPath();
    if (!psPath) return { status: 'unreadable', error: 'ps-not-found' };
    try {
      const r = origSpawnSync(psPath, ['-o', 'pid=,pgid=,lstart=,command=', '-p', String(pid)], {
        encoding: 'utf8',
        shell: false,
        env: { PATH: '', LANG: 'C', LC_ALL: 'C' },
      });
      if (r.error) return { status: 'unreadable', error: String(r.error.code || r.error.message) };
      const line = (r.stdout || '').trim();
      if (!line) {
        try {
          process.kill(pid, 0);
          return { status: 'unreadable', error: 'ps-empty-while-alive' };
        } catch (e) {
          if (e && e.code === 'ESRCH') return { status: 'gone' };
          return { status: 'unreadable', error: 'ps-empty' };
        }
      }
      const identity = parsePsIdentityLine(line);
      if (!identity) return { status: 'unreadable', error: 'ps-parse-failed' };
      return { status: 'ok', identity };
    } catch (e) {
      return { status: 'unreadable', error: 'ps-throw:' + (e && e.code ? e.code : String(e)) };
    }
  }

  function captureWithRetry(pid, attempts = 8, delayMs = 25) {
    let last = null;
    for (let i = 0; i < attempts; i++) {
      last = captureIdentitySync(pid);
      if (last.status === 'ok' && identityComplete(last.identity)) return last;
      if (last.status === 'gone') return last;
      // busy-wait briefly (sync hook context)
      const t0 = Date.now();
      while (Date.now() - t0 < delayMs) { /* spin */ }
    }
    return last || { status: 'unreadable', error: 'retry-exhausted' };
  }

  function record(childPid, file, args, options, sync) {
    if (!childPid) return;
    const detached = Boolean(options && options.detached);
    const cap = captureWithRetry(childPid);
    if (cap.status !== 'ok' || !identityComplete(cap.identity)) {
      append({
        schema: 'raven-owned-capture-failure/1',
        pid: childPid,
        detached,
        status: cap.status,
        error: cap.error || null,
        recordedAtMs: Date.now(),
        observerPid: process.pid,
        file: typeof file === 'string' ? file : String(file),
      });
      return; // never record incomplete identity (fail closed at record time)
    }
    let identity = {
      pid: cap.identity.pid,
      pgid: cap.identity.pgid,
      lstart: normalizeIdentityText(cap.identity.lstart),
      command: normalizeIdentityText(cap.identity.command),
    };
    // Detached leaders: pgid should equal pid; if ps shows otherwise keep ps truth
    // (do NOT invent empty fields). Only correct pgid when equal-or-leader convention holds.
    if (detached && identity.pid === childPid && identity.pgid !== childPid) {
      // Still require complete fields; keep observed pgid (exact match at signal time).
    }
    append({
      schema: 'raven-owned-spawn/1',
      pid: identity.pid,
      pgid: identity.pgid,
      detached,
      ppid: process.pid,
      file: typeof file === 'string' ? file : String(file),
      args0: Array.isArray(args) && args[0] ? String(args[0]) : null,
      sync: Boolean(sync),
      recordedAtMs: Date.now(),
      recordedMonoNs: hrtime.bigint().toString(),
      observerPid: process.pid,
      identity,
    });
    if (detached) {
      append({
        schema: 'raven-owned-identity/1',
        ...identity,
        recordedAtMs: Date.now(),
        observerPid: process.pid,
      });
      append({
        schema: 'raven-owned-group/1',
        pgid: identity.pgid,
        leaderPid: identity.pid,
        identity,
        recordedAtMs: Date.now(),
        observerPid: process.pid,
      });
    }
  }

  cp.spawn = function (file, args, options) {
    if (options === undefined && args && !Array.isArray(args) && typeof args === 'object') {
      options = args; args = undefined;
    }
    options = { ...(options || {}) };
    const child = origSpawn.call(this, file, args, options);
    try { record(child && child.pid, file, args, options, false); } catch { /* */ }
    return child;
  };

  cp.spawnSync = function (file, args, options) {
    if (options === undefined && args && !Array.isArray(args) && typeof args === 'object') {
      options = args; args = undefined;
    }
    options = { ...(options || {}) };
    if (isNodeExec(file) && argsIncludeWatchdog(args)) {
      options.env = forwardObserveEnv(options.env);
    }
    const result = origSpawnSync.call(this, file, args, options);
    try { if (result && result.pid) record(result.pid, file, args, options, true); } catch { /* */ }
    return result;
  };
}
