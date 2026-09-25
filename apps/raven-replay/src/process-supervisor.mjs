// Portable owned-process cleanup with STRICT identity gating (R6).
//
// Every signal is preceded by a FRESH complete identity read via absolute ps.
// Missing/empty fields refuse (never wildcards). Commands/lstart: exact normalize.
// Unreadable ps ≠ gone; cleanup reports failure/unknown, never success-as-gone.
//
// Residual (honest): TOCTOU between check and kill; lstart 1s granularity;
// same-second PID reuse with matching pgid+command can still pass.

import fs from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import {
  captureIdentityWith,
  identitiesMatch,
  identityComplete,
  normalizeIdentityText,
  resolvePsPath,
} from './process-identity.mjs';

export {
  identitiesMatch,
  identityComplete,
  normalizeIdentityText,
  resolvePsPath,
} from './process-identity.mjs';

export function pidAlive(pid) {
  const p = Number(pid);
  if (!Number.isInteger(p) || p < 1) return false;
  try { process.kill(p, 0); return true; } catch (e) {
    return !(e && (e.code === 'ESRCH' || e.errno === -3));
  }
}

/** @returns {object|null} identity on ok, else null (legacy helper) */
export function captureIdentity(pid) {
  const r = captureIdentityResult(pid);
  return r.status === 'ok' ? r.identity : null;
}

export function captureIdentityResult(pid) {
  return captureIdentityWith(spawnSync, pid);
}

/**
 * Signal one owned target. Refuses on incomplete, mismatch, or unreadable.
 */
export async function safeSignalIdentity(identity, sig) {
  if (!identityComplete(identity)) {
    return { signaled: false, reason: 'incomplete-identity', identity };
  }
  const recorded = {
    pid: Number(identity.pid),
    pgid: Number(identity.pgid),
    lstart: normalizeIdentityText(identity.lstart),
    command: normalizeIdentityText(identity.command),
  };
  const first = captureIdentityResult(recorded.pid);
  if (first.status === 'gone') return { signaled: false, reason: 'gone' };
  if (first.status === 'unreadable') {
    return { signaled: false, reason: 'unreadable', error: first.error };
  }
  if (!identitiesMatch(recorded, first.identity)) {
    return { signaled: false, reason: 'identity-mismatch', live: first.identity };
  }
  const second = captureIdentityResult(recorded.pid);
  if (second.status === 'gone') return { signaled: false, reason: 'gone' };
  if (second.status === 'unreadable') {
    return { signaled: false, reason: 'unreadable', error: second.error };
  }
  if (!identitiesMatch(recorded, second.identity)) {
    return { signaled: false, reason: 'identity-mismatch-recheck', live: second.identity };
  }
  try { process.kill(-recorded.pgid, sig); } catch { /* ESRCH */ }
  try { process.kill(recorded.pid, sig); } catch { /* ESRCH */ }
  return { signaled: true, pgid: recorded.pgid, pid: recorded.pid, sig };
}

/**
 * TERM then conditional KILL — each gated. Mismatch/incomplete/unreadable => not ok.
 */
export async function killOwnedIdentity(identity, { termMs = 400, killMs = 400 } = {}) {
  const t0 = Date.now();
  if (!identityComplete(identity)) {
    return {
      ok: false, refused: true, reason: 'incomplete-identity',
      elapsedMs: Date.now() - t0,
    };
  }
  const term = await safeSignalIdentity(identity, 'SIGTERM');
  if (!term.signaled) {
    if (term.reason === 'gone') {
      return { ok: true, refused: false, reason: 'gone', elapsedMs: Date.now() - t0, term };
    }
    if (term.reason === 'unreadable') {
      return {
        ok: false, refused: true, reason: 'unreadable', unknown: true,
        elapsedMs: Date.now() - t0, term,
      };
    }
    // identity-mismatch / incomplete
    return {
      ok: false, refused: true, reason: term.reason,
      elapsedMs: Date.now() - t0, term,
    };
  }
  await new Promise((r) => setTimeout(r, Math.max(0, termMs)));
  if (!pidAlive(identity.pid)) {
    return {
      ok: true, refused: false, elapsedMs: Date.now() - t0,
      term, kill: { signaled: false, reason: 'gone-after-term' },
    };
  }
  const kill = await safeSignalIdentity(identity, 'SIGKILL');
  if (!kill.signaled) {
    if (kill.reason === 'gone') {
      return { ok: true, refused: false, elapsedMs: Date.now() - t0, term, kill };
    }
    if (kill.reason === 'unreadable') {
      return {
        ok: false, refused: true, reason: 'unreadable', unknown: true,
        elapsedMs: Date.now() - t0, term, kill,
      };
    }
    return {
      ok: false, refused: true, reason: kill.reason,
      elapsedMs: Date.now() - t0, term, kill,
    };
  }
  await new Promise((r) => setTimeout(r, Math.max(0, killMs)));
  return { ok: true, refused: false, elapsedMs: Date.now() - t0, term, kill };
}

