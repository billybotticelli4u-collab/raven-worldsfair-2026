// Shared portable process identity: absolute ps path, strict fields, exact match.
// Normalization: trim + collapse internal whitespace to single spaces.
// Residual: TOCTOU between check and kill; lstart is 1s granularity (PID reuse within
// the same second with same pgid+command can still pass).

import fs from 'node:fs';

export function normalizeIdentityText(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

/** Resolve portable absolute ps. Prefer /bin/ps then /usr/bin/ps. Never rely on PATH. */
export function resolvePsPath() {
  // Test hook: force unreadable / alternate binary without editing production callers.
  if (process.env.RAVEN_TEST_PS_PATH === 'missing') return null;
  if (process.env.RAVEN_TEST_PS_PATH) return process.env.RAVEN_TEST_PS_PATH;
  for (const p of ['/bin/ps', '/usr/bin/ps']) {
    try {
      if (fs.existsSync(p)) return p;
    } catch { /* continue */ }
  }
  return null;
}

/**
 * Parse one `ps -o pid=,pgid=,lstart=,command=` line.
 * Returns null if parse fails (caller treats as unreadable).
 */
export function parsePsIdentityLine(line) {
  const raw = String(line || '').trim();
  if (!raw) return null;
  // lstart: "Wed Sep 24 15:30:01 2026" (5 tokens) on Linux + Darwin
  const m = raw.match(/^(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+\d+:\d+:\d+\s+\d+)\s+(.*)$/);
  if (!m) return null;
  const identity = {
    pid: Number(m[1]),
    pgid: Number(m[2]),
    lstart: normalizeIdentityText(m[3]),
    command: normalizeIdentityText(m[4]),
  };
  if (!identityComplete(identity)) return null;
  return identity;
}

/** All four fields required and nonempty (after normalize). */
export function identityComplete(id) {
  if (!id || typeof id !== 'object') return false;
  const pid = Number(id.pid);
  const pgid = Number(id.pgid);
  if (!Number.isInteger(pid) || pid < 1) return false;
  if (!Number.isInteger(pgid) || pgid < 1) return false;
  const lstart = normalizeIdentityText(id.lstart);
  const command = normalizeIdentityText(id.command);
  if (!lstart || !command) return false;
  return true;
}

/** Exact normalized equality on all four fields. Incomplete either side => false. */
export function identitiesMatch(recorded, live) {
  if (!identityComplete(recorded) || !identityComplete(live)) return false;
  if (Number(recorded.pid) !== Number(live.pid)) return false;
  if (Number(recorded.pgid) !== Number(live.pgid)) return false;
  if (normalizeIdentityText(recorded.lstart) !== normalizeIdentityText(live.lstart)) return false;
  if (normalizeIdentityText(recorded.command) !== normalizeIdentityText(live.command)) return false;
  return true;
}

/**
 * Capture via provided spawnSync (hook passes orig; supervisor passes node spawnSync).
 * Distinguishes gone vs unreadable.
 *
 * @returns {{ status: 'ok', identity: object }
 *         | { status: 'gone', error?: string }
 *         | { status: 'unreadable', error: string }}
 */
export function captureIdentityWith(spawnSyncFn, pid) {
  const p = Number(pid);
  if (!Number.isInteger(p) || p < 1) {
    return { status: 'unreadable', error: 'invalid-pid' };
  }
  // Liveness first: ESRCH => gone; other errors => still try ps, but note
  let alive = false;
  try {
    process.kill(p, 0);
    alive = true;
  } catch (e) {
    if (e && (e.code === 'ESRCH' || e.errno === -3)) {
      return { status: 'gone', error: 'ESRCH' };
    }
    // EPERM etc.: process may exist; continue to ps
  }
  const psPath = resolvePsPath();
  if (!psPath) {
    return { status: 'unreadable', error: 'ps-not-found' };
  }
  let r;
  // R8: a terminal signal delivered to the server's process group (Ctrl-C, Ctrl-\\,
  // terminal close) also reaches this ps child. Retry a signal-killed read a few
  // times; if it keeps dying, report unreadable (never gone).
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      r = spawnSyncFn(psPath, ['-o', 'pid=,pgid=,lstart=,command=', '-p', String(p)], {
        encoding: 'utf8',
        shell: false,
        env: { PATH: '', LANG: 'C', LC_ALL: 'C' },
      });
    } catch (e) {
      return { status: 'unreadable', error: 'ps-exec-throw:' + (e && e.code ? e.code : String(e)) };
    }
    if (!r || !r.signal) break;
  }
  if (r.error) {
    return { status: 'unreadable', error: 'ps-error:' + (r.error.code || r.error.message || 'unknown') };
  }
  if (r.signal) {
    return { status: 'unreadable', error: 'ps-signal:' + r.signal };
  }
  const out = (r.stdout || '').trim();
  if (!out) {
    // Empty stdout: if not alive => gone; if alive => unreadable/parse
    if (!alive) return { status: 'gone', error: 'ps-empty-and-esrch' };
    // Re-check liveness
    try {
      process.kill(p, 0);
      return { status: 'unreadable', error: 'ps-empty-while-alive' };
    } catch (e) {
      if (e && (e.code === 'ESRCH' || e.errno === -3)) return { status: 'gone', error: 'ps-empty' };
      return { status: 'unreadable', error: 'ps-empty-liveness-unknown' };
    }
  }
  const identity = parsePsIdentityLine(out);
  if (!identity) {
    return { status: 'unreadable', error: 'ps-parse-failed:' + out.slice(0, 120) };
  }
  if (identity.pid !== p) {
    return { status: 'unreadable', error: 'ps-pid-mismatch' };
  }
  return { status: 'ok', identity };
}
