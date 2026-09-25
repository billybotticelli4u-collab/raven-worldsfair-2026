// Tests for the saved-case view model (public/cases-view.mjs) and the interface sources. Authored by Claude.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runCase, runCases, caseDigest, MAX_CASES, MAX_CASE_BYTES } from '../src/cases.mjs';
import { MAX_BATCH, MAX_CASE_FILE_BYTES, MAX_LOADED_CASES, SAFETY_NOTE, describeResult, describeReport, describeFailure,
  describeCase, addCase, runRequest, batchProblem, caseFileName, caseFileText } from '../public/cases-view.mjs';

const read = rel => fs.readFileSync(new URL('../' + rel, import.meta.url), 'utf8');
const acceptCase = JSON.parse(read('examples/cases/legacy-accept.json'));
const rejectCase = JSON.parse(read('examples/cases/truncated-reject.json'));
const words = view => JSON.stringify(view);
const claims = view => words(view).replaceAll('not a safety verdict', '');   // the one allowed negation
const safetyClaim = /\bsafe(ty)?\b|\bpass(ed|es)?\b|\bverified\b|\bvalid transaction\b|\bapproved\b/i;

// The core cannot produce a runtime mismatch inside the pinned runtime, so this mirrors its RUN_ERROR shape
// (expected result read, preflight refused before execution). The browser demo produces the real one.
const runError = { name: rejectCase.name, status: 'RUN_ERROR', exit_code: 3, case_content_sha256: caseDigest(rejectCase),
  reference: 'NOT_PROVIDED', execution: 'NOT_RUN', expected_result: rejectCase.expected_execution.parsed, actual_result: null,
  differences: [], error: 'Runtime mismatch: use Node v22.18.0' };

test('interface limits are the core limits', () => {
  assert.equal(MAX_BATCH, MAX_CASES);
  assert.equal(MAX_CASE_FILE_BYTES, MAX_CASE_BYTES);
});

test('an expected REJECT that reproduces shows MATCH and the REJECT decision as separate facts', () => {
  const view = describeResult(runCase(rejectCase));
  assert.equal(view.outcome.code, 'MATCH');
  assert.equal(view.outcome.label, 'Reproduced');
  const decision = view.parser.rows.find(r => r.field === 'decision');
  assert.deepEqual([decision.expected, decision.actual, decision.changed], ['REJECT', 'REJECT', false]);
  assert.match(view.parser.note, /not a safety verdict/);
  assert.doesNotMatch(words(view.outcome), /REJECT|ACCEPT/);
  assert.doesNotMatch(words(view.outcome), safetyClaim);
});

test('the safety note says MATCH is never a safety verdict', () => {
  assert.match(SAFETY_NOTE, /MATCH/);
  assert.match(SAFETY_NOTE, /never means the transaction is safe/);
});

test('no outcome, decision or reference combination claims safety', () => {
  for (const status of ['MATCH', 'REGRESSION', 'INVALID_CASE', 'RUN_ERROR'])
    for (const decision of ['ACCEPT', 'REJECT'])
      for (const reference of ['NOT_PROVIDED', 'MATCH', 'MISMATCH', 'NOT_CHECKED']) {
        const parsed = { decision, version: null, reason: 'x' };
        const view = describeResult({ ...runError, status, reference, expected_result: parsed, actual_result: parsed });
        assert.doesNotMatch(claims(view), safetyClaim, status + '/' + decision + '/' + reference);
      }
});

test('a missing reference is shown as not supplied, and a supplied one as matched or refused', () => {
  assert.match(describeResult(runCase(acceptCase)).reference.text, /No separately retained reference/);
  const matched = describeResult(runCase(acceptCase, { expectedCaseSha256: caseDigest(acceptCase) }));
  assert.equal(matched.reference.code, 'MATCH');
  assert.match(matched.reference.text, /Matches the separately retained reference/);
  const refused = describeResult(runCase(acceptCase, { expectedCaseSha256: '0'.repeat(64) }));
  assert.equal(refused.reference.code, 'MISMATCH');
  assert.equal(refused.outcome.code, 'INVALID_CASE');
  assert.equal(refused.parser.rows[0].expected, 'not read');
  assert.equal(refused.parser.rows[0].actual, 'not run');
});

test('a regression lists changed field paths with short digests and marks the changed parser field', () => {
  const parsed = { ...acceptCase.expected_execution.parsed, reason: 'ok:changed-expectation' };
  const altered = structuredClone(acceptCase);
  altered.expected_execution.parsed = parsed;
  altered.expected_execution.stdout_base64 = Buffer.from(JSON.stringify(parsed) + '\n').toString('base64');
  const view = describeResult(runCase(altered));
  assert.equal(view.outcome.code, 'REGRESSION');
  const reason = view.parser.rows.find(r => r.field === 'reason');
  assert.deepEqual([reason.expected, reason.changed], ['ok:changed-expectation', true]);
  assert.equal(reason.actual, acceptCase.expected_execution.parsed.reason);
  const field = view.changedFields.find(f => f.field === 'execution.parsed.reason');
  assert.ok(field);
  assert.match(field.expected, /^[a-f0-9]{12}…$/);
  assert.match(field.expectedFull, /^[a-f0-9]{64}$/);
});

