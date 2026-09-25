import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const launcher = path.join(root, 'bin', 'raven-replay');
const goodNode = process.execPath;

function run(args, env = {}) {
  return spawnSync(launcher, args, {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: 15000,
  });
}

test('launcher refuses wrong Node version without starting the server', () => {
  // Use a tiny fake "node" script that prints a wrong version.
  const fake = path.join(root, 'test', '.fake-node-wrong');
  fs.writeFileSync(fake, '#!/bin/sh\nif [ "$1" = "-p" ]; then echo v24.0.0; exit 0; fi\necho unexpected; exit 1\n');
  fs.chmodSync(fake, 0o755);
  const r = run(['--node', fake]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /wrong or unreadable Node runtime/i);
  assert.match(r.stderr, /v22\.18\.0/);
  assert.match(r.stderr, /LAUNCH\.md|SETUP-NODE/);
  assert.doesNotMatch(r.stdout + r.stderr, /Raven Replay local prototype:/);
});

test('launcher refuses missing Node path', () => {
  const missing = path.join(root, 'test', '.no-such-node-binary');
  const r = run(['--node', missing]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Node executable not found/);
});

test('current process Node must be exactly v22.18.0 for green demos', () => {
  assert.equal(process.version, 'v22.18.0');
});

test('correct runtime starts approved server, prints URL, stops cleanly', async () => {
  assert.equal(process.version, 'v22.18.0');
  const port = await new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
    s.on('error', reject);
  });

  const child = spawn(launcher, ['--node', goodNode, '--port', String(port)], {
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  let err = '';
  child.stdout.on('data', d => { out += d; });
  child.stderr.on('data', d => { err += d; });

  const url = `http://127.0.0.1:${port}`;
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server start timeout\n' + out + err)), 10000);
    const onData = () => {
      if (out.includes(url) || out.includes('Raven Replay local prototype:')) {
        clearTimeout(t);
        resolve();
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
  });

  assert.match(out, new RegExp(`http://127\\.0\\.0\\.1:${port}`));
  const home = await fetch(url + '/');
  assert.equal(home.status, 200);
  const cases = await fetch(url + '/cases');
  assert.equal(cases.status, 200);
  assert.match(await cases.text(), /Saved cases/);
  assert.ok(out.includes(url + '/cases'), 'launcher output must advertise saved cases');

  child.kill('SIGINT');
  const code = await new Promise(resolve => child.on('close', resolve));
  // bash may exit 130 on SIGINT, or 0 after clean wait — accept non-crash codes
  assert.ok(code === 0 || code === 130 || code === null || code === 143);

  // port should be free again
  await new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(port, '127.0.0.1', () => s.close(() => resolve()));
  });
});

test('occupied port fails closed without killing the holder', async () => {
  const holder = net.createServer();
  await new Promise(r => holder.listen(0, '127.0.0.1', r));
  const port = holder.address().port;
  const r = run(['--node', goodNode, '--port', String(port)]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /already in use/i);
  assert.match(r.stderr, /will not kill/i);
  // holder still accepts
  await new Promise((resolve, reject) => {
    const c = net.connect({ host: '127.0.0.1', port }, () => { c.end(); resolve(); });
    c.on('error', reject);
  });
  await new Promise(r => holder.close(r));
});
