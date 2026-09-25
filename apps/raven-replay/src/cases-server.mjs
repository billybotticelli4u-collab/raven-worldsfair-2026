// Local HTTP wrapper for saved Replay cases. Authored by Claude; the case library (src/cases.mjs) is CODEX's.
// Billy 2 successor: SDK vendor binding, schema routing, forked exec worker + process-tree supervisor (D6).
// The library is not an HTTP security boundary, so this wrapper owns loopback, origin, request-size, body-time,
// concurrency and total-work limits. Every route it does not own is handed unchanged to the original prototype.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { fork } from 'node:child_process';
import path from 'node:path';
import { createServer } from './server.mjs';
import { NODE_VERSION } from './action.mjs';
import { parseCase, caseDigest, CaseError, MAX_CASE_BYTES, MAX_CASES } from './cases.mjs';
import { cleanupOwnedSession } from './process-supervisor.mjs';

const root = new URL('../', import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const WORKER_SCRIPT = path.join(here, 'cases-exec-worker.mjs');
const OBSERVE_HOOK = pathToFileURL(path.join(here, 'adapter-observe-hook.mjs')).href;
const SDK_ROOT = path.join(here, '..', 'vendor', 'raven-replay-parser-sdk');
const SDK_REGISTRY = path.join(SDK_ROOT, 'adapters', 'registry.json');

const SLACK = 16 * 1024;
export const CREATE_BODY_LIMIT = 128 * 1024;
// Transport envelope fits SDK case + JSON escape; legacy parse still enforces 128KiB per case.
export const IMPORT_BODY_LIMIT = 2 * (256 * 1024) + SLACK;
export const RUN_BODY_LIMIT = MAX_CASES * (256 * 1024) + SLACK;
export const BODY_TIMEOUT_MS = 10_000;
export const DEFAULT_WORK_BUDGET = Object.freeze({ max: 30, windowMs: 60_000 });
export const LEGACY_SCHEMA = 'raven-replay-case/1';
export const SDK_SCHEMA = 'raven-replay-adapter-case/1';

const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
const files = {
  '/cases': ['public/cases.html', 'text/html; charset=utf-8'],
  '/cases.js': ['public/cases.js', 'text/javascript; charset=utf-8'],
  '/cases-view.mjs': ['public/cases-view.mjs', 'text/javascript; charset=utf-8'],
  '/cases.css': ['public/cases.css', 'text/css; charset=utf-8'],
};
const routes = {
  '/cases/create': {
    limit: CREATE_BODY_LIMIT,
    shapes: [
      ['name', 'input_base64'],
      ['name', 'input_base64', 'adapter_id'],
    ],
  },
  '/cases/import': { limit: IMPORT_BODY_LIMIT, shapes: [['case_text']] },
  '/cases/run': {
    limit: RUN_BODY_LIMIT,
    shapes: [
      ['cases'],
      ['cases', 'references'],
      ['cases', 'detailed'],
      ['cases', 'references', 'detailed'],
    ],
  },
};

class RequestError extends Error {
  constructor(status, kind, message, retryAfter) {
    super(message);
    this.status = status;
    this.kind = kind;
    this.retryAfter = retryAfter;
  }
}
const refuse = (status, kind, message, retryAfter) => { throw new RequestError(status, kind, message, retryAfter); };
const plainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const sameKeys = (o, keys) => isDeepStrictEqual(Object.keys(o).sort(), [...keys].sort());

function readBody(req, limit, timeoutMs) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const settle = (error, text) => {
      clearTimeout(timer);
      req.removeAllListeners('data');
      req.removeAllListeners('end');
      req.removeAllListeners('error');
      if (error) reject(error);
      else resolve(text);
    };
    const timer = setTimeout(() => settle(new RequestError(408, 'TIMEOUT', 'Request body was not received in time')), timeoutMs);
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) return settle(new RequestError(413, 'TOO_LARGE', 'Request body exceeds limit'));
      chunks.push(chunk);
    });
    req.on('end', () => settle(null, Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => settle(new RequestError(400, 'REQUEST', 'Request body failed')));
  });
}

