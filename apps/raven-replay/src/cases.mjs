import fs from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { capture, canonical, sha, transactionBytes, NODE_VERSION, TOOL_PATH, TOOL_SHA, POLICY, POLICY_SHA } from './action.mjs';

export const MAX_CASE_BYTES = 128 * 1024;
export const MAX_CASES = 10;
export const CASE_SCHEMA = 'raven-replay-case/1';
export const STATUS = Object.freeze({ MATCH: 0, REGRESSION: 1, INVALID_CASE: 2, RUN_ERROR: 3 });
const bindings = Object.freeze({ runtime: NODE_VERSION, tool: POLICY.tool, tool_sha256: TOOL_SHA, policy_sha256: POLICY_SHA });
const limits = Object.freeze({
  meaning: 'Comparison with a saved expected execution; not transaction safety or historical execution proof.',
  reference: 'A case digest is useful only if retained independently. Replacing a case and its reference together is not detected.',
  caller_identity: 'NOT_ESTABLISHED', chain_anchor: 'NOT_CHECKED',
});
const exact = (o, keys) => o !== null && typeof o === 'object' && !Array.isArray(o) &&
  isDeepStrictEqual(Object.keys(o).sort(), [...keys].sort());
const validName = s => typeof s === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._ -]{0,63}$/.test(s);
const hex = s => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);

export class CaseError extends Error {
  constructor(kind, message) { super(message); this.kind = kind; }
}
const invalid = message => { throw new CaseError('INVALID_CASE', message); };
export function caseDigest(value) { return sha(canonical(value)); }

function outputBytes(text) {
  if (typeof text !== 'string' || text.length > Math.ceil(POLICY.max_output_bytes / 3) * 4) invalid('Invalid expected output size');
  const b = Buffer.from(text, 'base64');
  if (b.length > POLICY.max_output_bytes || b.toString('base64') !== text) invalid('Invalid expected output encoding');
  return b;
}

export function validateCase(value) {
  try {
    if (Buffer.byteLength(JSON.stringify(value)) > MAX_CASE_BYTES) invalid('Case exceeds size limit');
    if (!exact(value, ['schema', 'name', 'bindings', 'input_base64', 'input_sha256', 'expected_execution']) || value.schema !== CASE_SCHEMA)
      invalid('Unsupported case schema or fields');
    if (!validName(value.name)) invalid('Case name must be 1–64 simple printable characters');
    if (!isDeepStrictEqual(value.bindings, bindings)) invalid('Unsupported runtime, tool or policy binding');
    if (sha(transactionBytes(value.input_base64)) !== value.input_sha256) invalid('Input digest mismatch');
    const e = value.expected_execution;
    if (!exact(e, ['complete', 'exit_code', 'signal', 'error_code', 'stdin_sha256', 'stdout_base64', 'stderr_base64', 'parsed']) ||
        e.complete !== true || e.exit_code !== 0 || e.signal !== null || e.error_code !== null)
      invalid('Expected execution must be complete; infrastructure failures cannot become passing baselines');
    if (e.stdin_sha256 !== sha(JSON.stringify({ tx_base64: value.input_base64 }) + '\n')) invalid('Expected input transcript mismatch');
    if (!exact(e.parsed, ['decision', 'version', 'reason']) || !['ACCEPT', 'REJECT'].includes(e.parsed.decision) ||
        !['legacy', 0, 1, null].includes(e.parsed.version) || typeof e.parsed.reason !== 'string') invalid('Invalid expected parser result');
    const stdout = outputBytes(e.stdout_base64);
    outputBytes(e.stderr_base64);
    if (!isDeepStrictEqual(JSON.parse(stdout.toString('utf8')), e.parsed)) invalid('Expected parsed result disagrees with its stdout');
    return value;
  } catch (error) {
    if (error instanceof CaseError) throw error;
    invalid('Malformed case content');
  }
}

export function parseCase(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_CASE_BYTES) invalid('Case exceeds size limit');
  try { return validateCase(JSON.parse(text)); }
  catch (error) { if (error instanceof CaseError) throw error; invalid('Malformed case JSON'); }
}

function preflight() {
  if (process.version !== NODE_VERSION) throw new CaseError('RUN_ERROR', 'Runtime mismatch: use Node ' + NODE_VERSION);
  try { if (sha(fs.readFileSync(TOOL_PATH)) !== TOOL_SHA) throw new Error(); }
  catch { throw new CaseError('RUN_ERROR', 'Local pinned tool is missing or changed'); }
}

