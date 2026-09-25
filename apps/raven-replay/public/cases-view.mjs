// Pure view model for the saved-case page: no DOM, no network, plain text only (rendered with textContent).
// Authored by Claude. Loaded by the browser as /cases-view.mjs and by the node tests.
export const MAX_BATCH = 10;                     // equals MAX_CASES in src/cases.mjs (test-enforced)
export const MAX_CASE_FILE_BYTES = 128 * 1024;   // equals MAX_CASE_BYTES in src/cases.mjs (test-enforced)
export const MAX_TX_FILE_BYTES = 24000;          // the original capture page's file bound
export const MAX_LOADED_CASES = 50;
export const REPORT_FILE_NAME = 'raven-replay-case-report.json';
export const SAFETY_NOTE = 'MATCH means the saved expectation reproduced. It never means the transaction is safe. An expected parser REJECT can MATCH.';

// SDK adapter cases (backend contract r3). The case kind is decided by the exact schema string, never by structure.
export const LEGACY_CASE_SCHEMA = 'raven-replay-case/1';
export const SDK_CASE_SCHEMA = 'raven-replay-adapter-case/1';
export const ADAPTER_LIST_SCHEMA = 'raven-replay-adapter-list/1';
export const MAX_SDK_CASE_FILE_BYTES = 256 * 1024;   // equals MAX_CASE_BYTES of the vendored SDK (test-enforced once vendored)
const LEGACY_REPORT_SCHEMA = 'raven-replay-case-report/1';
const SDK_REPORT_SCHEMA = 'raven-replay-adapter-case-report/1';
const SDK_DETAILED_REPORT_SCHEMA = SDK_REPORT_SCHEMA + '-detailed';
const ADAPTER_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;   // the SDK's own adapter-id rule; the local server re-checks it

const OUTCOMES = {
  MATCH: ['Reproduced', 'The new run matched every saved execution field.'],
  REGRESSION: ['Changed', 'The pinned tool completed, but its execution differs from the saved expectation.'],
  INVALID_CASE: ['Case refused', 'The case or its supplied reference was not accepted, so no comparison was made.'],
  RUN_ERROR: ['Execution error', 'The pinned tool did not produce a complete run, so no comparison was made.'],
};
const SDK_OUTCOMES = {
  MATCH: ['Reproduced', 'The pinned adapter run matched the saved expected result.'],
  REGRESSION: ['Changed', 'The pinned adapter completed, but its result differs from the saved expectation.'],
  INVALID_CASE: OUTCOMES.INVALID_CASE,
  RUN_ERROR: ['Execution error', 'The pinned adapter did not produce a complete run, so no comparison was made.'],
};
const REFERENCES = {
  NOT_PROVIDED: 'No separately retained reference supplied. Replacing this case together with its expectation would not be detected.',
  MATCH: 'Matches the separately retained reference you supplied.',
  MISMATCH: 'Differs from the reference you supplied: this is not the case you retained.',
  NOT_CHECKED: 'A reference was supplied but not checked, because the case was refused first.',
};
const EXECUTION = { COMPLETE: 'Complete', INCOMPLETE: 'Incomplete', NOT_RUN: 'Not run' };
const EXIT = ['All cases reproduced their saved expectations.', 'At least one case changed.',
  'At least one case was refused.', 'At least one case hit an execution error.'];
const FAILURES = { INVALID_CASE: 'Case refused', RUN_ERROR: 'Execution error', BUSY: 'Busy with another request',
  WORK_BUDGET: 'Local work limit reached', TOO_LARGE: 'Too large', TIMEOUT: 'Timed out', FORBIDDEN: 'Refused by the local server',
  REQUEST: 'Malformed request', NOT_FOUND: 'Not found', INTERNAL: 'Local server failure' };
const NOTHING = { create: 'No case was created.', import: 'Nothing was imported.', run: 'No cases were run.' };

const text = v => typeof v === 'string' ? v : JSON.stringify(v);
const short = h => typeof h === 'string' ? h.slice(0, 12) + '…' : '—';

export function caseKind(value) {
  const schema = value !== null && typeof value === 'object' ? value.schema : undefined;
  return schema === LEGACY_CASE_SCHEMA ? 'legacy' : schema === SDK_CASE_SCHEMA ? 'sdk' : 'unknown';
}

// An SDK case shows its adapter, saved decision and version. Its reason text stays in the case file: default reports
// show only pinned reason codes or digests, and this page follows the same rule.
export function describeCase({ case: c, digest, source }) {
  const kind = caseKind(c);
  const parsed = c.expected_execution?.parsed ?? {};
  return { name: c.name, digest, source: source === 'created' ? 'created in this page' : 'imported',
    kind, adapterId: kind === 'sdk' ? c.adapter_id : null,
    kindLabel: kind === 'sdk' ? 'SDK adapter · ' + c.adapter_id : kind === 'legacy' ? 'Legacy inspector' : 'Unknown case schema',
    savedDecision: parsed.decision, savedVersion: parsed.version ?? null, savedReason: kind === 'sdk' ? null : parsed.reason };
}

