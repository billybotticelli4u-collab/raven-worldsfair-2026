import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { canonical } from './normalize.mjs';

export const sha = (data) => crypto.createHash('sha256').update(data).digest('hex');

/**
 * Walk a directory and produce a sorted inventory of regular files with sha256.
 * Digests establish consistency of installed bytes, not publisher authentication.
 *
 * Refuse (throw) rather than silently skip:
 * - unreadable files
 * - oversized execution files
 * - symlink targets that resolve outside the measured closure root(s)
 */
export function inventoryDirectory(root, {
  maxFiles = 5000,
  maxFileBytes = 8 * 1024 * 1024,
  closureRoots = null,
} = {}) {
  const abs = path.resolve(root);
  const roots = (closureRoots && closureRoots.length)
    ? closureRoots.map((r) => path.resolve(r))
    : [abs];
  const inClosure = (resolved) => roots.some((r) => resolved === r || resolved.startsWith(r + path.sep));
  const entries = [];
  const stack = [''];
  while (stack.length) {
    const rel = stack.pop();
    const full = path.join(abs, rel);
    let st;
    try {
      st = fs.lstatSync(full);
    } catch (e) {
      throw new Error('Unreadable path in execution inventory: ' + (rel || '.') + ' (' + (e.code || e.message) + ')');
    }
    if (st.isSymbolicLink()) {
      let target;
      try { target = fs.readlinkSync(full); } catch (e) {
        throw new Error('Unreadable symlink in execution inventory: ' + rel);
      }
      const resolved = path.resolve(path.dirname(full), target);
      if (!inClosure(resolved)) {
        throw new Error('Symlink target outside measured closure: ' + rel + ' -> ' + target);
      }
      // Record link + hash target content when it is a regular file inside closure.
      let targetSha = null;
      let size = null;
      try {
        const tst = fs.statSync(resolved);
        if (tst.isFile()) {
          if (tst.size > maxFileBytes) {
            throw new Error('Execution file oversized (symlink target): ' + rel + ' size=' + tst.size);
          }
          const buf = fs.readFileSync(resolved);
          targetSha = sha(buf);
          size = buf.length;
        }
      } catch (e) {
        if (String(e.message || '').startsWith('Execution file oversized') ||
            String(e.message || '').startsWith('Symlink target')) throw e;
        throw new Error('Unreadable symlink target in execution inventory: ' + rel);
      }
      entries.push({
        path: rel.replaceAll('\\', '/'),
        kind: 'symlink',
        target: String(target),
        sha256: targetSha,
        size,
      });
      continue;
    }
    if (st.isDirectory()) {
      let names;
      try { names = fs.readdirSync(full); } catch (e) {
        throw new Error('Unreadable directory in execution inventory: ' + (rel || '.'));
      }
      for (const name of names.sort().reverse()) {
        if (name === '.git') continue;
        stack.push(rel ? rel + '/' + name : name);
      }
      continue;
    }
    if (!st.isFile()) continue;
    if (st.size > maxFileBytes) {
      throw new Error('Execution file oversized: ' + rel + ' size=' + st.size);
    }
    let buf;
    try { buf = fs.readFileSync(full); } catch (e) {
      throw new Error('Unreadable execution file: ' + rel);
    }
    entries.push({
      path: rel.replaceAll('\\', '/'),
      kind: 'file',
      target: null,
      sha256: sha(buf),
      size: buf.length,
    });
    if (entries.length > maxFiles) throw new Error('Inventory exceeds maxFiles (' + maxFiles + ')');
  }
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return entries;
}

export function inventoryDigest(entries) {
  return sha(canonical(entries));
}

const ownKeys = (o) => (o && typeof o === 'object' && !Array.isArray(o)) ? Object.keys(o) : [];
const hasOwn = (o, k) => o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);

/**
 * Resolve declared package names to a sorted transitive dependency closure.
 *
 * DCB-2 (S1) closure rule — the closure is the set of packages the adapter child is PERMITTED
 * to load, and every member is byte-inventoried:
 * - `dependencies`: required. Missing → refuse (DCB-1 R2), unless the same name is also in
 *   `optionalDependencies` (npm override semantics; absent optional → skipped).
 * - `optionalDependencies`: included when installed at the supported hoisted location; skipped
 *   when absent. An optional dependency that is present is therefore inventoried and bound.
 * - `peerDependencies`: included when installed hoisted. A required peer that is absent →
 *   refuse (npm 7+ installs required peers; absence means an unsupported install). An optional
 *   peer (`peerDependenciesMeta[name].optional`) that is absent → skipped.
 * - nested-only layouts remain refused (unsupported).
 * Anything a closure member resolves OUTSIDE this set is refused at load time by the closure guard.
 */