export function createCase(inputBase64, { name } = {}) {
  if (!validName(name)) invalid('Case name must be 1–64 simple printable characters');
  try { transactionBytes(inputBase64); } catch { invalid('Invalid transaction base64'); }
  preflight();
  let execution;
  try { execution = capture(inputBase64, { caller: 'saved-case creation (self-declared)' }).envelope.body.execution; }
  catch { throw new CaseError('RUN_ERROR', 'Could not execute the pinned tool'); }
  if (!execution.complete) throw new CaseError('RUN_ERROR', 'Incomplete tool execution cannot be saved as an expected result');
  const value = validateCase({ schema: CASE_SCHEMA, name, bindings: { ...bindings }, input_base64: inputBase64,
    input_sha256: sha(transactionBytes(inputBase64)), expected_execution: execution });
  return { case: value, case_content_sha256: caseDigest(value), limits };
}

function differences(expected, actual, prefix = 'execution') {
  const out = [];
  for (const key of Object.keys(expected)) {
    if (isDeepStrictEqual(expected[key], actual[key])) continue;
    if (key === 'parsed' && expected[key] && actual[key]) out.push(...differences(expected[key], actual[key], prefix + '.parsed'));
    else out.push({ field: prefix + '.' + key, expected_value_sha256: sha(canonical(expected[key])), actual_value_sha256: sha(canonical(actual[key])) });
  }
  return out;
}

export function runCase(value, { expectedCaseSha256 } = {}) {
  const result = { name: validName(value?.name) ? value.name : 'invalid-case', status: 'INVALID_CASE', exit_code: 2,
    case_content_sha256: null, reference: expectedCaseSha256 === undefined ? 'NOT_PROVIDED' : 'NOT_CHECKED',
    execution: 'NOT_RUN', expected_result: null, actual_result: null, differences: [], error: null };
  try {
    validateCase(value);
    result.case_content_sha256 = caseDigest(value);
    if (expectedCaseSha256 !== undefined) {
      if (!hex(expectedCaseSha256)) invalid('Malformed expected case digest');
      result.reference = expectedCaseSha256 === result.case_content_sha256 ? 'MATCH' : 'MISMATCH';
      if (result.reference !== 'MATCH') invalid('Case differs from the supplied reference');
    }
    result.expected_result = value.expected_execution.parsed;
    preflight();
    let actual;
    try { actual = capture(value.input_base64, { caller: 'saved-case run (self-declared)' }).envelope.body.execution; }
    catch { throw new CaseError('RUN_ERROR', 'Could not execute the pinned tool'); }
    result.execution = actual.complete ? 'COMPLETE' : 'INCOMPLETE';
    result.actual_result = actual.parsed;
    if (!actual.complete) throw new CaseError('RUN_ERROR', 'Pinned tool did not complete; this is not a regression verdict');
    result.differences = differences(value.expected_execution, actual);
    result.status = result.differences.length ? 'REGRESSION' : 'MATCH';
    result.exit_code = STATUS[result.status];
  } catch (error) {
    result.status = error instanceof CaseError ? error.kind : 'RUN_ERROR';
    result.exit_code = STATUS[result.status];
    result.error = error instanceof CaseError ? error.message : 'Unexpected runner failure';
  }
  return result;
}

export function runCases(cases, { expectedCaseSha256s } = {}) {
  if (!Array.isArray(cases) || cases.length < 1 || cases.length > MAX_CASES) invalid('Supply between 1 and ' + MAX_CASES + ' cases');
  if (expectedCaseSha256s !== undefined && (!Array.isArray(expectedCaseSha256s) || expectedCaseSha256s.length !== cases.length)) invalid('Reference count must match case count');
  const names = cases.map(c => c?.name);
  if (new Set(names).size !== names.length) invalid('Case names must be unique in a batch');
  const results = cases.map((c, i) => runCase(c, { expectedCaseSha256: expectedCaseSha256s?.[i] }));
  const counts = Object.fromEntries(Object.keys(STATUS).map(s => [s, results.filter(r => r.status === s).length]));
  return { schema: 'raven-replay-case-report/1', exit_code: Math.max(...results.map(r => r.exit_code)), counts, results, limits };
}
