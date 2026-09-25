// Tests for the SDK adapter-case additions to the saved-case view model (public/cases-view.mjs). Authored by Claude.
// SDK report and case inputs are FIXTURES (test/fixtures/sdk-ui/, see MANIFEST.json): exact bodies produced by the
// accepted SDK engine, used here because backend integration is pending. They are not end-to-end evidence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runCases } from '../src/cases.mjs';
import { LEGACY_CASE_SCHEMA, SDK_CASE_SCHEMA, MAX_CASE_FILE_BYTES, MAX_SDK_CASE_FILE_BYTES, parseAdapterList, caseKind,
  createRequest, describeCase, describeReport, describeFailure, runRequest, runProblem, detailedAvailability,
  importProblem, caseFileSizeProblem, reportFileName } from '../public/cases-view.mjs';

const read = rel => fs.readFileSync(new URL('../' + rel, import.meta.url), 'utf8');
const fixture = name => JSON.parse(read('test/fixtures/sdk-ui/' + name));
const legacyAccept = JSON.parse(read('examples/cases/legacy-accept.json'));
const legacyReject = JSON.parse(read('examples/cases/truncated-reject.json'));
const sdkCase = fixture('case-sdk.fixture.json');
const sdkReject = fixture('create-sdk-reject.fixture.json').case;
const entry = (value, reference = '') => ({ case: value, digest: 'd', source: 'created', reference, selected: true });
const words = view => JSON.stringify(view);
const safetyClaim = /\bsafe(ty)?\b|\bpass(ed|es)?\b|\bverified\b|\bvalid transaction\b|\bapproved\b/i;
const claims = view => words(view).replaceAll('not a safety verdict', '');

