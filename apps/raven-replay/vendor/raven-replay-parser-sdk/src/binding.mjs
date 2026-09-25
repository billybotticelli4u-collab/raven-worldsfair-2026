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

/** Resolve declared package names to a sorted transitive dependency closure (package.json dependencies only). */
export function resolvePackageClosure(packageRoot, packageNames) {
  const seen = new Set();
  const queue = [...packageNames];
  while (queue.length) {
    const name = queue.pop();
    if (seen.has(name)) continue;
    const pkgDir = path.join(packageRoot, 'node_modules', ...name.split('/'));
    const pj = path.join(pkgDir, 'package.json');
    if (!fs.existsSync(pj)) throw new Error('Missing dependency package: ' + name);
    seen.add(name);
    let pkg;
    try { pkg = JSON.parse(fs.readFileSync(pj, 'utf8')); }
    catch { throw new Error('Unreadable package.json for dependency: ' + name); }
    for (const dep of Object.keys(pkg.dependencies || {})) {
      const depDir = path.join(packageRoot, 'node_modules', ...dep.split('/'));
      if (fs.existsSync(path.join(depDir, 'package.json'))) queue.push(dep);
      // Nested node_modules under parent (rare with flat npm): also accept
      else {
        const nested = path.join(pkgDir, 'node_modules', ...dep.split('/'), 'package.json');
        if (fs.existsSync(nested)) {
          // Prefer hoisted if absent; for nested-only, inventory via nested path keyed as dep name
          // still require package under top-level OR record as missing at top — npm ci flattens @solana.
          throw new Error('Dependency not hoisted into package node_modules (unsupported nested layout): ' + dep);
        }
      }
    }
  }
  return [...seen].sort();
}

/**
 * Inventory of the complete execution dependency closure:
 * - resolved transitive npm packages from declared roots
 * - optional local helper roots (adapter directories)
 * Digests = consistency of measured bytes, not publisher authentication.
 */
export function dependencyBinding(packageRoot, packageNames, { localRoots = [] } = {}) {
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
  files.sort((a, b) => (a.package < b.package ? -1 : a.package > b.package ? 1 : 0));
  return {
    packages: files,
    closure_packages: closure,
    binding_sha256: sha(canonical(files)),
  };
}