test('an execution error is shown as no comparison, with the error and an unrun parser', () => {
  const view = describeResult(runError);
  assert.equal(view.outcome.label, 'Execution error');
  assert.match(view.outcome.detail, /no comparison was made/i);
  assert.equal(view.error, 'Runtime mismatch: use Node v22.18.0');
  const decision = view.parser.rows.find(r => r.field === 'decision');
  assert.deepEqual([decision.expected, decision.actual, decision.changed], ['REJECT', 'not run', false]);
});

test('a report summary keeps exit meaning, stable counts and the core limits', () => {
  const view = describeReport(runCases([acceptCase, rejectCase]));
  assert.equal(view.exitCode, 0);
  assert.match(view.exitMeaning, /reproduced/);
  assert.deepEqual(view.counts.map(c => c.code), ['MATCH', 'REGRESSION', 'INVALID_CASE', 'RUN_ERROR']);
  assert.deepEqual(view.counts.map(c => c.count), [2, 0, 0, 0]);
  assert.ok(view.limits.some(l => /not transaction safety/.test(l)));
  assert.equal(view.results.length, 2);
});

test('request failures are described by kind, with what did not happen', () => {
  const create = describeFailure('create', 500, { kind: 'RUN_ERROR', error: 'Runtime mismatch: use Node v22.18.0' });
  assert.equal(create.title, 'Execution error');
  assert.equal(create.detail, 'Runtime mismatch: use Node v22.18.0. No case was created.');
  const imported = describeFailure('import', 400, { kind: 'INVALID_CASE', error: 'Malformed case JSON' });
  assert.equal(imported.title, 'Case refused');
  assert.equal(imported.detail, 'Malformed case JSON. Nothing was imported.');
  const busy = describeFailure('run', 429, { kind: 'WORK_BUDGET', error: 'Local work budget used' }, '42');
  assert.match(busy.title, /limit/i);
  assert.equal(busy.detail, 'Local work budget used. No cases were run. Try again in 42 s.');
  assert.match(describeFailure('run', 0, null).title, /server/i);
});

test('a loaded case shows its saved parser decision as a saved expectation, with its origin', () => {
  const view = describeCase({ case: rejectCase, digest: caseDigest(rejectCase), source: 'imported' });
  assert.deepEqual([view.name, view.savedDecision, view.savedReason], ['truncated-reject', 'REJECT', 'truncated:message_prefix']);
  assert.equal(view.digest, caseDigest(rejectCase));
  assert.match(view.source, /imported/);
});

test('cases are held by unique name in a bounded list', () => {
  const entry = name => ({ case: { ...acceptCase, name }, digest: 'd' });
  let list = addCase([], entry('a'));
  assert.throws(() => addCase(list, entry('a')), /already/);
  for (let i = 1; i < MAX_LOADED_CASES; i++) list = addCase(list, entry('c' + i));
  assert.throws(() => addCase(list, entry('one-more')), /at most/);
});

test('rerun requests carry the cases and only deliberate references, never the page-computed digest', () => {
  const entry = (value, reference) => ({ case: value, digest: caseDigest(value), source: 'created', reference, selected: true });
  const noRefs = runRequest([entry(acceptCase, ''), entry(rejectCase, '  ')]);
  assert.deepEqual(noRefs, { cases: [acceptCase, rejectCase] });
  const someRefs = runRequest([entry(acceptCase, ' ' + 'a'.repeat(64) + '\n'), entry(rejectCase, '')]);
  assert.deepEqual(someRefs.references, ['a'.repeat(64), null]);
});

test('batch size problems are explained before any request', () => {
  assert.match(batchProblem(0), /Select/);
  assert.match(batchProblem(MAX_BATCH + 1), /at most/);
  assert.equal(batchProblem(1), null);
  assert.equal(batchProblem(MAX_BATCH), null);
});

test('exported case files are pretty JSON with a plain file name', () => {
  assert.equal(caseFileName('my case.v1'), 'my-case.v1.json');
  assert.equal(caseFileName('..'), 'case.json');
  const text = caseFileText(acceptCase);
  assert.ok(text.endsWith('}\n'));
  assert.equal(caseDigest(JSON.parse(text)), caseDigest(acceptCase));
});

test('interface sources never build markup from data or run inline code', () => {
  const scripts = read('public/cases.js') + read('public/cases-view.mjs');
  assert.doesNotMatch(scripts, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function|setAttribute\(\s*['"]on/);
  const html = read('public/cases.html');
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i);
  assert.deepEqual([...html.matchAll(/<script\b[^>]*>/g)].map(m => m[0]), ['<script type="module" src="/cases.js">']);
  assert.match(html, /<link rel="stylesheet" href="\/style.css">/);
  assert.ok(html.includes(SAFETY_NOTE), 'the page states the safety note verbatim without needing script');
});
