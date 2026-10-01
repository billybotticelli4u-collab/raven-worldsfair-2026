import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dependencyBinding, inventoryDirectory, inventoryDigest, sha, resolvePackageClosure } from '../src/binding.mjs';
import { packageRoot } from '../src/registry.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const node = process.execPath;
const cli = path.join(root, 'src', 'cli.mjs');
const fixture = path.join(root, 'fixtures', 'legacy-transaction.base64');

test('dependency inventory includes transitive @solana/transactions closure', () => {
  const closure = resolvePackageClosure(packageRoot(), ['@solana/kit']);
  assert.ok(closure.includes('@solana/kit'));
  assert.ok(closure.includes('@solana/transactions'), 'transitive @solana/transactions must be in closure');
  const a = dependencyBinding(packageRoot(), ['@solana/kit'], {
    localRoots: [{ label: 'local:solana-kit-tx-decode', abs: path.join(root, 'adapters', 'solana-kit-tx-decode') }],
  });
  const b = dependencyBinding(packageRoot(), ['@solana/kit'], {
    localRoots: [{ label: 'local:solana-kit-tx-decode', abs: path.join(root, 'adapters', 'solana-kit-tx-decode') }],
  });
  assert.equal(a.binding_sha256, b.binding_sha256);
  assert.ok(a.packages.some((p) => p.package === '@solana/transactions'));
  assert.ok(a.packages.some((p) => p.kind === 'local_helpers'));
  assert.ok(a.packages[0].file_count >= 1);
});

test('inventory detects file tampering on a disposable tree (not live node_modules)', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dep-inv-'));
  const pkg = path.join(tmpRoot, 'node_modules', 'fake-dep');
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: 'fake-dep', version: '1.0.0', type: 'module' }));
  const target = path.join(pkg, 'index.js');
  fs.writeFileSync(target, 'export default 1\n');
  const before = dependencyBinding(tmpRoot, ['fake-dep']);
  fs.writeFileSync(target, 'export default 2\n');
  const after = dependencyBinding(tmpRoot, ['fake-dep']);
  assert.notEqual(after.binding_sha256, before.binding_sha256);
  fs.writeFileSync(target, 'export default 1\n');
  const restored = dependencyBinding(tmpRoot, ['fake-dep']);
  assert.equal(restored.binding_sha256, before.binding_sha256);
});

test('inventory refuses oversized execution files instead of skipping', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'inv-over-'));
  fs.writeFileSync(path.join(tmp, 'big.bin'), Buffer.alloc(100));
  assert.throws(
    () => inventoryDirectory(tmp, { maxFileBytes: 10 }),
    /oversized/i,
  );
});

test('rerun refuses when dependency inventory digests in the case drift', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'raven-sdk-dep-'));
  const casePath = path.join(dir, 'c.json');
  const created = spawnSync(node, [cli, 'create', '--adapter', 'solana-kit-tx-decode', '--name', 'dep1', fixture, casePath], {
    encoding: 'utf8', cwd: root,
  });
  assert.equal(created.status, 0, created.stdout);
  const c = JSON.parse(fs.readFileSync(casePath, 'utf8'));
  c.bindings.dependency_binding_sha256 = 'b'.repeat(64);
  const tampered = path.join(dir, 't.json');
  fs.writeFileSync(tampered, JSON.stringify(c));
  const rerun = spawnSync(node, [cli, 'rerun', tampered], { encoding: 'utf8', cwd: root });
  assert.equal(rerun.status, 3);
  assert.match(JSON.parse(rerun.stdout).results[0].error, /Dependency installed-file inventory differs/);
});

test('inventoryDigest consistency helper', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'inv-'));
  fs.writeFileSync(path.join(tmp, 'a.txt'), 'hello');
  const inv = inventoryDirectory(tmp);
  assert.equal(inv.length, 1);
  assert.equal(inv[0].sha256, sha('hello'));
  assert.equal(inventoryDigest(inv), inventoryDigest(inv));
});
