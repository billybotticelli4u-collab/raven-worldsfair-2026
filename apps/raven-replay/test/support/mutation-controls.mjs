#!/usr/bin/env node
// R8 negative controls (test-side only; nothing shipped is switchable).
// Each mutant is a THROWAWAY copy of the tree under test in a temp dir with one
// fix reverted by text patch. The matching test group must go RED on the mutant.
// A zero-mutation copy must stay GREEN (proves the copy itself is sound).
// Usage: node test/support/mutation-controls.mjs [outJson]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// R9: the test directory is copied too, and the COPY's test file is run from the copy
// (cwd = copy, relative path), so test-side mutants (M7, M8) patch only the throwaway copy.
function copyTree(dst) {
  for (const ent of fs.readdirSync(REPO, { withFileTypes: true })) {
    if (['.git', 'node_modules'].includes(ent.name)) continue;
    const src = path.join(REPO, ent.name);
    if (ent.name === 'vendor') { fs.symlinkSync(src, path.join(dst, 'vendor')); continue; } // vendor never mutated
    fs.cpSync(src, path.join(dst, ent.name), { recursive: true, verbatimSymlinks: true });
  }
}
function patch(dst, rel, from, to) {
  const f = path.join(dst, rel);
  const s = fs.readFileSync(f, 'utf8');
  if (!s.includes(from)) throw new Error('mutation anchor not found in ' + rel + ': ' + from.slice(0, 80));
  fs.writeFileSync(f, s.replace(from, to));
}

const S = 'src/cases-server.mjs';
const H = 'test/support/shutdown-harness.mjs';
const MUTANTS = [
  { id: 'M0-none', expect: 'GREEN', pattern: 'R7-1|R7-2 signals SIGINT>SIGHUP|R7-3 open TCP|R7-4|T-1|R7-5 unreadable|O4', apply: () => {} },
  { id: 'M1-per-run-cleanup-untracked', expect: 'RED', pattern: 'R7-1', apply: (d) =>
    patch(d, S, "? trackCleanup(Promise.resolve()\n            .then(() => cleanupOwnedSession(pgid, {", "? (Promise.resolve()\n            .then(() => cleanupOwnedSession(pgid, {") },
  { id: 'M2-no-SIGHUP-SIGQUIT-handlers', expect: 'RED', pattern: 'R7-2', apply: (d) =>
    patch(d, S, "for (const signal of Object.keys(SIGNAL_EXIT_CODES)) process.on(", "for (const signal of ['SIGINT', 'SIGTERM']) process.on(") },
  { id: 'M3-await-close-no-socket-bound', expect: 'RED', pattern: 'R7-3', apply: (d) => {
    patch(d, S, "const bound = setTimeout(() => { try { server.closeAllConnections(); } catch { /* */ } }, HELD_SOCKET_BOUND_MS);",
      "const bound = null;");
    patch(d, S, "const { failures } = await server._ravenDrainOwned();",
      // R7 behaviour: wait for the server to fully close (all connections ended) before exiting.
      "const { failures } = await server._ravenDrainOwned();\n        if (server._connections > 0) await new Promise((r) => server.once('close', r));");
  } },
  { id: 'M4-no-stopping-refusal', expect: 'RED', pattern: 'R7-4', apply: (d) => {
    patch(d, S, "    stopping = true;\n    try { server.close(); } catch { /* not listening */ }", "    try { /* mutant: keep listening, no refusal */ } catch { /* */ }");
  } },
  { id: 'M5-exit1-masked-by-signal-code', expect: 'RED', pattern: 'R7-5 unreadable', apply: (d) =>
    patch(d, S, "          exitCode = 1;\n          await flushStderr(describeCleanupFailures(failures));", "          await flushStderr(describeCleanupFailures(failures));") },
  { id: 'M6-legacy-force-kill-launcher', expect: 'RED', pattern: 'BASE Ctrl-C', apply: (d) =>
    patch(d, 'bin/raven-replay', 'exec "$NODE_BIN" "$SERVER"',
      'trap \'kill -TERM "$C" 2>/dev/null; sleep 1; kill -KILL "$C" 2>/dev/null; exit 130\' INT TERM\n"$NODE_BIN" "$SERVER" & C=$!\nwait "$C"') },
  // R9 test-side controls (T-1): the ownership tracker must be load-bearing.
  { id: 'M7-R8-broad-same-tree-matcher', expect: 'RED', pattern: 'R7-4|T-1 same-tree', apply: (d) =>
    patch(d, H, "    return owned;\n  };",
      "    // mutant: R8 T-1 defect - any Node process running a script from this tree counts as owned\n" +
      "    for (const r of rows) if (!owned.has(r.pid) && r.command.startsWith(process.execPath + ' ') && r.command.includes(' ' + ROOT + '/')) owned.set(r.pid, { rec: r, firstSeenAt: Date.now(), parentAtFirstSight: r.ppid });\n" +
      "    return owned;\n  };") },
  { id: 'M8-tracker-forgets-reparented', expect: 'RED', pattern: 'T-1 ownership tracker', apply: (d) =>
    patch(d, H, "    const anchors = new Set();\n    if (rootRow", "    owned.clear(); // mutant: ownership only while ancestry currently exists\n    const anchors = new Set();\n    if (rootRow") },
];

const results = [];
for (const m of MUTANTS) {
  const dst = fs.mkdtempSync(path.join(os.tmpdir(), 'raven-r8-mutant-' + m.id + '-'));
  let applied = true, err = null;
  try { copyTree(dst); m.apply(dst); } catch (e) { applied = false; err = String(e.message || e); }
  let rc = null, summary = '';
  if (applied) {
    const r = spawnSync(process.execPath, ['--test', '--test-concurrency=1', '--test-name-pattern', m.pattern, 'test/launcher-shutdown.test.mjs'], {
      cwd: dst, env: { ...process.env, RAVEN_SHUTDOWN_ROOT: dst, RAVEN_SHUTDOWN_EVIDENCE: '' }, encoding: 'utf8', timeout: 600000,
    });
    rc = r.status;
    fs.writeFileSync(path.join(os.tmpdir(), 'raven-r8-' + m.id + '.log'), (r.stdout || '') + (r.stderr || ''));
    summary = ((r.stdout || '').match(/^# (tests|pass|fail) \d+$/gm) || []).join(' ');
    const failed = ((r.stdout || '').match(/^not ok \d+ - .*$/gm) || []);
    summary += failed.length ? ' | RED: ' + failed.join(' ; ') : '';
  }
  const observed = rc === 0 ? 'GREEN' : 'RED';
  const pass = applied && observed === m.expect;
  results.push({ id: m.id, pattern: m.pattern, expect: m.expect, observed, rc, applied, err, pass, summary, copy: dst });
  console.log((pass ? 'CONTROL OK   ' : 'CONTROL FAIL ') + m.id + ' expect=' + m.expect + ' observed=' + observed + ' ' + summary);
  fs.rmSync(dst, { recursive: true, force: true });
}
if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(results, null, 2));
process.exit(results.every((r) => r.pass) ? 0 : 1);