// Default SDK reports carry pinned reason codes, digests and decoded field names; a detailed opt-in report carries the raw
// parsed result. Both are shown as reported and never re-derived here.
function sdkCell(result, field) {
  if (field === 'reason') {
    if (typeof result.reason === 'string') return result.reason;
    if (typeof result.reason_code === 'string') return result.reason_code;
    return typeof result.reason_sha256 === 'string' ? 'digest ' + short(result.reason_sha256) + ' (text not in default reports)' : 'not given';
  }
  if (field === 'decoded') {
    const d = result.decoded;
    if (d === null || d === undefined) return 'none';
    if (typeof d.decoded_sha256 === 'string') return 'digest ' + short(d.decoded_sha256) + ' · ' + (d.field_names?.length ?? 0) + ' fields';
    return 'full payload (detailed opt-in)';
  }
  return text(result[field]);
}
function sdkKey(result, field) {
  if (field === 'reason') return result.reason ?? result.reason_code ?? result.reason_sha256 ?? null;
  if (field === 'decoded') return result.decoded?.decoded_sha256 ?? JSON.stringify(result.decoded ?? null);
  return text(result[field]);
}

export function describeResult(r, kind = 'legacy') {
  const sdk = kind === 'sdk';
  const [label, detail] = (sdk ? SDK_OUTCOMES : OUTCOMES)[r.status] ?? ['Unknown outcome', 'The report used an outcome this page does not know.'];
  const both = Boolean(r.expected_result && r.actual_result);
  const rows = (sdk ? ['decision', 'version', 'reason', 'decoded'] : ['decision', 'version', 'reason']).map(field => {
    const cell = (value, missing) => !value ? missing : sdk ? sdkCell(value, field) : text(value[field]);
    const expected = cell(r.expected_result, 'not read');
    const actual = cell(r.actual_result, 'not run');
    const changed = both && (sdk ? sdkKey(r.expected_result, field) !== sdkKey(r.actual_result, field) : expected !== actual);
    return { field, expected, actual, changed };
  });
  const detailed = sdk && r.detailed_export === true;
  return {
    name: String(r.name),
    outcome: { code: r.status, label, detail, exitCode: r.exit_code },
    parser: sdk
      ? { note: 'Adapter decision is the adapter’s output, not a safety verdict. Default reports show pinned reason codes and digests only.', fieldHeader: 'Adapter field', rows }
      : { note: 'Parser decision is the tool’s byte-structure output, not a safety verdict.', fieldHeader: 'Parser field', rows },
    reference: { code: r.reference, text: REFERENCES[r.reference] ?? 'Unknown reference state.' },
    execution: EXECUTION[r.execution] ?? String(r.execution),
    digest: r.case_content_sha256 ?? 'not computed',
    changedFields: (r.differences ?? []).map(d => ({ field: d.field, expected: short(d.expected_value_sha256),
      actual: short(d.actual_value_sha256), expectedFull: d.expected_value_sha256, actualFull: d.actual_value_sha256 })),
    changedNote: !sdk ? null : detailed ? 'Detailed opt-in: raw field paths as the adapter produced them.'
      : 'Field labels are pinned names or field_ digest labels; unpinned names never appear in default reports.',
    detailedLabel: detailed && typeof r.detailed_export_label === 'string' ? r.detailed_export_label : null,
    detailedPayload: detailed ? JSON.stringify({ expected: r.expected_result, actual: r.actual_result }, null, 2) : null,
    error: r.error ?? null,
  };
}

export function describeReport(report) {
  const schema = report?.schema;
  const kind = schema === SDK_REPORT_SCHEMA || schema === SDK_DETAILED_REPORT_SCHEMA ? 'sdk' : schema === LEGACY_REPORT_SCHEMA ? 'legacy' : 'unknown';
  const detailed = schema === SDK_DETAILED_REPORT_SCHEMA;
  return {
    kind, detailed,
    kindLabel: kind === 'sdk' ? (detailed ? 'SDK adapter report — detailed, opt-in' : 'SDK adapter report (default)')
      : kind === 'legacy' ? 'Legacy inspector report' : 'Report schema not recognised by this page; values are shown as reported.',
    detailedWarning: detailed ? 'Detailed export (opt-in): this report may contain reconstructible transaction, message or signature bytes and ' +
      'unsanitized field paths. It is not the default report; share it only if you mean to.' : null,
    fileName: reportFileName(report),
    exitCode: report.exit_code,
    exitMeaning: EXIT[report.exit_code] ?? 'Unknown exit code.',
    counts: Object.keys(OUTCOMES).map(code => ({ code, label: OUTCOMES[code][0], count: report.counts?.[code] ?? 0 })),
    results: (report.results ?? []).map(r => describeResult(r, kind === 'sdk' ? 'sdk' : 'legacy')),
    limits: Object.entries(report.limits ?? {}).map(([k, v]) => k.replaceAll('_', ' ') + ': ' + v),
  };
}

