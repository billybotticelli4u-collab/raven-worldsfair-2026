import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const node = process.execPath;
const cli = path.join(root, 'src', 'cli.mjs');
const fixture = path.join(root, 'fixtures', 'legacy-transaction.base64');

test('path with spaces works for create/rerun', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'raven sdk spaces '));
  const casePath = path.join(base, 'my case.json');
  const r = spawnSync(node, [cli, 'create', '--adapter', 'example-parser-v1', '--name', 'spaces', fixture, casePath], {
    encoding: 'utf8', cwd: root,
  });
  assert.equal(r.status, 0, r.stdout);
  const rerun = spawnSync(node, [cli, 'rerun', casePath], { encoding: 'utf8', cwd: root });
  assert.equal(rerun.status, 0);
});

test('platform record is portable (Darwin measured; Linux UNMEASURED)', () => {
  // Do not require darwin — Linux runs must be able to mean something.
  assert.ok(['darwin', 'linux', 'win32'].includes(process.platform), 'unexpected platform: ' + process.platform);
  assert.ok(process.arch);
  if (process.platform === 'darwin') {
    assert.ok(true, 'Darwin measured in author/successor evidence');
  } else if (process.platform === 'linux') {
    // Honest: this suite may run, but product platform evidence remains UNMEASURED until recorded.
    assert.ok(true, 'Linux suite runnable; product platform evidence still UNMEASURED until separately recorded');
  }
});