test('the adapter list keeps only a registered id and label, never paths or other fields', () => {
  const body = fixture('adapters-list.fixture.json');
  const { adapters, problem } = parseAdapterList(body);
  assert.equal(problem, null);
  assert.equal(adapters.length, body.adapters.length);
  assert.deepEqual(adapters[0], { id: 'solana-kit-tx-decode', label: 'Pinned @solana/kit offline wire/message decode' });
  const hostile = parseAdapterList({ schema: body.schema, adapters: [
    { id: '../../etc/passwd', label: 'x', schema: SDK_CASE_SCHEMA },
    { id: 'ok-adapter', label: 'OK', schema: SDK_CASE_SCHEMA, entrypoint: '/Users/someone/adapter.mjs' },
    { id: 'other-schema', label: 'Other', schema: 'raven-replay-adapter-case/2' },
    { id: 'no-label', schema: SDK_CASE_SCHEMA },
  ] });
  assert.deepEqual(hostile.adapters, [{ id: 'ok-adapter', label: 'OK' }]);
  assert.doesNotMatch(words(hostile), /passwd|\/Users\//);
  assert.match(parseAdapterList({ schema: 'something-else', adapters: [] }).problem, /not an adapter list/);
  assert.match(parseAdapterList(null).problem, /not an adapter list/);
});

test('a create request names an adapter only when an SDK adapter is chosen', () => {
  assert.deepEqual(createRequest({ name: 'a', tx: ' AQID \n', adapterId: '' }), { name: 'a', input_base64: 'AQID' });
  const sdk = createRequest({ name: 'a', tx: 'AQID', adapterId: 'solana-kit-tx-decode' });
  assert.deepEqual(sdk, { name: 'a', input_base64: 'AQID', adapter_id: 'solana-kit-tx-decode' });
  assert.deepEqual(Object.keys(createRequest({ name: 'a', tx: 'AQID' })).sort(), ['input_base64', 'name']);
});

test('case kind is decided by the exact schema, never by guessing from structure', () => {
  assert.equal(LEGACY_CASE_SCHEMA, 'raven-replay-case/1');
  assert.equal(SDK_CASE_SCHEMA, 'raven-replay-adapter-case/1');
  assert.equal(caseKind(legacyAccept), 'legacy');
  assert.equal(caseKind(sdkCase), 'sdk');
  assert.equal(caseKind({ ...sdkCase, schema: 'raven-replay-adapter-case/2' }), 'unknown');
  const { schema, ...noSchema } = sdkCase;
  assert.equal(caseKind(noSchema), 'unknown');
  assert.equal(caseKind(null), 'unknown');
});

test('an SDK case shows its adapter and saved decision, never unpinned reason text', () => {
  const marked = structuredClone(sdkCase);
  marked.expected_execution.parsed.reason = 'SENTINEL-REASON-TEXT';
  const view = describeCase({ case: marked, digest: 'f'.repeat(64), source: 'imported' });
  assert.equal(view.kind, 'sdk');
  assert.match(view.kindLabel, /SDK adapter/);
  assert.equal(view.adapterId, 'solana-kit-tx-decode');
  assert.equal(view.savedDecision, 'ACCEPT');
  assert.equal(view.savedReason, null);
  assert.doesNotMatch(words(view), /SENTINEL-REASON-TEXT/);
  const legacy = describeCase({ case: legacyReject, digest: 'd', source: 'created' });
  assert.deepEqual([legacy.kind, legacy.savedDecision, legacy.savedReason], ['legacy', 'REJECT', 'truncated:message_prefix']);
  assert.match(legacy.kindLabel, /legacy/i);
});

test('an SDK batch shows all four outcomes as distinct facts, with pinned reason codes and digests only', () => {
  const report = fixture('run-sdk-four-outcomes.fixture.json');
  const view = describeReport(report);
  assert.equal(view.kind, 'sdk');
  assert.equal(view.detailed, false);
  assert.equal(view.exitCode, 3);
  assert.deepEqual(view.counts.map(c => [c.code, c.count]), [['MATCH', 2], ['REGRESSION', 1], ['INVALID_CASE', 1], ['RUN_ERROR', 1]]);
  const [match, changed, refused, error, rejectMatch] = view.results;
  assert.deepEqual([match.outcome.code, changed.outcome.code, refused.outcome.code, error.outcome.code, rejectMatch.outcome.code],
    ['MATCH', 'REGRESSION', 'INVALID_CASE', 'RUN_ERROR', 'MATCH']);
  // MATCH: pinned reason code shown, decoded output as a digest; nothing marked changed.
  const row = (r, field) => r.parser.rows.find(x => x.field === field);
  assert.deepEqual([row(match, 'decision').expected, row(match, 'decision').actual], ['ACCEPT', 'ACCEPT']);
  assert.equal(row(match, 'reason').expected, 'ok:legacy_wire_decode');
  assert.match(row(match, 'decoded').expected, /^digest [a-f0-9]{12}… · 3 fields$/);
  assert.ok(match.parser.rows.every(x => !x.changed));
  assert.equal(match.reference.code, 'MATCH');
  // An expected parser REJECT that reproduces is MATCH; its unpinned reason is a digest, never text.
  assert.deepEqual([row(rejectMatch, 'decision').expected, row(rejectMatch, 'decision').actual], ['REJECT', 'REJECT']);
  assert.match(row(rejectMatch, 'reason').expected, /^digest [a-f0-9]{12}… \(text not in default reports\)$/);
  assert.doesNotMatch(words(rejectMatch.outcome), /REJECT|ACCEPT/);
  // REGRESSION: changed field paths with short digests, and the decoded digest row marked changed.
  assert.ok(changed.changedFields.some(f => f.field === 'execution.parsed.decoded.message.header.numSignerAccounts'
    && /^[a-f0-9]{12}…$/.test(f.expected) && /^[a-f0-9]{64}$/.test(f.actualFull)));
  assert.equal(row(changed, 'decoded').changed, true);
  // INVALID_CASE: the reference mismatch is its own fact, and nothing was read or run.
  assert.equal(refused.reference.code, 'MISMATCH');
  assert.deepEqual([row(refused, 'decision').expected, row(refused, 'decision').actual], ['not read', 'not run']);
  // RUN_ERROR: never collapsed into a parser refusal; the typed error text is kept.
  assert.equal(error.execution, 'Not run');
  assert.equal(error.error, 'Adapter source bytes differ from case binding');
  assert.match(error.outcome.detail, /no comparison was made/i);
  assert.match(view.limits.join('\n'), /report omits raw input: true/);
});

test('no SDK outcome, reference or report view claims safety', () => {
  for (const name of ['run-sdk-four-outcomes.fixture.json', 'run-sdk-detailed-regression.fixture.json', 'run-sdk-match.fixture.json'])
    assert.doesNotMatch(claims(describeReport(fixture(name))), safetyClaim, name);
});

test('a detailed report is labelled as an opt-in export and never looks like a default report', () => {
  const view = describeReport(fixture('run-sdk-detailed-regression.fixture.json'));
  assert.equal(view.detailed, true);
  assert.match(view.detailedWarning, /opt-in/i);
  assert.match(view.detailedWarning, /reconstructible/i);
  assert.match(view.results[0].detailedLabel, /FULL_PARSED_PAYLOAD_OPT_IN/);
  assert.equal(describeReport(fixture('run-sdk-regression.fixture.json')).detailedWarning, null);
  assert.equal(describeReport(fixture('run-sdk-regression.fixture.json')).results[0].detailedLabel, null);
});

test('rerun requests carry detailed only on a deliberate opt-in for an all-SDK selection', () => {
  const sdkEntries = [entry(sdkCase), entry(sdkReject, ' ' + 'a'.repeat(64) + ' ')];
  assert.deepEqual(runRequest(sdkEntries), { cases: [sdkCase, sdkReject], references: [null, 'a'.repeat(64)] });
  assert.deepEqual(runRequest(sdkEntries, { detailed: true }),
    { cases: [sdkCase, sdkReject], references: [null, 'a'.repeat(64)], detailed: true });
  assert.deepEqual(runRequest([entry(sdkCase)], { detailed: false }), { cases: [sdkCase] });
  assert.equal(runProblem(sdkEntries, { detailed: true }), null);
  assert.equal(runProblem([entry(legacyAccept)], {}), null);
});

test('mixed, unknown and detailed-legacy selections are refused before any request', () => {
  assert.match(runProblem([entry(legacyAccept), entry(sdkCase)], {}), /Mixed batches are refused/);
  assert.match(runProblem([entry(legacyAccept)], { detailed: true }), /only for SDK adapter cases/);
  assert.match(runProblem([entry({ ...sdkCase, schema: 'x' })], {}), /not a supported case schema/);
  assert.match(runProblem([], {}), /Select at least one/);
  assert.equal(detailedAvailability([entry(sdkCase), entry(sdkReject)]).available, true);
  assert.equal(detailedAvailability([entry(sdkCase), entry(legacyAccept)]).available, false);
  assert.match(detailedAvailability([]).reason, /every selected case/);
});

test('report files keep the legacy name and give SDK and detailed reports distinct names', () => {
  assert.equal(reportFileName(runCases([legacyAccept])), 'raven-replay-case-report.json');
  assert.equal(reportFileName(fixture('run-sdk-match.fixture.json')), 'raven-replay-adapter-case-report.json');
  assert.match(reportFileName(fixture('run-sdk-detailed-regression.fixture.json')), /DETAILED-OPT-IN\.json$/);
});

test('import size limits follow the case schema, and the legacy limit stays 128 KB', () => {
  assert.equal(MAX_CASE_FILE_BYTES, 128 * 1024);
  assert.equal(MAX_SDK_CASE_FILE_BYTES, 256 * 1024);
  const padded = (value, bytes) => { const t = JSON.stringify(value); return t + ' '.repeat(Math.max(0, bytes - t.length)); };
  assert.match(importProblem(padded(legacyAccept, 130 * 1024)), /Legacy case files are at most 128 KB/);
  assert.equal(importProblem(padded(sdkCase, 200 * 1024)), null);
  assert.match(importProblem(padded(sdkCase, 257 * 1024)), /at most 256 KB/);
  assert.equal(importProblem('not json at all'), null);   // the local server decides and names the refusal
  assert.match(importProblem('   '), /Paste case JSON first/);
  assert.equal(caseFileSizeProblem(MAX_SDK_CASE_FILE_BYTES), null);
  assert.match(caseFileSizeProblem(MAX_SDK_CASE_FILE_BYTES + 1), /at most 256 KB/);
});

test('typed server failures stay typed and say what did not happen', () => {
  const mixed = describeFailure('run', 400, { kind: 'INVALID_CASE', error: 'Mixed legacy/SDK batches are not supported; use a homogeneous batch' });
  assert.deepEqual([mixed.title, mixed.detail], ['Case refused', 'Mixed legacy/SDK batches are not supported; use a homogeneous batch. No cases were run.']);
  const create = describeFailure('create', 500, { kind: 'RUN_ERROR', error: 'Incomplete adapter execution cannot be saved as an expected result (timeout)' });
  assert.equal(create.title, 'Execution error');
  assert.match(create.detail, /No case was created\.$/);
  assert.equal(describeFailure('run', 500, { kind: 'INTERNAL', error: 'Unexpected local server failure' }).title, 'Local server failure');
  assert.equal(describeFailure('run', 400, { kind: 'REQUEST', error: 'detailed=true is only supported for SDK adapter-case batches' }).title, 'Malformed request');
});

test('the page offers the legacy inspector by default and the detailed opt-in starts off', () => {
  const html = read('public/cases.html');
  assert.match(html, /<select id="case-tool"[^>]*><option value="">[^<]*legacy[^<]*<\/option>/i);
  const detailed = html.match(/<input[^>]*id="run-detailed"[^>]*>/);
  assert.ok(detailed, 'detailed opt-in control present');
  assert.doesNotMatch(detailed[0], /\bchecked\b/);
  assert.match(html, /reconstructible/);
});

const vendored = new URL('../vendor/raven-replay-parser-sdk/src/cases.mjs', import.meta.url);
test('the SDK case-file limit equals the vendored SDK limit (after backend integration)',
  { skip: fs.existsSync(vendored) ? false : 'vendored SDK not present in this UI-only successor; runs after CODEX integration' },
  async () => {
    const sdk = await import(vendored.href);
    assert.equal(MAX_SDK_CASE_FILE_BYTES, sdk.MAX_CASE_BYTES);
    assert.equal(SDK_CASE_SCHEMA, sdk.CASE_SCHEMA);
  });