export function resolvePackageClosure(packageRoot, packageNames) {
  const seen = new Set();
  const queue = [...packageNames];
  const hoisted = (dep) => path.join(packageRoot, 'node_modules', ...dep.split('/'));
  while (queue.length) {
    const name = queue.pop();
    if (seen.has(name)) continue;
    const pkgDir = hoisted(name);
    const pj = path.join(pkgDir, 'package.json');
    if (!fs.existsSync(pj)) throw new Error('Missing dependency package: ' + name);
    seen.add(name);
    let pkg;
    try { pkg = JSON.parse(fs.readFileSync(pj, 'utf8')); }
    catch { throw new Error('Unreadable package.json for dependency: ' + name); }
    const optional = pkg.optionalDependencies;
    const peerMeta = pkg.peerDependenciesMeta;
    const edges = [
      ...ownKeys(pkg.dependencies).map((dep) => ({ dep, kind: 'dependency', required: !hasOwn(optional, dep) })),
      ...ownKeys(optional).filter((dep) => !hasOwn(pkg.dependencies, dep)).map((dep) => ({ dep, kind: 'optional', required: false })),
      ...ownKeys(pkg.peerDependencies).map((dep) => ({ dep, kind: 'peer', required: !(hasOwn(peerMeta, dep) && peerMeta[dep] && peerMeta[dep].optional === true) })),
    ];
    for (const { dep, kind, required } of edges) {
      if (fs.existsSync(path.join(hoisted(dep), 'package.json'))) { queue.push(dep); continue; }
      const nested = path.join(pkgDir, 'node_modules', ...dep.split('/'), 'package.json');
      if (fs.existsSync(nested)) {
        // npm ci flattens @solana; a nested-only copy is an unsupported layout — refuse rather than bind the wrong bytes.
        throw new Error('Dependency not hoisted into package node_modules (unsupported nested layout): ' + dep);
      }
      if (required) {
        throw new Error('Missing declared transitive ' + (kind === 'peer' ? 'peer ' : '') + 'dependency: ' + dep + ' (required by ' + name + ')');
      }
      // absent optional dependency / optional peer: skipped, and therefore NOT permitted at load time
    }
  }
  return [...seen].sort();
}

/**
 * Directories and files the adapter child is permitted to load modules from (DCB-2 closure guard).
 * Exactly the byte-inventoried closure: every closure package directory, the adapters/ tree, and the
 * four exact SDK child-runtime files (watchdog, guard, observer hook and identity helper). Nothing else under node_modules is permitted,
 * so "permitted" and "inventoried" are the same set.
 */
export function permittedExecutionRoots(packageRoot, closure, { localRoots = [] } = {}) {
  const dirs = closure.map((name) => path.join(packageRoot, 'node_modules', ...name.split('/')));
  for (const local of localRoots) dirs.push(path.resolve(local.abs));
  const files = CHILD_RUNTIME_FILES.map((rel) => path.join(packageRoot, ...rel.split('/')));
  return { dirs: [...new Set(dirs)].sort(), files };
}

/**
 * SDK files that execute inside the adapter-side processes (watchdog, closure guard,
 * adapter observer hook and process-identity helper).
 * Single source of truth for BOTH the load allow-list (permittedExecutionRoots) and the byte
 * binding (dependencyBinding childRuntimeFiles), so the enforcement code itself is bound (DCB-2 S2).
 */
export const CHILD_RUNTIME_FILES = Object.freeze(['src/watchdog-exec.mjs', 'src/closure-guard.cjs', 'src/adapter-observe-hook.mjs', 'src/process-identity.mjs']);

/**
 * Inventory of the complete execution dependency closure:
 * - resolved transitive npm packages from declared roots
 * - optional local helper roots (adapter directories)
 * Digests = consistency of measured bytes, not publisher authentication.
 */
export function dependencyBinding(packageRoot, packageNames, { localRoots = [], childRuntimeFiles = [] } = {}) {
  const files = [];
  const closure = packageNames.length ? resolvePackageClosure(packageRoot, packageNames) : [];
  for (const name of closure) {
    const p = path.join(packageRoot, 'node_modules', ...name.split('/'));
    if (!fs.existsSync(p)) throw new Error('Missing dependency package: ' + name);
    const inv = inventoryDirectory(p, { maxFiles: 5000, closureRoots: [p] });
    files.push({
      package: name,
      kind: 'npm',
      inventory_sha256: inventoryDigest(inv),
      file_count: inv.length,
    });
  }
  for (const local of localRoots) {
    const abs = path.resolve(local.abs);
    if (!fs.existsSync(abs)) throw new Error('Missing local helper root: ' + local.label);
    const inv = inventoryDirectory(abs, { maxFiles: 500, closureRoots: [abs] });
    files.push({
      package: local.label,
      kind: 'local_helpers',
      inventory_sha256: inventoryDigest(inv),
      file_count: inv.length,
    });
  }
  // SDK child-runtime files (DCB-2 S2): exact bytes of each permitted SDK file. Must be a regular
  // file (no symlink); anything else refuses rather than binding the wrong bytes.
  for (const rel of childRuntimeFiles) {
    const abs = path.join(packageRoot, ...rel.split('/'));
    let st;
    try { st = fs.lstatSync(abs); } catch { throw new Error('Missing SDK child-runtime file: ' + rel); }
    if (!st.isFile()) throw new Error('SDK child-runtime file is not a regular file: ' + rel);
    let buf;
    try { buf = fs.readFileSync(abs); } catch { throw new Error('Unreadable SDK child-runtime file: ' + rel); }
    files.push({
      package: 'sdk:' + rel,
      kind: 'sdk_child_runtime',
      inventory_sha256: sha(buf),
      file_count: 1,
    });
  }
  files.sort((a, b) => (a.package < b.package ? -1 : a.package > b.package ? 1 : 0));
  return {
    packages: files,
    closure_packages: closure,
    binding_sha256: sha(canonical(files)),
  };
}