export function readProcessTable() {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (rows, err) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve(rows);
    };
    try {
      const psPath = resolvePsPath();
      if (!psPath) {
        finish([], new Error('ps-not-found'));
        return;
      }
      // R8: own process group so a terminal signal to the server's group cannot kill
      // this read; a ps that still dies or fails is an error (partial table != gone).
      const child = spawn(psPath, ['-A', '-o', 'pid=,ppid=,pgid='], {
        shell: false,
        detached: true,
        stdio: ['ignore', 'pipe', 'ignore'],
        env: { PATH: '', LANG: 'C', LC_ALL: 'C' },
      });
      let out = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (c) => { out += c; });
      child.on('error', (e) => finish([], e));
      child.on('close', (code, signal) => {
        if (signal || code !== 0) {
          finish([], new Error('ps-exit:' + (signal || code)));
          return;
        }
        const rows = [];
        for (const line of out.split('\n')) {
          const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)$/);
          if (!m) continue;
          rows.push({ pid: Number(m[1]), ppid: Number(m[2]), pgid: Number(m[3]) });
        }
        finish(rows);
      });
    } catch (e) {
      finish([], e);
    }
  });
}

export async function snapshotOwnedGroups(rootPid) {
  const root = Number(rootPid);
  if (!Number.isInteger(root) || root < 1) {
    return { rootPid: root, pids: [], pgids: [], rows: [], identities: [], unreadable: [] };
  }
  let table;
  try {
    table = await readProcessTable();
  } catch (e) {
    return {
      rootPid: root, pids: [], pgids: [], rows: [], identities: [],
      unreadable: [{ pid: root, error: String(e && e.message || e) }],
      tableError: e,
    };
  }
  const byParent = new Map();
  for (const row of table) {
    if (!byParent.has(row.ppid)) byParent.set(row.ppid, []);
    byParent.get(row.ppid).push(row);
  }
  const pids = [];
  const pgidSet = new Set();
  const rows = [];
  const stack = [root];
  const seen = new Set();
  const unreadable = [];
  if (pidAlive(root)) {
    pids.push(root);
    seen.add(root);
    const cap = captureIdentityResult(root);
    if (cap.status === 'ok') {
      pgidSet.add(cap.identity.pgid);
      rows.push({ pid: root, ppid: 0, pgid: cap.identity.pgid });
    } else if (cap.status === 'unreadable') {
      unreadable.push({ pid: root, error: cap.error });
      pgidSet.add(root);
      rows.push({ pid: root, ppid: 0, pgid: root });
    } else {
      pgidSet.add(root);
      rows.push({ pid: root, ppid: 0, pgid: root });
    }
  }
  while (stack.length) {
    const p = stack.pop();
    for (const child of byParent.get(p) || []) {
      if (seen.has(child.pid)) continue;
      seen.add(child.pid);
      pids.push(child.pid);
      pgidSet.add(child.pgid);
      rows.push(child);
      stack.push(child.pid);
    }
  }
  const identities = [];
  for (const pid of pids) {
    const cap = captureIdentityResult(pid);
    if (cap.status === 'ok') identities.push(cap.identity);
    else if (cap.status === 'unreadable') unreadable.push({ pid, error: cap.error });
  }
  return { rootPid: root, pids, pgids: [...pgidSet], rows, identities, unreadable };
}

export function readOwnedRegistry(registryPath) {
  if (!registryPath) return { pgids: [], pids: [], entries: [], identities: [], incomplete: [] };
  let text = '';
  try { text = fs.readFileSync(registryPath, 'utf8'); } catch {
    return { pgids: [], pids: [], entries: [], identities: [], incomplete: [] };
  }
  const entries = [];
  const pgids = new Set();
  const pids = new Set();
  const identities = [];
  const incomplete = [];
  const consider = (raw) => {
    if (!raw || !raw.pid) return;
    const id = {
      pid: Number(raw.pid),
      pgid: Number(raw.pgid),
      lstart: normalizeIdentityText(raw.lstart),
      command: normalizeIdentityText(raw.command),
    };
    if (identityComplete(id)) {
      identities.push(id);
      pgids.add(id.pgid);
      pids.add(id.pid);
    } else {
      incomplete.push(id);
    }
  };
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      entries.push(e);
      if (e.schema === 'raven-owned-identity/1') consider(e);
      if (e.schema === 'raven-owned-group/1' && e.identity) consider(e.identity);
      if (e.schema === 'raven-owned-spawn/1' && e.detached && e.identity) consider(e.identity);
    } catch { /* skip */ }
  }
  return { pgids: [...pgids], pids: [...pids], entries, identities, incomplete };
}

