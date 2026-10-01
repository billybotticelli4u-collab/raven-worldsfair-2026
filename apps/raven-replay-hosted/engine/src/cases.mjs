import fs from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import {
  executeAdapter, resolveExecutionIdentity, NODE_VERSION, POLICY_SHA,
  DEFAULT_COMPARISON_POLICY, DEFAULT_COMPARISON_POLICY_SHA, MAX_INPUT_BYTES,
} from './runner.mjs';
import { sha } from './binding.mjs';
import { canonical, normalizeValue } from './normalize.mjs';
import { PINNED_REASON_CODES, PINNED_FIELD_NAMES, PIN_MAP_ID } from './report-pin-map.mjs';
export { PINNED_REASON_CODES, PINNED_FIELD_NAMES, PIN_MAP_ID };

export const MAX_CASE_BYTES = 256 * 1024;
export const MAX_CASES = 20;
export const CASE_SCHEMA = 'raven-replay-adapter-case/1';
export const STATUS = Object.freeze({ MATCH: 0, REGRESSION: 1, INVALID_CASE: 2, RUN_ERROR: 3 });

export class CaseError extends Error {
  constructor(kind, message) { super(message); this.kind = kind; }
}
const invalid = (m) => { throw new CaseError('INVALID_CASE', m); };
const runErr = (m) => { throw new CaseError('RUN_ERROR', m); };

export function caseDigest(value) { return sha(canonical(value)); }

const exact = (o, keys) => o !== null && typeof o === 'object' && !Array.isArray(o) &&
  isDeepStrictEqual(Object.keys(o).sort(), [...keys].sort());
const validName = (s) => typeof s === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._ -]{0,63}$/.test(s);
const hex = (s) => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
const validAdapterId = (s) => typeof s === 'string' && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(s);

/**
 * Cases are data. They may identify an already registered adapter_id.
 * They MUST NOT supply code, commands, paths, package names to install, URLs,
 * shell arguments or environment variables.
 */
