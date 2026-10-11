import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const read = name => readFileSync(new URL(name, import.meta.url), 'utf8');
const cases = JSON.parse(read('decoder-cases.json'));
const manifest = JSON.parse(read('decoder-vendor/manifest.json'));

test('published bundle bytes match every retained manifest pin', () => {
  assert.deepEqual(manifest.files.map(file => file.version), ['3.0.3', '4.0.0', '8.3.0']);
  for (const file of manifest.files) {
    assert.equal(createHash('sha256').update(read('decoder-vendor/' + file.file)).digest('hex'), file.sha256);
    assert.match(read('decoder-vendor/LICENSE-' + file.version), /Copyright \(c\) 2023 Solana Labs, Inc/);
  }
});

function run(bytes) {
  let observed;
  const context = { TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, DataView, atob, btoa, console };
  context.self = context;
  context.importScripts = path => vm.runInContext(read(path), context);
  context.postMessage = result => { observed = JSON.parse(JSON.stringify(result)); };
  vm.createContext(context);
  vm.runInContext(read('_decoder-worker.js'), context);
  context.onmessage({ data: bytes.buffer });
  return observed;
}

function example(prefix) {
  const name = Object.keys(cases).find(key => key.startsWith(prefix));
  assert.ok(name, 'retained example exists: ' + prefix);
  return run(Uint8Array.from(Buffer.from(cases[name], 'hex')));
}

for (const prefix of ['A_', 'D_']) {
  test('canonical positive control ' + prefix + ' accepts on all three actual libraries', () => {
    assert.deepEqual(example(prefix).map(row => row.decision), ['ACCEPT', 'ACCEPT', 'ACCEPT']);
  });
}

test('version-3 example distinguishes the three actual libraries', () => {
  const rows = example('E_');
  assert.deepEqual(rows.map(row => [row.decision, row.decodedVersion]), [['ACCEPT', 3], ['REJECT', null], ['REJECT', null]]);
  assert.equal(rows[1].code, 5663021);
  assert.equal(rows[2].code, 5663021);
});

test('non-canonical signature-count example preserves the recorded split', () => {
  assert.deepEqual(example('C_').map(row => row.decision), ['ACCEPT', 'ACCEPT', 'REJECT']);
});

test('non-canonical account-count example is accepted by all three two-call adapters', () => {
  assert.deepEqual(example('B_').map(row => row.decision), ['ACCEPT', 'ACCEPT', 'ACCEPT']);
});

test('malformed bytes produce refusals from all three actual libraries', () => {
  const rows = run(new Uint8Array([255]));
  assert.equal(rows.length, 3);
  assert.ok(rows.every(row => row.decision === 'REJECT'));
});