function workBudget({ max, windowMs }) {
  if (!Number.isInteger(max) || max < 1 || !Number.isInteger(windowMs) || windowMs < 1) throw new TypeError('Invalid work budget');
  let start = 0, used = 0;
  return {
    take(cost) {
      const now = Date.now();
      if (now - start >= windowMs) { start = now; used = 0; }
      if (used + cost > max) refuse(429, 'WORK_BUDGET', 'Local work budget used: at most ' + max + ' tool executions per ' +
        Math.round(windowMs / 1000) + ' s', Math.max(1, Math.ceil((start + windowMs - now) / 1000)));
      used += cost;
    },
    refund(cost) { used = Math.max(0, used - cost); },
  };
}

function loadSdkAdapters() {
  const reg = JSON.parse(fs.readFileSync(SDK_REGISTRY, 'utf8'));
  const adapters = Array.isArray(reg.adapters) ? reg.adapters : [];
  return adapters.map(a => ({
    id: a.id,
    label: a.label || a.id,
    schema: SDK_SCHEMA,
  }));
}

function caseSchemaOf(value) {
  return plainObject(value) && typeof value.schema === 'string' ? value.schema : null;
}

function mapReferences(references) {
  if (references === undefined) return undefined;
  return references.map(r => r === null ? undefined : r);
}

function workerDeadline(baseMs) {
  const override = Number(process.env.RAVEN_TEST_EXEC_DEADLINE_MS);
  if (Number.isFinite(override) && override > 0) return override;
  return baseMs;
}

function pathToSdk(rel) {
  return 'file://' + path.resolve(path.join(SDK_ROOT, 'src', rel));
}

