/**
 * C3 default-report pin map (trusted labels only).
 *
 * Default serializers may emit human-readable reason_code / field path segments
 * ONLY when the string exactly matches an entry in these frozen sets.
 * Everything else is digest-only (reason_sha256 / field_<sha12>).
 *
 * This is NOT covert-channel or sandbox protection — it stops the stated safe
 * default serializer from forwarding arbitrary adapter-provided payload strings.
 *
 * Parameterized Kit reasons such as sdk_decode_refused:code=… are intentionally
 * NOT pinned (exact-match policy); they appear as reason_sha256 only.
 */

/** Exact reason strings allowed as reason_code in default reports. */
export const PINNED_REASON_CODES = Object.freeze(new Set([
  // Kit adapter (solana-kit-tx-decode)
  'empty_input',
  'invalid_input_base64',
  'ok:legacy_wire_decode',
  'ok:v0_wire_decode',
  // Example parsers (synthetic extension demos)
  'truncated:example_min_length',
  'ok:example-parser-v1',
  'ok:example-parser-v2',
  'ok:sentinel-echo-control',
]));

/**
 * Exact path-segment / decoded field-name labels allowed in default reports.
 * Includes Kit projected summary tree names, example-parser leaves, and
 * structural prefixes used by difference() paths.
 */
export const PINNED_FIELD_NAMES = Object.freeze(new Set([
  // Difference / summary structural prefixes
  'execution', 'comparison', 'parsed', 'decoded', 'decision', 'version', 'reason',
  'complete', 'exit_code', 'signal', 'error_code', 'stdin_sha256', 'protocol_ok',
  'stdout_base64', 'stderr_base64',
  // Kit adapter decoded roots + nested projected names
  'wire', 'message', 'sdk',
  'messageBytes', 'signatures',
  '$type', 'encoding', 'data',
  'header', 'numSignerAccounts', 'numReadonlySignerAccounts', 'numReadonlyNonSignerAccounts',
  'staticAccounts', 'lifetimeToken', 'instructions',
  'programAddressIndex', 'accountIndices',
  'addressTableLookups', 'lookupTableAddress', 'writableIndexes', 'readonlyIndexes',
  'package', 'api', 'scope', 'helper', 'not_included',
  // Example / control adapter leaves (trusted schema labels, not payload)
  'example_parser', 'byte_length', 'first_byte', 'label', 'echo', 'answer',
]));

export const PIN_MAP_ID = 'raven-replay-default-report-pin-map/1';
