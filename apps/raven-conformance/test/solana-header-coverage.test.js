import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadCorpus, classifyResult } from '../src/lib/runner.js';
import { APP_ROOT } from '../src/lib/paths.js';

const previousBytes = readFileSync(path.join(APP_ROOT, 'corpus/raven-solana-txversion-demo-corpus-1.3.json'));
const previous = JSON.parse(previousBytes);
const corpus = () => loadCorpus('solana').data;
const source = readFileSync(path.join(APP_ROOT, 'targets/solana/SOL_CONFORMANT_REFERENCE.mjs'), 'utf8');
const mutations = [
  ['LAB01_legacy_unsigned_overflow', 'V01_valid_legacy', [[67, 1, 3]], 0,
    '  if (numReqSig - numRoS + numRoU > accountCount) throw fail("header_inconsistent:writable_unsigned_overflow");'],
  ['LAB02_v1_unsigned_overflow', 'V03_valid_v1', [[3, 1, 3]], 0,
    '  if (numReq - numRoS + numRoU > numStatic) throw fail("header_inconsistent:writable_unsigned_overflow");'],
  ['LAB03_v1_required_accounts', 'V03_valid_v1', [[1, 1, 4], [2, 0, 3], [3, 1, 0]], 192,
    '  if (numReq > numStatic) throw fail("header_inconsistent:req_sig_gt_accounts");'],
];
function invoke(entry, input) {
  const r = spawnSync(process.execPath, [entry], { input: JSON.stringify(input) + '\n', encoding: 'utf8', timeout: 3000 });
  assert.equal(r.error, undefined);
  assert.equal(r.signal, null);
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test('retains the sealed 1.3 corpus and all original 27 rows in order', () => {
  assert.equal(createHash('sha256').update(previousBytes).digest('hex'), 'b844b12c80d1413b68c455dae147ab0fdee57a8a942817cfc3d099295d722559');
  assert.deepEqual(corpus().vectors.slice(0, 27), previous.vectors);
});

test('selects the 30-row 1.4 corpus with three unique additional header witnesses', () => {
  const c = corpus();
  assert.equal(c.id, 'raven-solana-txversion-demo-corpus/1.4');
  assert.equal(c.vectors.length, 30);
  assert.equal(new Set(c.vectors.map(v => v.id)).size, 30);
  assert.deepEqual(c.vectors.slice(27).map(v => v.id), mutations.map(m => m[0]));
});

for (const [id, baseId, edits, zeros, guard] of mutations) {
  test(`${id}: exact witness catches a complete wrong answer that original27 misses`, () => {
    const vector = corpus().vectors.find(v => v.id === id);
    assert.ok(vector, `${id} must be in the selected corpus`);
    const base = previous.vectors.find(v => v.id === baseId);
    const bytes = Buffer.from(base.input.tx_base64, 'base64');
    for (const [offset, before, after] of edits) { assert.equal(bytes[offset], before); bytes[offset] = after; }
    const witness = Buffer.concat([bytes, Buffer.alloc(zeros)]);
    assert.equal(vector.input.tx_base64, witness.toString('base64'));
    const dir = mkdtempSync(path.join(tmpdir(), 'raven header coverage '));
    try {
      const mutant = path.join(dir, 'mutant.mjs');
      assert.equal(source.split(guard).length, 2, 'mutation must remove exactly one guard');
      writeFileSync(mutant, source.replace(guard, '  // Deliberate test mutation: guard omitted.'));
      for (const old of previous.vectors) {
        const observed = invoke(mutant, old.input);
        assert.equal(observed.decision, old.expected.decision, old.id);
        assert.equal(observed.version, old.expected.version, old.id);
      }
      const reference = invoke(path.join(APP_ROOT, 'targets/solana/SOL_CONFORMANT_REFERENCE.mjs'), vector.input);
      assert.deepEqual(reference, vector.expected);
      const observed = invoke(mutant, vector.input);
      assert.equal(observed.decision, 'ACCEPT');
      const classified = classifyResult({ observed, exitCode: 0, signal: null }, vector.expected);
      assert.equal(classified.status, 'BEHAVIORAL_DIVERGENCE');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

test('reason-only changes remain a disclosed checker limit; crashes are separate', () => {
  const expected = { decision: 'REJECT', version: null, reason: 'expected' };
  assert.equal(classifyResult({ observed: { decision: 'REJECT', version: null, reason: 42 }, exitCode: 0 }, expected).status, 'PASS');
  assert.equal(classifyResult({ observed: expected, exitCode: 1 }, expected).status, 'TARGET_CRASH');
});
