'use strict';
// DCB-2 closure guard (S1). Loaded via NODE_OPTIONS=--require into every adapter-side Node process
// (watchdog, adapter, and ordinary children that inherit the environment).
//
// Rule: a module may load only if it resolves (lexically AND by realpath) to a location the runner
// permitted through RAVEN_CLOSURE_ROOTS — the byte-inventoried closure: closure package directories,
// the adapters/ tree, and four exact SDK child-runtime files: watchdog, guard, observer hook and
// process-identity helper. Builtins and data: URLs are allowed.
// Missing or malformed RAVEN_CLOSURE_ROOTS fails closed (nothing but builtins loads).
//
// Refusal is process.exit(126) after one JSON diagnostic line on stderr. A thrown error would be
// swallowed by optional `try { require(x) } catch {}` probes (ws does exactly that); exiting cannot be.
// Exit 126 is a RESERVED CONVENTION, not provenance: any adapter can exit 126 itself. The runner labels
// CLOSURE_ESCAPE only when the diagnostic line is present, EXIT_126_RESERVED otherwise, and both are
// RUN_ERROR. This is not a sandbox: code that bypasses the module loader (fs + vm, eval, native
// addons by path, children that replace their environment) is not seen here.
const path = require('node:path');
const fs = require('node:fs');
const Module = require('node:module');
const { fileURLToPath } = require('node:url');

let dirs = null;
let files = null;
let configError = null;
try {
  const cfg = JSON.parse(process.env.RAVEN_CLOSURE_ROOTS || '');
  if (!cfg || !Array.isArray(cfg.dirs) || !Array.isArray(cfg.files)) throw new Error('shape');
  dirs = cfg.dirs.map((d) => path.resolve(String(d)) + path.sep);
  files = new Set(cfg.files.map((f) => path.resolve(String(f))));
} catch (e) {
  configError = 'RAVEN_CLOSURE_ROOTS missing or malformed';
}

function permitted(p) {
  if (configError) return false;
  if (files.has(p)) return true;
  return dirs.some((d) => p.startsWith(d));
}

function refuse(reason, specifier, context, resolved, real) {
  const diag = {
    closure_guard: 'REFUSED',
    reason,
    specifier,
    resolved: resolved || null,
    realpath: real || null,
    parent: (context && context.parentURL) || null,
  };
  try { fs.writeSync(2, JSON.stringify(diag) + '\n'); } catch {}
  process.exit(126);
}

Module.registerHooks({
  resolve(specifier, context, nextResolve) {
    if (Module.isBuiltin(specifier)) return nextResolve(specifier, context);
    const r = nextResolve(specifier, context);
    const url = String(r.url || '');
    if (url.startsWith('node:') || url.startsWith('data:')) return r;
    if (!url.startsWith('file:')) refuse('non_file_url', specifier, context, url, null);
    const p = fileURLToPath(url);
    if (configError) refuse(configError, specifier, context, p, null);
    let real;
    try { real = fs.realpathSync(p); } catch { refuse('realpath_failed', specifier, context, p, null); }
    if (!permitted(p)) refuse('outside_permitted_closure', specifier, context, p, real);
    if (!permitted(real)) refuse('realpath_outside_permitted_closure', specifier, context, p, real);
    return r;
  },
});