/**
 * Full session cleanup. Incomplete registry records are refused (not signalled).
 * Unreadable live captures => ok:false / unknown on that target.
 */
export async function cleanupOwnedSession(rootPid, {
  termMs = 400,
  killMs = 400,
  extraIdentities = [],
  registryPath = null,
} = {}) {
  let snap;
  try {
    snap = await snapshotOwnedGroups(rootPid);
  } catch (e) {
    return {
      rootPid: Number(rootPid),
      ok: false,
      unknown: true,
      reason: 'snapshot-failed',
      error: String(e && e.message || e),
      results: [],
      identities: [],
      pgids: [],
      elapsedMs: 0,
    };
  }
  const reg = readOwnedRegistry(registryPath);
  const byPid = new Map();
  for (const id of [...(snap.identities || []), ...(reg.identities || []), ...extraIdentities]) {
    if (!identityComplete(id)) continue;
    const prev = byPid.get(id.pid);
    // Prefer records already complete (all are); first wins unless replacing incomplete — N/A
    if (!prev) byPid.set(Number(id.pid), {
      pid: Number(id.pid),
      pgid: Number(id.pgid),
      lstart: normalizeIdentityText(id.lstart),
      command: normalizeIdentityText(id.command),
    });
  }
  if (pidAlive(rootPid) && !byPid.has(Number(rootPid))) {
    const cap = captureIdentityResult(rootPid);
    if (cap.status === 'ok') byPid.set(cap.identity.pid, cap.identity);
  }
  const identities = [...byPid.values()];
  const t0 = Date.now();
  const results = [];
  for (const id of identities) {
    results.push(await killOwnedIdentity(id, { termMs, killMs }));
  }
  // Incomplete registry entries: explicit refusal records (do not signal)
  for (const bad of (reg.incomplete || [])) {
    results.push({
      ok: false, refused: true, reason: 'incomplete-identity',
      identity: bad, elapsedMs: 0,
    });
  }
  for (const u of (snap.unreadable || [])) {
    results.push({
      ok: false, refused: true, reason: 'unreadable', unknown: true,
      pid: u.pid, error: u.error, elapsedMs: 0,
    });
  }
  const anyUnknown = results.some((r) => r.unknown || r.reason === 'unreadable');
  const anyFail = results.some((r) => r.ok === false);
  return {
    rootPid: Number(rootPid),
    snap,
    registry: reg,
    identities,
    results,
    pgids: identities.map((i) => i.pgid),
    elapsedMs: Date.now() - t0,
    ok: !anyFail && !anyUnknown && !snap.tableError,
    unknown: anyUnknown || Boolean(snap.tableError),
  };
}

/** @deprecated */
export async function killProcessGroup(pgid, opts = {}) {
  const leader = Number(opts.leaderPid || pgid);
  const cap = captureIdentityResult(leader);
  if (cap.status === 'gone') return { ok: false, reason: 'gone', pgid: Number(pgid) };
  if (cap.status === 'unreadable') {
    return { ok: false, refused: true, reason: 'unreadable', unknown: true, error: cap.error, pgid: Number(pgid) };
  }
  const id = cap.identity;
  if (Number(id.pgid) !== Number(pgid) && Number(pgid) !== leader) {
    return { ok: false, refused: true, reason: 'identity-mismatch', pgid: Number(pgid), live: id };
  }
  return killOwnedIdentity(id, opts);
}

/** @deprecated name */
export async function killProcessGroupGuarded(pgid, opts = {}) {
  return killProcessGroup(pgid, opts);
}

/** @deprecated */
export function killProcessTree(rootPid, opts) {
  return cleanupOwnedSession(rootPid, opts);
}

/** Legacy export — now requires complete live identity. */
export async function safeSignalGroup(expectedPgid, leaderPid, sig) {
  const cap = captureIdentityResult(leaderPid);
  if (cap.status === 'gone') return { signaled: false, reason: 'gone' };
  if (cap.status === 'unreadable') {
    return { signaled: false, reason: 'unreadable', error: cap.error };
  }
  if (Number(cap.identity.pgid) !== Number(expectedPgid)) {
    return { signaled: false, reason: 'pgid-mismatch', live: cap.identity };
  }
  return safeSignalIdentity({
    pid: Number(leaderPid),
    pgid: Number(expectedPgid),
    lstart: cap.identity.lstart,
    command: cap.identity.command,
  }, sig);
}

export function listDescendantPidsViaPs(rootPid) {
  return snapshotOwnedGroups(rootPid).then((s) => s.pids.filter((p) => p !== Number(rootPid)));
}

export async function currentPgid(pid) {
  const cap = captureIdentityResult(pid);
  return cap.status === 'ok' ? cap.identity.pgid : null;
}