export function validateCase(value) {
  try {
    // Digest path uses canonical() which rejects unsupported types / preserves keys.
    // Force a normalize pass over the whole case early so __proto__/Map issues surface
    // as INVALID_CASE before execution when content is digest-checked.
    try { canonical(value); } catch (e) { invalid('Case fails canonicalisation: ' + (e.message || e)); }
    if (Buffer.byteLength(JSON.stringify(value)) > MAX_CASE_BYTES) invalid('Case exceeds size limit');
    const required = [
      'schema', 'name', 'adapter_id', 'bindings', 'input_base64', 'input_sha256',
      'expected_execution', 'comparison_policy',
    ];
    if (!exact(value, required) || value.schema !== CASE_SCHEMA) invalid('Unsupported case schema or fields');
    if (!validName(value.name)) invalid('Case name must be 1–64 simple printable characters');
    if (!validAdapterId(value.adapter_id)) invalid('Invalid adapter_id');
    const b = value.bindings;
    const bindKeys = [
      'runtime', 'tool', 'adapter_id', 'adapter_source_sha256',
      'dependency_binding_sha256', 'policy_sha256', 'comparison_policy_sha256',
    ];
    if (!exact(b, bindKeys)) invalid('Unsupported bindings fields');
    if (b.runtime !== NODE_VERSION) invalid('Unsupported runtime binding');
    if (b.adapter_id !== value.adapter_id) invalid('bindings.adapter_id mismatch');
    if (!hex(b.adapter_source_sha256) || !hex(b.dependency_binding_sha256) || !hex(b.policy_sha256) || !hex(b.comparison_policy_sha256)) {
      invalid('Binding digests must be 64-char hex');
    }
    if (b.policy_sha256 !== POLICY_SHA) invalid('Unsupported policy binding');
    if (typeof b.tool !== 'string' || b.tool.length > 120) invalid('Invalid tool identity');
    if (!isDeepStrictEqual(value.comparison_policy, DEFAULT_COMPARISON_POLICY)) {
      invalid('Unsupported comparison_policy');
    }
    if (b.comparison_policy_sha256 !== DEFAULT_COMPARISON_POLICY_SHA) invalid('comparison_policy digest mismatch');
    let inputBytes;
    try {
      inputBytes = Buffer.from(value.input_base64, 'base64');
      if (inputBytes.length > MAX_INPUT_BYTES || inputBytes.toString('base64') !== value.input_base64) throw new Error();
    } catch { invalid('Invalid input_base64'); }
    if (sha(inputBytes) !== value.input_sha256) invalid('Input digest mismatch');

    const e = value.expected_execution;
    if (!exact(e, ['complete', 'exit_code', 'signal', 'error_code', 'stdin_sha256', 'stdout_base64', 'stderr_base64', 'parsed', 'protocol_ok'])) {
      invalid('Invalid expected_execution fields');
    }
    if (e.complete !== true || e.exit_code !== 0 || e.signal !== null || e.error_code !== null || e.protocol_ok !== true) {
      invalid('Expected execution must be complete; infrastructure failures cannot become passing baselines');
    }
    if (!hex(e.stdin_sha256)) invalid('Invalid stdin digest');
    const p = e.parsed;
    if (!exact(p, ['decision', 'version', 'reason', 'decoded']) ||
        !['ACCEPT', 'REJECT'].includes(p.decision) ||
        !(p.version === 'legacy' || p.version === 0 || p.version === null) ||
        typeof p.reason !== 'string') {
      invalid('Invalid expected parser result');
    }
    if (p.decision === 'REJECT' && p.decoded !== null) invalid('REJECT must have decoded:null');
    if (p.decision === 'ACCEPT' && (p.decoded === null || typeof p.decoded !== 'object')) invalid('ACCEPT requires decoded object');
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

export function createCase(inputBase64, { name, adapterId } = {}) {
  if (!validName(name)) invalid('Case name must be 1–64 simple printable characters');
  if (!validAdapterId(adapterId)) invalid('Invalid adapter_id');
  let identity;
  try { identity = resolveExecutionIdentity(adapterId); }
  catch (e) {
    if (e.code === 'UNKNOWN_ADAPTER') invalid('Unknown adapter id (register locally before create)');
    if (e.code === 'RUNTIME_MISMATCH') runErr(e.message);
    runErr(e.message || 'Could not resolve adapter identity');
  }
  let run;
  try { run = executeAdapter(adapterId, inputBase64, { comparisonPolicy: DEFAULT_COMPARISON_POLICY }); }
  catch (e) {
    if (e.message?.includes('base64') || e.message?.includes('input')) invalid(e.message);
    runErr('Could not execute adapter: ' + (e.message || 'unknown'));
  }
  if (!run.execution.complete) runErr('Incomplete adapter execution cannot be saved as an expected result (' + (run.execution.protocol_reason || run.execution.error_code || 'incomplete') + ')');

  const value = validateCase({
    schema: CASE_SCHEMA,
    name,
    adapter_id: adapterId,
    bindings: {
      runtime: identity.runtime,
      tool: identity.tool,
      adapter_id: identity.adapter_id,
      adapter_source_sha256: identity.adapter_source_sha256,
      dependency_binding_sha256: identity.dependency_binding_sha256,
      policy_sha256: identity.policy_sha256,
      comparison_policy_sha256: DEFAULT_COMPARISON_POLICY_SHA,
    },
    input_base64: inputBase64,
    input_sha256: sha(Buffer.from(inputBase64, 'base64')),
    comparison_policy: { ...DEFAULT_COMPARISON_POLICY },
    expected_execution: {
      complete: true,
      exit_code: run.execution.exit_code,
      signal: run.execution.signal,
      error_code: run.execution.error_code,
      stdin_sha256: run.execution.stdin_sha256,
      stdout_base64: run.execution.stdout_base64,
      stderr_base64: run.execution.stderr_base64,
      protocol_ok: true,
      parsed: run.execution.parsed,
    },
  });
  return {
    case: value,
    case_content_sha256: caseDigest(value),
    limits: {
      meaning: 'Comparison with a saved expected adapter execution; not transaction safety or historical execution proof.',
      cases_are_data: 'A case identifies a registered adapter_id only; it cannot supply code, commands, paths, packages, URLs, shell args or env.',
      digests: 'Consistency of measured bytes — not publisher authentication.',
      subprocess: 'Bounded subprocess is not a security sandbox.',
      dependencies: 'This successor introduces npm dependencies; accepted legacy Replay package had none.',
      raw_input: 'Exported cases contain raw input_base64 and are labelled as such.',
      delivery: 'Separate CLI module; accepted capture/saved-case UI is not integrated in this package.',
    },
  };
}

/**
 * Structured path segment for difference traversal.
 * kind 'root'|'key' carry a complete literal name; kind 'index' is only produced
 * by actual array traversal (never by parsing brackets out of a key string).
 * @typedef {{ kind: 'root'|'key', name: string } | { kind: 'index', index: number }} PathSegment
 */

/** Render raw (detailed / opt-in) path from structured segments. */
export function renderRawFieldPath(segments) {
  if (!Array.isArray(segments) || segments.length === 0) return '';
  let out = '';
  for (const seg of segments) {
    if (seg.kind === 'root') out = String(seg.name);
    else if (seg.kind === 'key') out += '.' + String(seg.name);
    else if (seg.kind === 'index') out += '[' + Number(seg.index) + ']';
  }
  return out;
}

/**
 * Render default-report path from structured segments.
 * Complete root/key names are pin-mapped or field_<sha12> of the *entire* key.
 * Readable [n] appears only for kind==='index' (real array traversal).
 */
export function renderSafeFieldPath(segments) {
  if (!Array.isArray(segments) || segments.length === 0) {
    return 'field_' + sha(String(segments)).slice(0, 12);
  }
  let out = '';
  for (const seg of segments) {
    if (seg.kind === 'root' || seg.kind === 'key') {
      const name = String(seg.name);
      const label = PINNED_FIELD_NAMES.has(name) ? name : 'field_' + sha(name).slice(0, 12);
      out = out === '' ? label : out + '.' + label;
    } else if (seg.kind === 'index') {
      out += '[' + Number(seg.index) + ']';
    } else {
      out = out === '' ? ('field_' + sha(JSON.stringify(seg)).slice(0, 12))
        : out + '.' + 'field_' + sha(JSON.stringify(seg)).slice(0, 12);
    }
  }
  return out;
}

function asSegments(prefixOrSegments) {
  if (Array.isArray(prefixOrSegments)) return prefixOrSegments;
  // Legacy string prefix (e.g. 'execution' / 'comparison') → single root segment.
  if (typeof prefixOrSegments === 'string' && prefixOrSegments.length > 0) {
    return [{ kind: 'root', name: prefixOrSegments }];
  }
  return [{ kind: 'root', name: 'execution' }];
}

function pushDiff(out, segments, expected, actual, expHas, actHas) {
  out.push({
    field: renderRawFieldPath(segments),
    field_segments: segments,
    expected_value_sha256: expHas ? sha(canonical(expected)) : null,
    actual_value_sha256: actHas ? sha(canonical(actual)) : null,
  });
}

/** Recurse into objects/arrays for leaf field diffs (e.g. decoded.label). */
export function differences(expected, actual, prefixOrSegments = 'execution') {
  const path = asSegments(prefixOrSegments);
  const out = [];
  if (isDeepStrictEqual(expected, actual)) return out;
  const bothObjects = expected !== null && actual !== null &&
    typeof expected === 'object' && typeof actual === 'object' &&
    !Array.isArray(expected) && !Array.isArray(actual) &&
    !(expected instanceof Map) && !(actual instanceof Map);
  if (bothObjects) {
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    for (const key of [...keys].sort()) {
      if (isDeepStrictEqual(expected[key], actual[key])) continue;
      const expHas = Object.prototype.hasOwnProperty.call(expected, key);
      const actHas = Object.prototype.hasOwnProperty.call(actual, key);
      const childPath = [...path, { kind: 'key', name: String(key) }];
      if (!expHas || !actHas) {
        pushDiff(out, childPath, expected[key], actual[key], expHas, actHas);
        continue;
      }
      const child = differences(expected[key], actual[key], childPath);
      if (child.length) out.push(...child);
      else if (sha(canonical(expected[key])) !== sha(canonical(actual[key]))) {
        pushDiff(out, childPath, expected[key], actual[key], true, true);
      }
    }
    return out;
  }
  if (Array.isArray(expected) && Array.isArray(actual)) {
    const n = Math.max(expected.length, actual.length);
    for (let i = 0; i < n; i++) {
      if (isDeepStrictEqual(expected[i], actual[i])) continue;
      const childPath = [...path, { kind: 'index', index: i }];
      out.push(...differences(expected[i], actual[i], childPath));
    }
    if (out.length) return out;
  }
  pushDiff(out, path, expected, actual, expected !== undefined, actual !== undefined);
  return out;
}

/**
 * Safe summary for default reports: statuses, identities, named fields, value digests.
 * No reconstructible wire/message/signature bytes.
 */
/**
 * C3 pin-map policy: human-readable reason_code / field labels ONLY when the
 * string exactly matches PINNED_* sets. Unknowns → digest only. Not another
 * regex/length heuristic; AA== and identifier-shaped payload keys are digested.
 */
function summarizeReason(reason) {
  if (typeof reason !== 'string') {
    return { reason_sha256: null, reason_omitted: true };
  }
  const digest = sha(reason);
  if (PINNED_REASON_CODES.has(reason)) {
    return { reason_code: reason, reason_sha256: digest };
  }
  return {
    reason_sha256: digest,
    reason_omitted: true,
    reason_omit_note:
      'unpinned reason text omitted from default report; digest only (pin-map ' + PIN_MAP_ID + ')',
  };
}

/** Digest a single path segment unless it is an exact pinned field name. */
export function summarizeFieldName(name) {
  if (typeof name === 'string' && PINNED_FIELD_NAMES.has(name)) return name;
  return 'field_' + sha(String(name)).slice(0, 12);
}

/**
 * Fallback for already-flattened path strings (tests / legacy callers).
 * Treats each '.'-split piece as a *complete* literal key — never peels [n]
 * out as an array index (that provenance exists only on structured segments).
 * Prefer renderSafeFieldPath(field_segments) on the default report path.
 */
export function summarizeFieldPath(fieldPath) {
  if (typeof fieldPath !== 'string' || fieldPath.length === 0) {
    return 'field_' + sha(String(fieldPath)).slice(0, 12);
  }
  return fieldPath.split('.').map((segment) => {
    if (PINNED_FIELD_NAMES.has(segment)) return segment;
    return 'field_' + sha(segment).slice(0, 12);
  }).join('.');
}

/**
 * Default-report difference sanitizer.
 * Prefer structured field_segments from differences(); never recover array-index
 * provenance by parsing brackets from a flattened untrusted string.
 * Drops field_segments from the emitted object so raw key text cannot leak.
 */
export function summarizeDifferences(diffs) {
  if (!Array.isArray(diffs)) return [];
  return diffs.map((d) => {
    const field = Array.isArray(d.field_segments)
      ? renderSafeFieldPath(d.field_segments)
      : summarizeFieldPath(d.field);
    return {
      field,
      expected_value_sha256: d.expected_value_sha256,
      actual_value_sha256: d.actual_value_sha256,
    };
  });
}

/**
 * Safe summary for default reports: statuses, identities, pinned field names, value digests.
 * No reconstructible wire/message/signature bytes. Unpinned reasons/keys are digested.
 */
export function summarizeParsed(parsed) {
  if (parsed == null) return null;
  const summary = {
    decision: parsed.decision,
    version: parsed.version,
    ...summarizeReason(parsed.reason),
    decoded: null,
  };
  if (parsed.decision === 'ACCEPT' && parsed.decoded && typeof parsed.decoded === 'object') {
    const rawNames = Object.keys(parsed.decoded).sort();
    const safeDigests = {};
    const safeNames = [];
    for (const k of rawNames) {
      const dig = sha(canonical(parsed.decoded[k]));
      const nk = summarizeFieldName(k);
      safeNames.push(nk);
      // If two raw keys collapse to the same digest label, keep first digest key stable;
      // colliding unpinned names still cannot reconstruct original key text.
      if (!Object.prototype.hasOwnProperty.call(safeDigests, nk)) safeDigests[nk] = dig;
      else safeDigests[nk + '_' + sha(String(k)).slice(0, 8)] = dig;
    }
    summary.decoded = {
      field_names: safeNames,
      field_digests: safeDigests,
      decoded_sha256: sha(canonical(parsed.decoded)),
      field_name_policy: PIN_MAP_ID,
    };
  }
  return summary;
}

export function runCase(value, { expectedCaseSha256, detailed = false } = {}) {
  const result = {
    name: validName(value?.name) ? value.name : 'invalid-case',
    status: 'INVALID_CASE',
    exit_code: 2,
    case_content_sha256: null,
    reference: expectedCaseSha256 === undefined ? 'NOT_PROVIDED' : 'NOT_CHECKED',
    execution: 'NOT_RUN',
    expected_result: null,
    actual_result: null,
    differences: [],
    error: null,
  };
  try {
    validateCase(value);
    result.case_content_sha256 = caseDigest(value);
    if (expectedCaseSha256 !== undefined) {
      if (!hex(expectedCaseSha256)) invalid('Malformed expected case digest');
      result.reference = expectedCaseSha256 === result.case_content_sha256 ? 'MATCH' : 'MISMATCH';
      if (result.reference !== 'MATCH') invalid('Case differs from the supplied reference');
    }
    // Binding check against currently installed adapter/deps BEFORE run
    let identity;
    try { identity = resolveExecutionIdentity(value.adapter_id); }
    catch (e) {
      if (e.code === 'UNKNOWN_ADAPTER') invalid('Unknown adapter id');
      runErr(e.message);
    }
    if (identity.adapter_source_sha256 !== value.bindings.adapter_source_sha256) {
      runErr('Adapter source bytes differ from case binding');
    }
    if (identity.dependency_binding_sha256 !== value.bindings.dependency_binding_sha256) {
      runErr('Dependency installed-file inventory differs from case binding');
    }
    if (identity.runtime !== value.bindings.runtime) runErr('Runtime mismatch');

    let actual;
    try {
      actual = executeAdapter(value.adapter_id, value.input_base64, { comparisonPolicy: value.comparison_policy }).execution;
    } catch (e) {
      runErr('Could not execute adapter: ' + (e.message || 'unknown'));
    }
    result.execution = actual.complete ? 'COMPLETE' : 'INCOMPLETE';
    if (!actual.complete) {
      // Safe summary only even on incomplete
      result.expected_result = summarizeParsed(value.expected_execution.parsed);
      result.actual_result = null;
      runErr('Adapter did not complete with valid protocol; this is not a regression or parser-refusal MATCH (' + (actual.protocol_reason || actual.error_code || actual.signal || 'incomplete') + ')');
    }
    const expectedSlim = {
      complete: value.expected_execution.complete,
      exit_code: value.expected_execution.exit_code,
      signal: value.expected_execution.signal,
      error_code: value.expected_execution.error_code,
      stdin_sha256: value.expected_execution.stdin_sha256,
      protocol_ok: value.expected_execution.protocol_ok,
      parsed: value.expected_execution.parsed,
    };
    const actualSlim = {
      complete: actual.complete,
      exit_code: actual.exit_code,
      signal: actual.signal,
      error_code: actual.error_code,
      stdin_sha256: actual.stdin_sha256,
      protocol_ok: actual.protocol_ok,
      parsed: actual.parsed,
    };
    const rawDiffs = differences(expectedSlim, actualSlim);
    result.status = rawDiffs.length ? 'REGRESSION' : 'MATCH';
    result.exit_code = STATUS[result.status];
    if (detailed) {
      // Detailed opt-in: raw field strings (may include literal object keys); labelled.
      result.differences = rawDiffs.map((d) => ({
        field: d.field,
        expected_value_sha256: d.expected_value_sha256,
        actual_value_sha256: d.actual_value_sha256,
      }));
      result.expected_result = value.expected_execution.parsed;
      result.actual_result = actual.parsed;
      result.detailed_export = true;
      result.detailed_export_label = 'FULL_PARSED_PAYLOAD_OPT_IN — may contain reconstructible wire/message/signature bytes; not the default report';
    } else {
      result.differences = summarizeDifferences(rawDiffs);
      result.expected_result = summarizeParsed(value.expected_execution.parsed);
      result.actual_result = summarizeParsed(actual.parsed);
    }
  } catch (error) {
    result.status = error instanceof CaseError ? error.kind : 'RUN_ERROR';
    result.exit_code = STATUS[result.status] ?? 3;
    result.error = error instanceof CaseError ? error.message : 'Unexpected runner failure';
  }
  return result;
}

export function runCases(cases, { expectedCaseSha256s, detailed = false } = {}) {
  if (!Array.isArray(cases) || cases.length < 1 || cases.length > MAX_CASES) invalid('Supply between 1 and ' + MAX_CASES + ' cases');
  if (expectedCaseSha256s !== undefined && (!Array.isArray(expectedCaseSha256s) || expectedCaseSha256s.length !== cases.length)) {
    invalid('Reference count must match case count');
  }
  const names = cases.map((c) => c?.name);
  if (new Set(names).size !== names.length) invalid('Case names must be unique in a batch');
  const results = cases.map((c, i) => runCase(c, { expectedCaseSha256: expectedCaseSha256s?.[i], detailed }));
  const counts = Object.fromEntries(Object.keys(STATUS).map((s) => [s, results.filter((r) => r.status === s).length]));
  return {
    schema: detailed ? 'raven-replay-adapter-case-report/1-detailed' : 'raven-replay-adapter-case-report/1',
    exit_code: Math.max(...results.map((r) => r.exit_code)),
    counts,
    results,
    limits: {
      meaning: 'Batch comparison of saved expected adapter executions.',
      precedence: 'exit_code is max of per-case exits (MATCH=0 < REGRESSION=1 < INVALID_CASE=2 < RUN_ERROR=3).',
      report_omits_raw_input: true,
      report_omits_reconstructible_wire: !detailed,
      detailed_export: detailed
        ? 'OPT-IN detailed export; may contain reconstructible decoded wire/message/signature bytes'
        : false,
      delivery: 'Separate CLI module; accepted UI not integrated here.',
    },
  };
}

/**
 * Version comparison against an explicit saved baseline case + independently retained digest.
 * Verifies baseline case digest and installed baseline binding BEFORE candidate execution.
 * Refuses baseline replacement/drift.
 */
export function compareVersionsAgainstBaseline({
  baselineCase,
  baselineCaseSha256,
  candidateAdapterId,
  label,
  detailed = false,
}) {
  if (!hex(baselineCaseSha256)) invalid('Malformed baseline case digest');
  if (!validAdapterId(candidateAdapterId)) invalid('Invalid candidate adapter id');
  validateCase(baselineCase);
  const dig = caseDigest(baselineCase);
  if (dig !== baselineCaseSha256) invalid('Baseline case differs from retained reference digest');

  const baselineAdapterId = baselineCase.adapter_id;
  if (baselineAdapterId === candidateAdapterId) invalid('Baseline and candidate must differ');

  let baseId;
  let candId;
  try {
    baseId = resolveExecutionIdentity(baselineAdapterId);
    candId = resolveExecutionIdentity(candidateAdapterId);
  } catch (e) {
    if (e.code === 'UNKNOWN_ADAPTER') invalid(e.message);
    runErr(e.message);
  }
  if (baseId.output_contract !== candId.output_contract) {
    invalid('Adapters must declare the same output_contract for version comparison');
  }
  // Refuse baseline drift vs saved case bindings BEFORE candidate execution
  if (baseId.adapter_source_sha256 !== baselineCase.bindings.adapter_source_sha256) {
    runErr('Baseline adapter source bytes differ from saved baseline case binding — refusing comparison');
  }
  if (baseId.dependency_binding_sha256 !== baselineCase.bindings.dependency_binding_sha256) {
    runErr('Baseline dependency inventory differs from saved baseline case binding — refusing comparison');
  }

  const candRun = executeAdapter(candidateAdapterId, baselineCase.input_base64);
  const completed = !!candRun.execution.complete;
  if (!completed) {
    return {
      schema: 'raven-replay-version-comparison/3',
      status: 'INCOMPLETE',
      label: typeof label === 'string' ? label : 'unlabelled',
      output_contract: baseId.output_contract,
      baseline: {
        adapter_id: baselineAdapterId,
        case_content_sha256: dig,
        retained_reference: 'MATCH',
        identity: baseId,
        result: summarizeParsed(baselineCase.expected_execution.parsed),
        result_digest: sha(canonical(baselineCase.expected_execution.parsed)),
        ...(detailed
          ? {
              result_full_from_saved_baseline: baselineCase.expected_execution.parsed,
              detailed_export: true,
              detailed_export_label:
                'FULL_BASELINE_PARSED_OPT_IN — may contain reconstructible wire/message/signature bytes; not the default comparison report',
            }
          : {
              result_full_from_saved_baseline: null,
              detailed_export: false,
              note_default:
                'Default comparison omits full baseline parsed payload; pass detailed:true / --detailed for labelled opt-in export. Saved baseline case file remains intact.',
            }),
        note: 'Saved baseline case retained; candidate did not complete. Full baseline parsed omitted from default report.',
      },
      candidate: {
        adapter_id: candidateAdapterId,
        identity: candId,
        result: null,
        protocol_reason: candRun.execution.protocol_reason || candRun.execution.error_code || 'incomplete',
      },
      differences: [],
      changed: null,
      comparison_complete: false,
      comparison_policy_sha256: DEFAULT_COMPARISON_POLICY_SHA,
    };
  }

  const baselineParsed = baselineCase.expected_execution.parsed;
  const candidateParsed = candRun.execution.parsed;
  const rawDiffs = differences(
    { parsed: baselineParsed },
    { parsed: candidateParsed },
    'comparison',
  );
  const diffs = detailed
    ? rawDiffs.map((d) => ({
        field: d.field,
        expected_value_sha256: d.expected_value_sha256,
        actual_value_sha256: d.actual_value_sha256,
      }))
    : summarizeDifferences(rawDiffs);
  return {
    schema: 'raven-replay-version-comparison/3',
    status: 'COMPLETE',
    label: typeof label === 'string' ? label : 'unlabelled',
    output_contract: baseId.output_contract,
    baseline: {
      adapter_id: baselineAdapterId,
      case_content_sha256: dig,
      retained_reference: 'MATCH',
      identity: baseId,
      result: summarizeParsed(baselineParsed),
      result_digest: sha(canonical(baselineParsed)),
      ...(detailed
        ? {
            result_full_from_saved_baseline: baselineParsed,
            detailed_export: true,
            detailed_export_label:
              'FULL_BASELINE_PARSED_OPT_IN — may contain reconstructible wire/message/signature bytes; not the default comparison report',
          }
        : {
            result_full_from_saved_baseline: null,
            detailed_export: false,
            note_default:
              'Default comparison omits full baseline parsed payload; pass detailed:true / --detailed for labelled opt-in export. Saved baseline case file remains intact.',
          }),
      note: 'Saved baseline case + retained digest verified before candidate execution; candidate is not the original tool. Full baseline parsed omitted from default report.',
    },
    candidate: {
      adapter_id: candidateAdapterId,
      identity: candId,
      result: summarizeParsed(candidateParsed),
      // Full candidate payload available only via explicit detailed path if needed later;
      // leaf diffs carry digests. Keep identity of comparison complete.
      result_digest: sha(canonical(candidateParsed)),
    },
    differences: diffs,
    changed: diffs.length > 0,
    comparison_complete: true,
    comparison_policy_sha256: DEFAULT_COMPARISON_POLICY_SHA,
  };
}

/**
 * Clearly labelled fresh two-tool experiment (NOT retained-baseline comparison).
 * Does not claim to preserve a prior saved baseline.
 */
export function compareVersionsFreshExperiment({ baselineAdapterId, candidateAdapterId, inputBase64, label }) {
  if (!validAdapterId(baselineAdapterId) || !validAdapterId(candidateAdapterId)) invalid('Invalid adapter id');
  if (baselineAdapterId === candidateAdapterId) invalid('Baseline and candidate must differ');
  const baseId = resolveExecutionIdentity(baselineAdapterId);
  const candId = resolveExecutionIdentity(candidateAdapterId);
  if (baseId.output_contract !== candId.output_contract) {
    invalid('Adapters must declare the same output_contract for version comparison');
  }
  const baseRun = executeAdapter(baselineAdapterId, inputBase64);
  const candRun = executeAdapter(candidateAdapterId, inputBase64);
  if (!baseRun.execution.complete) runErr('Fresh-experiment baseline adapter incomplete: ' + (baseRun.execution.protocol_reason || 'incomplete'));
  if (!candRun.execution.complete) runErr('Fresh-experiment candidate adapter incomplete: ' + (candRun.execution.protocol_reason || 'incomplete'));
  const diffs = summarizeDifferences(differences(
    { parsed: baseRun.execution.parsed },
    { parsed: candRun.execution.parsed },
    'comparison',
  ));
  return {
    schema: 'raven-replay-version-comparison-fresh-experiment/1',
    status: 'COMPLETE',
    label: typeof label === 'string' ? label : 'unlabelled',
    warning: 'FRESH_EXPERIMENT — both tools measured now; this is NOT a saved-baseline retained comparison. Prefer compare-versions with --baseline-case + --expect-sha256 for baseline retention.',
    output_contract: baseId.output_contract,
    baseline: {
      adapter_id: baselineAdapterId,
      identity: baseId,
      result: summarizeParsed(baseRun.execution.parsed),
      note: 'Fresh measurement only; no saved baseline case was verified.',
    },
    candidate: {
      adapter_id: candidateAdapterId,
      identity: candId,
      result: summarizeParsed(candRun.execution.parsed),
    },
    differences: diffs,
    changed: diffs.length > 0,
    comparison_complete: true,
    comparison_policy_sha256: DEFAULT_COMPARISON_POLICY_SHA,
  };
}

/** @deprecated name kept as alias documentation — use compareVersionsAgainstBaseline */
export function compareVersions(opts) {
  if (opts && opts.baselineCase && opts.baselineCaseSha256) {
    return compareVersionsAgainstBaseline(opts);
  }
  invalid('compareVersions requires saved baselineCase + baselineCaseSha256; use compareVersionsFreshExperiment for an explicit fresh two-tool experiment');
}
