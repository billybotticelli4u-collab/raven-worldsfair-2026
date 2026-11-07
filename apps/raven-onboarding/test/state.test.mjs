import test from 'node:test';
import assert from 'node:assert/strict';
import { createRunState, decodeInput } from '../public/state.mjs';

test('changing inputs removes the current export and aborts pending work', () => {
  const state = createRunState(), ticket = state.start();
  assert.equal(state.accept(ticket, { marker: 'current' }), true);
  assert.equal(state.result.marker, 'current');
  state.invalidate();
  assert.equal(ticket.signal.aborted, true);
  assert.equal(state.result, null);
  assert.equal(state.accept(ticket, { marker: 'stale' }), false);
  assert.equal(state.result, null);
});

test('an older success cannot overwrite a newer refusal even if its work ignores abort', async () => {
  const state = createRunState();
  let resolve;
  const slow = new Promise(r => { resolve = r; });
  const old = state.start();
  const delayed = slow.then(value => state.accept(old, value));
  const newer = state.start();
  assert.equal(state.accept(newer, { decision: 'REFUSE' }), true);
  resolve({ decision: 'PROCEED' });
  assert.equal(await delayed, false);
  assert.deepEqual(state.result, { decision: 'REFUSE' });
});

test('run generations distinguish work independently of abort state', () => {
  const state = createRunState(), old = state.start();
  state.start();
  const ignoredAbort = { generation: old.generation, signal: new AbortController().signal };
  assert.equal(state.accept(ignoredAbort, 'stale'), false);
  assert.equal(state.result, null);
});

test('starting or failing validation cannot leave an earlier download', () => {
  const state = createRunState(), ticket = state.start();
  state.accept(ticket, 'earlier report');
  state.start();
  assert.throws(() => decodeInput('not bytes', 'hex'));
  assert.equal(state.result, null);
});

test('hex and canonical padded base64 decode to identical bytes', () => {
  assert.deepEqual(decodeInput('00 ff 10', 'hex'), decodeInput('AP8Q', 'base64'));
  assert.deepEqual(decodeInput('Zg==', 'base64'), Uint8Array.of(102));
});

test('empty, odd hex, bad characters, noncanonical base64 and oversize are refused', () => {
  for (const [text, kind] of [['', 'hex'], ['a', 'hex'], ['gg', 'hex'], ['Zg', 'base64'], ['Zh==', 'base64'], ['Zg==junk', 'base64'], ['00', 'unknown'], ['00'.repeat(4097), 'hex']]) {
    assert.throws(() => decodeInput(text, kind), `${kind}: ${text.slice(0, 20)}`);
  }
  assert.equal(decodeInput('00'.repeat(4096), 'hex').length, 4096);
});