export function reportFileName(report) {
  if (report?.schema === SDK_DETAILED_REPORT_SCHEMA) return 'raven-replay-adapter-case-report.DETAILED-OPT-IN.json';
  if (report?.schema === SDK_REPORT_SCHEMA) return 'raven-replay-adapter-case-report.json';
  return REPORT_FILE_NAME;
}

// Only a registered id and its label are kept for display; anything else in the answer (paths, entrypoints) is ignored.
export function parseAdapterList(body) {
  if (body === null || typeof body !== 'object' || body.schema !== ADAPTER_LIST_SCHEMA || !Array.isArray(body.adapters))
    return { adapters: [], problem: 'The local server’s answer is not an adapter list, so only the bundled legacy inspector is offered.' };
  const adapters = body.adapters
    .filter(a => a !== null && typeof a === 'object' && typeof a.id === 'string' && ADAPTER_ID.test(a.id)
      && typeof a.label === 'string' && a.label.length > 0 && a.schema === SDK_CASE_SCHEMA)
    .map(a => ({ id: a.id, label: a.label }));
  return { adapters, problem: null };
}

export function createRequest({ name, tx, adapterId }) {
  const request = { name, input_base64: String(tx ?? '').trim() };
  return adapterId ? { ...request, adapter_id: adapterId } : request;
}

export function describeFailure(action, status, body, retryAfter) {
  const kind = typeof body?.kind === 'string' ? body.kind : null;
  const message = typeof body?.error === 'string' ? body.error : 'The local server did not answer' + (status ? ' (HTTP ' + status + ')' : '') + '.';
  const retry = retryAfter ? ' Try again in ' + retryAfter + ' s.' : '';
  const sentence = message.replace(/([^.!?…])$/, '$1.');   // core messages carry no final stop
  return { kind: kind ?? 'UNKNOWN', title: FAILURES[kind] ?? 'Local server error',
    detail: (sentence + ' ' + (NOTHING[action] ?? '')).trim() + retry };
}

export function addCase(list, entry) {
  if (list.some(e => e.case.name === entry.case.name))
    throw new Error('A case named "' + entry.case.name + '" is already loaded. Remove it first if you mean to replace it.');
  if (list.length >= MAX_LOADED_CASES) throw new Error('This page holds at most ' + MAX_LOADED_CASES + ' cases. Remove one first.');
  return [...list, entry];
}

// A blank reference means "none supplied" (null); the page never fills one in for the user. `detailed` is sent only
// when the user deliberately opted in for this run; otherwise the request keeps its original shape.
export function runRequest(entries, { detailed = false } = {}) {
  const cases = entries.map(e => e.case);
  const references = entries.map(e => (e.reference ?? '').trim() || null);
  const request = references.some(r => r !== null) ? { cases, references } : { cases };
  return detailed === true ? { ...request, detailed: true } : request;
}

export function batchProblem(count) {
  if (count < 1) return 'Select at least one case to rerun.';
  if (count > MAX_BATCH) return 'Rerun at most ' + MAX_BATCH + ' cases at a time; ' + count + ' are selected.';
  return null;
}

// Everything the local server would refuse about a selection, said before any request is sent.
export function runProblem(entries, { detailed = false } = {}) {
  const size = batchProblem(entries.length);
  if (size) return size;
  const kinds = new Set(entries.map(e => caseKind(e.case)));
  if (kinds.has('unknown')) return 'A selected case is not a supported case schema, so nothing was sent.';
  if (kinds.size > 1) return 'Select only legacy cases or only SDK adapter cases. Mixed batches are refused, so nothing was sent.';
  if (detailed === true && !kinds.has('sdk')) return 'Detailed output exists only for SDK adapter cases, so nothing was sent.';
  return null;
}

export function detailedAvailability(entries) {
  return entries.length > 0 && entries.every(e => caseKind(e.case) === 'sdk')
    ? { available: true, reason: null }
    : { available: false, reason: 'Detailed output is available only when every selected case is an SDK adapter case.' };
}

// Size limits follow the case schema: legacy cases stay at 128 KB, SDK adapter cases may reach 256 KB. Malformed JSON is
// left to the local server, which names the refusal.
export function caseFileSizeProblem(bytes) {
  return bytes > MAX_SDK_CASE_FILE_BYTES ? 'Case files are at most 256 KB (SDK adapter cases) or 128 KB (legacy cases). Nothing was imported.' : null;
}

export function importProblem(text) {
  if (!String(text).trim()) return 'Paste case JSON first. Nothing was imported.';
  const bytes = new TextEncoder().encode(text).length;
  if (caseFileSizeProblem(bytes)) return caseFileSizeProblem(bytes);
  let schema = null;
  try { schema = JSON.parse(text)?.schema ?? null; } catch { schema = null; }
  if (schema === LEGACY_CASE_SCHEMA && bytes > MAX_CASE_FILE_BYTES) return 'Legacy case files are at most 128 KB. Nothing was imported.';
  return null;
}

export function caseFileName(name) {
  return (String(name).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[.-]+/, '') || 'case') + '.json';
}
export const caseFileText = value => JSON.stringify(value, null, 2) + '\n';