export function createCasesServer({ workBudget: budgetLimits = DEFAULT_WORK_BUDGET, bodyTimeoutMs = BODY_TIMEOUT_MS } = {}) {
  const original = createServer().listeners('request')[0];
  if (typeof original !== 'function') throw new Error('Original prototype handler not found');
  const budget = workBudget(budgetLimits);
  let active = false;
  /** @type {Map<number, { pgid: number, child: import('node:child_process').ChildProcess }>} */
  const liveWorkers = new Map(); // key = leader pid (= pgid when detached)
  const cleanupDisabled = process.env.RAVEN_TEST_DISABLE_CLEANUP === '1';
  /** @type {object|null} */
  let lastCleanupNote = null;
  // R8: once stopping, no new owned work is started (R7-4).
  let stopping = false;
  // R8: every owned cleanup (per-run AND shutdown) is tracked until it settles, so a
  // cleanup already under way is awaited even after its worker left liveWorkers or its
  // client disconnected (R7-1).
  /** @type {Set<Promise<object>>} */
  const pendingCleanups = new Set();
  /** Failed/unknown cleanup results since start: possible survivors (R7-5). */
  const cleanupFailures = [];
  const trackCleanup = (promise) => {
    const tracked = Promise.resolve(promise)
      .catch((err) => ({ ok: false, unknown: true, reason: 'cleanup-reject', error: String(err && err.message || err) }))
      .then((r) => {
        if (r && (r.ok === false || r.unknown)) cleanupFailures.push(r);
        return r;
      })
      .finally(() => { pendingCleanups.delete(tracked); });
    pendingCleanups.add(tracked);
    return tracked;
  };
  const waitChildExit = (child, boundMs) => new Promise((resolve) => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return resolve();
    const t = setTimeout(resolve, boundMs);
    child.once('exit', () => { clearTimeout(t); resolve(); });
  });

  const shutdownWorkers = () => {
    const jobs = [];
    for (const [pid, meta] of [...liveWorkers.entries()]) {
      liveWorkers.delete(pid);
      if (!cleanupDisabled) {
        jobs.push(trackCleanup(
          Promise.resolve()
            .then(() => cleanupOwnedSession(meta.pgid, {
              termMs: 400, killMs: 400,
              registryPath: meta.registryPath || null,
            }))
            // Let the worker's own exit handler run (it may start a tracked per-run cleanup).
            .then((r) => waitChildExit(meta.child, 1000).then(() => r))
            .finally(() => {
              try { if (meta.registryPath) fs.unlinkSync(meta.registryPath); } catch { /* */ }
            })
        ));
      }
    }
    return Promise.all(jobs);
  };

  // R8: enter stopping state immediately; stop listening; drop idle sockets now.
  const beginStop = () => {
    stopping = true;
    try { server.close(); } catch { /* not listening */ }
    try { server.closeIdleConnections(); } catch { /* */ }
  };
  // R8: reconcile live workers and pending cleanups until no owned work remains.
  const drainOwned = async () => {
    for (let round = 0; round < 1000; round++) {
      shutdownWorkers();
      if (liveWorkers.size === 0 && pendingCleanups.size === 0) break;
      await Promise.allSettled([...pendingCleanups]);
    }
    return { failures: [...cleanupFailures], pending: pendingCleanups.size, live: liveWorkers.size };
  };

  const runInWorkerTracked = (op, payload, deadlineMs) => new Promise((resolve, reject) => {
    if (stopping) return reject(new RequestError(503, 'SHUTTING_DOWN', 'Server is shutting down; no new work accepted'));
    const registryPath = path.join(os.tmpdir(), 'raven-owned-' + process.pid + '-' + Date.now() + '-' + Math.random().toString(16).slice(2) + '.jsonl');
    try { fs.writeFileSync(registryPath, '', { mode: 0o600 }); } catch { /* */ }
    const nodeOpts = [process.env.NODE_OPTIONS, '--import ' + OBSERVE_HOOK].filter(Boolean).join(' ');
    const child = fork(WORKER_SCRIPT, [], {
      cwd: path.join(here, '..'),
      env: {
        ...process.env,
        RAVEN_CASES_WORKER: '1',
        RAVEN_OWNED_REGISTRY: registryPath,
        NODE_OPTIONS: nodeOpts,
      },
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      shell: false,
      detached: true, // own process group; pgid === pid on Unix
    });
    const pgid = child.pid;
    if (pgid) liveWorkers.set(pgid, { pgid, child, registryPath });
    let settled = false;
    const id = String(Date.now()) + '-' + Math.random().toString(16).slice(2);
    const finish = (err, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const meta = liveWorkers.get(pgid) || { pgid, registryPath: null };
      liveWorkers.delete(pgid);
      try { child.disconnect(); } catch { /* */ }
      // C1: snapshot PPID tree (worker→watchdog→adapter) THEN kill every PGID found.
      // Short grace on success; longer on forced stop/deadline. Async (setTimeout) so HTTP stays live.
      const grace = err
        ? { termMs: 400, killMs: 400 }
        : { termMs: 50, killMs: 100 };
      const cleanup = (!cleanupDisabled && pgid)
        ? trackCleanup(Promise.resolve()
            .then(() => cleanupOwnedSession(pgid, {
              ...grace,
              registryPath: meta.registryPath || null,
            }))
            .finally(() => {
              try { if (meta.registryPath) fs.unlinkSync(meta.registryPath); } catch { /* */ }
            }))
        : Promise.resolve({ ok: true });
      const done = (cleanupResult) => {
        // HTTP result still returned; cleanup unknown/failure is recorded on server for diagnostics.
        if (cleanupResult && (cleanupResult.unknown || cleanupResult.ok === false)) {
          lastCleanupNote = cleanupResult;
        }
        if (err) reject(err); else resolve(result);
      };
      cleanup.then(done, (e) => done({ ok: false, unknown: true, error: String(e) }));
    };
    const timer = setTimeout(() => {
      finish(new CaseError('RUN_ERROR', 'Execution deadline exceeded; worker terminated'));
    }, deadlineMs);
    child.on('error', () => finish(new CaseError('RUN_ERROR', 'Could not start execution worker')));
    child.on('exit', () => {
      liveWorkers.delete(pgid);
      if (!settled) finish(new CaseError('RUN_ERROR', 'Execution worker exited before result'));
    });
    child.on('message', (msg) => {
      if (!msg || msg.type === 'ready') {
        if (msg?.type === 'ready') child.send({ type: 'exec', id, op, payload });
        return;
      }
      // Optional ownership tips from worker (no vendor change required for C1 snapshot path)
      if (msg.type === 'own' && msg.id === id) {
        // Ownership tips optional; registry file is authoritative for adapters.
        return;
      }
      if (msg.type !== 'result' || msg.id !== id) return;
      if (msg.ok) finish(null, msg.data);
      else if (msg.kind === 'INVALID_CASE' || msg.kind === 'RUN_ERROR') {
        finish(new CaseError(msg.kind, msg.message || 'Worker refused'));
      } else finish(new CaseError('RUN_ERROR', msg.message || 'Worker failure'));
    });
  });

  const handlers = {
    '/cases/create': async payload => {
      budget.take(1);
      if (payload.adapter_id !== undefined) {
        if (typeof payload.adapter_id !== 'string') refuse(400, 'REQUEST', 'adapter_id must be a string');
        const adapters = loadSdkAdapters();
        if (!adapters.some(a => a.id === payload.adapter_id)) refuse(400, 'INVALID_CASE', 'Unknown adapter_id');
        const data = await runInWorkerTracked('create-sdk', {
          name: payload.name, input_base64: payload.input_base64, adapter_id: payload.adapter_id,
        }, workerDeadline(5000 + 2500 + 2000));
        return [200, data];
      }
      const data = await runInWorkerTracked('create-legacy', {
        name: payload.name, input_base64: payload.input_base64,
      }, workerDeadline(3000 + 2500 + 2000));
      return [200, data];
    },
    '/cases/import': async payload => {
      if (typeof payload.case_text !== 'string') refuse(400, 'REQUEST', 'case_text must be a string');
      const bytes = Buffer.byteLength(payload.case_text);
      if (bytes > 256 * 1024) refuse(400, 'INVALID_CASE', 'Case exceeds size limit');
      let value;
      try { value = JSON.parse(payload.case_text); }
      catch { refuse(400, 'INVALID_CASE', 'Malformed case JSON'); }
      const schema = caseSchemaOf(value);
      if (schema === LEGACY_SCHEMA) {
        if (bytes > MAX_CASE_BYTES) refuse(400, 'INVALID_CASE', 'Case exceeds size limit');
        value = parseCase(payload.case_text);
        return [200, { case: value, case_content_sha256: caseDigest(value) }];
      }
      if (schema === SDK_SCHEMA) {
        const sdk = await import(pathToSdk('cases.mjs'));
        const parsed = sdk.parseCase(payload.case_text);
        return [200, { case: parsed, case_content_sha256: sdk.caseDigest(parsed) }];
      }
      refuse(400, 'INVALID_CASE', 'Unsupported case schema');
    },
    '/cases/run': async payload => {
      const { cases, references, detailed } = payload;
      if (!Array.isArray(cases) || cases.length < 1 || cases.length > MAX_CASES) {
        refuse(400, 'INVALID_CASE', 'Supply between 1 and ' + MAX_CASES + ' cases');
      }
      if (references !== undefined && (!Array.isArray(references) || references.length !== cases.length ||
          !references.every(r => r === null || typeof r === 'string'))) {
        refuse(400, 'REQUEST', 'references must list one digest or null per case');
      }
      if (detailed !== undefined && typeof detailed !== 'boolean') refuse(400, 'REQUEST', 'detailed must be a boolean');
      const schemas = cases.map(caseSchemaOf);
      if (schemas.some(s => s !== schemas[0])) {
        refuse(400, 'INVALID_CASE', 'Mixed legacy/SDK batches are not supported; use a homogeneous batch');
      }
      const schema = schemas[0];
      if (schema !== LEGACY_SCHEMA && schema !== SDK_SCHEMA) {
        refuse(400, 'INVALID_CASE', 'Unsupported case schema');
      }
      if (detailed === true && schema !== SDK_SCHEMA) {
        refuse(400, 'REQUEST', 'detailed=true is only supported for SDK adapter-case batches');
      }
      budget.take(cases.length);
      const expectedCaseSha256s = mapReferences(references);
      try {
        if (schema === LEGACY_SCHEMA) {
          return [200, await runInWorkerTracked('run-legacy', { cases, expectedCaseSha256s },
            workerDeadline(cases.length * (3000 + 2500) + 3000))];
        }
        return [200, await runInWorkerTracked('run-sdk', {
          cases, expectedCaseSha256s, detailed: detailed === true,
        }, workerDeadline(cases.length * (5000 + 2500) + 3000))];
      } catch (error) {
        budget.refund(cases.length);
        throw error;
      }
    },
  };

  const server = http.createServer(async (req, res) => {
    const send = (status, data, type = 'application/json', extra = {}) => {
      if (res.headersSent) return;
      res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': CSP, ...extra });
      res.end(type === 'application/json' ? JSON.stringify(data) : data);
    };
    if (stopping) {
      // R8 (R7-4): stopping — refuse everything, including held keep-alive sockets.
      return send(503, { error: 'Server is shutting down', kind: 'SHUTTING_DOWN' }, 'application/json', { Connection: 'close' });
    }
    if (req.method === 'GET' && req.url === '/cases/adapters') {
      if (req.headers.host !== '127.0.0.1:' + req.socket.localPort) return send(403, { error: 'Loopback host required', kind: 'FORBIDDEN' });
      try {
        return send(200, { schema: 'raven-replay-adapter-list/1', adapters: loadSdkAdapters() });
      } catch {
        return send(500, { error: 'SDK registry unavailable', kind: 'INTERNAL' });
      }
    }
    const route = req.method === 'POST' && Object.hasOwn(routes, req.url) ? routes[req.url] : null;
    const page = req.method === 'GET' && Object.hasOwn(files, req.url) ? files[req.url] : null;
    if (!route && !page) return original(req, res);
    if (req.headers.host !== '127.0.0.1:' + req.socket.localPort) return send(403, { error: 'Loopback host required', kind: 'FORBIDDEN' });
    if (page) {
      let body;
      try { body = fs.readFileSync(new URL(page[0], root)); } catch { return send(404, { error: 'Not found', kind: 'NOT_FOUND' }); }
      return send(200, body, page[1]);
    }
    if (req.headers.origin !== 'http://127.0.0.1:' + req.socket.localPort || req.headers['content-type'] !== 'application/json')
      return send(403, { error: 'Same-origin JSON request required', kind: 'FORBIDDEN' });
    if (active) return send(429, { error: 'Another saved-case request is still running', kind: 'BUSY' }, 'application/json', { 'Retry-After': '1' });
    active = true;
    try {
      let payload;
      try { payload = JSON.parse(await readBody(req, route.limit, bodyTimeoutMs)); }
      catch (error) { if (error instanceof RequestError) throw error; refuse(400, 'REQUEST', 'Malformed JSON request'); }
      if (!plainObject(payload) || !route.shapes.some(keys => sameKeys(payload, keys)))
        refuse(400, 'REQUEST', 'Unsupported request fields');
      const [status, data] = await handlers[req.url](payload);
      send(status, data);
    } catch (error) {
      if (error instanceof RequestError) {
        const extra = error.retryAfter ? { 'Retry-After': String(error.retryAfter) } : error.status === 408 ? { Connection: 'close' } : {};
        send(error.status, { error: error.message, kind: error.kind }, 'application/json', extra);
      } else if (error instanceof CaseError) {
        send(error.kind === 'INVALID_CASE' ? 400 : 500, { error: error.message, kind: error.kind });
      } else send(500, { error: 'Unexpected local server failure', kind: 'INTERNAL' });
    } finally { active = false; }
  });

  server.on('close', () => { Promise.resolve(shutdownWorkers()).catch(() => {}); });
  // Process signals are owned by the CLI entrypoint (below) so cleanup is awaited
  // once; library users still get cleanup via server.close().
  // Expose for tests
  server._ravenShutdownWorkers = shutdownWorkers;
  server._ravenBeginStop = beginStop;
  server._ravenDrainOwned = drainOwned;
  server._ravenPendingCleanups = pendingCleanups;
  server._ravenCleanupFailures = cleanupFailures;
  server._ravenLiveWorkers = liveWorkers;
  server._ravenCleanupDisabled = cleanupDisabled;
  Object.defineProperty(server, '_ravenLastCleanup', {
    get: () => lastCleanupNote,
    set: (v) => { lastCleanupNote = v; },
  });
  return server;
}

/** Documented signal exits for a clean shutdown (128 + signal number). */
export const SIGNAL_EXIT_CODES = Object.freeze({ SIGHUP: 129, SIGINT: 130, SIGQUIT: 131, SIGTERM: 143 });
/** Held sockets (partial headers, silent TCP, slow bodies) are destroyed by this bound. */
export const HELD_SOCKET_BOUND_MS = 1000;

/** Concise possible-survivor list from failed/unknown cleanup results. Never claims "gone". */
export function describeCleanupFailures(failures) {
  const seen = new Map();
  const add = (pid, info) => {
    const n = Number(pid);
    if (!Number.isInteger(n) || n < 1 || seen.has(n)) return;
    seen.set(n, info);
  };
  for (const f of failures || []) {
    const ids = Array.isArray(f && f.identities) ? f.identities : [];
    const results = Array.isArray(f && f.results) ? f.results : [];
    results.forEach((r, i) => {
      if (!r || r.ok !== false) return;
      const id = i < ids.length ? ids[i] : (r.identity || null);
      const pid = (id && id.pid) || r.pid;
      // The cleanup root is a process-group leader: its members could not be enumerated.
      const group = !id && Number(pid) === Number(f.rootPid) ? ' (process group ' + pid + '; members unknown)' : '';
      add(pid, { pgid: id && id.pgid, reason: (r.reason || 'failed') + group, command: id && id.command });
    });
    if (f && f.reason && !results.length) add(f.rootPid, { reason: f.reason });
    if (seen.size === 0 && f && f.rootPid) add(f.rootPid, { reason: f.reason || (f.unknown ? 'unknown' : 'failed') });
  }
  const lines = ['raven-replay: shutdown cleanup could not confirm that owned processes are gone; exiting 1.'];
  const list = [...seen.entries()].slice(0, 20);
  if (!list.length) lines.push('  possibly still running: unknown (cleanup result had no process identity)');
  for (const [pid, info] of list) {
    const cmd = info.command ? String(info.command).slice(0, 120) : '';
    lines.push('  possibly still running: pid ' + pid + (info.pgid ? ' (pgid ' + info.pgid + ')' : '') +
      ' reason=' + info.reason + (cmd ? ' ' + cmd : ''));
  }
  if (seen.size > list.length) lines.push('  ... and ' + (seen.size - list.length) + ' more');
  return lines.join('\n') + '\n';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // Test-only cleanup bypass must never be accepted by the shipped CLI entrypoint.
  if (process.env.RAVEN_TEST_DISABLE_CLEANUP === '1') {
    console.error('raven-replay: refusing startup with RAVEN_TEST_DISABLE_CLEANUP=1; unset it before launching.');
    process.exit(2);
  }
  const port = Number(process.env.RAVEN_REPLAY_PORT || 8795);
  const server = createCasesServer();
  // CLI entrypoint (R8). On the FIRST of SIGINT/SIGTERM/SIGHUP/SIGQUIT:
  //  1. enter stopping state at once: refuse new work, stop listening, drop idle sockets;
  //  2. destroy any still-held sockets after HELD_SOCKET_BOUND_MS (never await server.close);
  //  3. await every owned cleanup (per-run and shutdown) until none remains;
  //  4. exit: failed/unknown cleanup => 1 with a possible-survivor list; else the signal code.
  // Repeated or mixed signals while stopping are ignored; cleanup continues. SIGKILL is
  // outside this guarantee.
  let stopPromise = null;
  const flushStderr = (text) => new Promise((resolve) => {
    const t = setTimeout(resolve, 500);
    process.stderr.write(text, () => { clearTimeout(t); resolve(); });
  });
  const stop = (signal) => {
    if (stopPromise) return stopPromise;
    const signalCode = SIGNAL_EXIT_CODES[signal] ?? 143;
    stopPromise = (async () => {
      let exitCode = signalCode;
      const bound = setTimeout(() => { try { server.closeAllConnections(); } catch { /* */ } }, HELD_SOCKET_BOUND_MS);
      try {
        server._ravenBeginStop();
        const { failures } = await server._ravenDrainOwned();
        if (failures.length) {
          exitCode = 1;
          await flushStderr(describeCleanupFailures(failures));
        }
      } catch (error) {
        exitCode = 1;
        await flushStderr('raven-replay: shutdown cleanup failed (' + (error && error.message ? error.message : error) +
          '); owned processes may still be running; exiting 1.\n');
      } finally {
        clearTimeout(bound);
        try { server.closeAllConnections(); } catch { /* */ }
        process.exit(exitCode);
      }
    })();
    return stopPromise;
  };
  for (const signal of Object.keys(SIGNAL_EXIT_CODES)) process.on(signal, () => { void stop(signal); });
  server.listen(port, '127.0.0.1', () => {
    const base = 'http://127.0.0.1:' + server.address().port;
    console.log('Raven Replay saved cases: ' + base + '/cases');
    console.log('Original capture/replay/challenge flow: ' + base + '/');
    if (process.version !== NODE_VERSION)
      console.log('Warning: this is Node ' + process.version + '. Creating or running cases reports RUN_ERROR until you use Node ' + NODE_VERSION + '.');
  });
}
