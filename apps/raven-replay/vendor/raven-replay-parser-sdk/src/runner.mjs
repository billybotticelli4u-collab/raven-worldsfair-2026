import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAdapter, packageRoot } from './registry.mjs';
import { dependencyBinding, sha } from './binding.mjs';
import { normalizeValue, omitPaths, canonical } from './normalize.mjs';

export const NODE_VERSION = 'v22.18.0';
export const MAX_INPUT_BYTES = 16384;
const WATCHDOG = fileURLToPath(new URL('./watchdog-exec.mjs', import.meta.url));
/** Outer spawnSync grace beyond hard deadline (watchdog should finish first). */
const OUTER_GRACE_MS = 2500;

export const POLICY = Object.freeze({
  id: 'raven-replay-adapter-offline/1',
  timeout_ms: 5000,
  max_output_bytes: 65536,
  max_input_bytes: MAX_INPUT_BYTES,
  network_calls: 'none_required_by_initial_adapters',
  containment: 'bounded_subprocess_minimal_env; hard_deadline_process_group_sigkill; not_a_security_sandbox',
  claim: 'Offline adapter decode/parse only; no signature verification, tx safety, RPC, confirmation or chain execution.',
  hard_deadline: {
    mechanism: 'watchdog-exec.mjs detached process-group + SIGKILL at timeout_ms; outer spawnSync SIGKILL at timeout_ms+grace',
    platforms_measured: ['darwin'],
    platforms_unmeasured: ['linux', 'win32'],
    child_cleanup: 'process.kill(-child.pid, SIGKILL) for the adapter process group on EVERY terminal path (success, overflow, timeout, error); no host-wide process killing',
    output_overflow: 'stdout or stderr above max_output_bytes → watchdog exit 125 → RUN_ERROR even if a valid JSON prefix was emitted',
  },
});
export const POLICY_SHA = sha(canonical(POLICY));

export const DEFAULT_COMPARISON_POLICY = Object.freeze({
  id: 'raven-replay-comparison/1',
  normalize: 'normalize.mjs/1',
  exclude_fields: [], // named exclusions only; never silent
  compare: 'deep_strict_equal_on_normalized_parsed',
});
export const DEFAULT_COMPARISON_POLICY_SHA = sha(canonical(DEFAULT_COMPARISON_POLICY));

function b64Input(text) {
  if (typeof text !== 'string') throw new Error('input must be base64 string');
  const bytes = Buffer.from(text, 'base64');
  if (bytes.length > MAX_INPUT_BYTES || bytes.toString('base64') !== text) throw new Error('Invalid or oversized input base64');
  return bytes;
}

/**
 * Map only documented decoder/input errors to parser refusal (REJECT).
 * Infrastructure failures stay incomplete / RUN_ERROR — never masquerade as REJECT.
 */
function classifyAdapterStdout(stdout, exitCode, signal, errorCode) {
  let parsed = null;
  let protocol_ok = false;
  try {
    parsed = JSON.parse(stdout.toString('utf8'));
  } catch {
    return { complete: false, parsed: null, protocol_ok: false, reason: 'invalid_json_stdout' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { complete: false, parsed: null, protocol_ok: false, reason: 'stdout_not_object' };
  }
  const decision = parsed.decision;
  if (decision !== 'ACCEPT' && decision !== 'REJECT') {
    return { complete: false, parsed: null, protocol_ok: false, reason: 'invalid_decision' };
  }
  if (typeof parsed.reason !== 'string') {
    return { complete: false, parsed: null, protocol_ok: false, reason: 'missing_reason' };
  }
  const ver = parsed.version;
  if (!(ver === 'legacy' || ver === 0 || ver === null)) {
    return { complete: false, parsed: null, protocol_ok: false, reason: 'invalid_version' };
  }
  if (decision === 'ACCEPT') {
    if (parsed.decoded == null || typeof parsed.decoded !== 'object') {
      return { complete: false, parsed: null, protocol_ok: false, reason: 'accept_missing_decoded' };
    }
  } else if (parsed.decoded != null) {
    return { complete: false, parsed: null, protocol_ok: false, reason: 'reject_must_not_include_decoded' };
  }
  if (errorCode || signal !== null || exitCode !== 0) {
    return { complete: false, parsed: null, protocol_ok: false, reason: 'non_zero_or_signaled' };
  }
  protocol_ok = true;
  let normalized = {
    decision: parsed.decision,
    version: parsed.version,
    reason: parsed.reason,
    decoded: parsed.decision === 'ACCEPT' ? normalizeValue(parsed.decoded) : null,
  };
  return { complete: true, parsed: normalized, protocol_ok, reason: null };
}

function localHelperRoots(adapter) {
  // Conservative allowed tree: the entire adapters/ directory is inventoried into the
  // execution binding. Immediate entrypoint-directory inventory alone is NOT the full
  // local closure — shared helpers under adapters/<other>/ must also change the binding.
  // Entrypoints outside adapters/ are refused by registry.mjs before we get here.
  // This is inventory binding, not a second engine or sandbox.
  const adaptersRoot = path.join(packageRoot(), 'adapters');
  const entryAbs = path.resolve(adapter.entrypoint_abs);
  const rootResolved = path.resolve(adaptersRoot);
  if (!(entryAbs === rootResolved || entryAbs.startsWith(rootResolved + path.sep))) {
    const err = new Error('Unsupported closure layout: entrypoint escapes adapters/ allowed tree');
    err.code = 'BINDING_REFUSED';
    throw err;
  }
  return [{ label: 'local:adapters', abs: adaptersRoot }];
}

export function resolveExecutionIdentity(adapterId) {
  if (process.version !== NODE_VERSION) {
    const err = new Error('Runtime mismatch: use Node ' + NODE_VERSION + ' (got ' + process.version + ')');
    err.code = 'RUNTIME_MISMATCH';
    throw err;
  }
  const adapter = getAdapter(adapterId);
  if (!adapter) {
    const err = new Error('Unknown adapter id: ' + adapterId);
    err.code = 'UNKNOWN_ADAPTER';
    throw err;
  }
  const depNames = adapter.dependency_packages || [];
  const localRoots = localHelperRoots(adapter);
  let deps;
  try {
    deps = dependencyBinding(packageRoot(), depNames, { localRoots });
  } catch (e) {
    const err = new Error('Dependency/local helper inventory refused: ' + (e.message || e));
    err.code = 'BINDING_REFUSED';
    throw err;
  }
  return {
    adapter_id: adapter.id,
    adapter_label: adapter.label,
    output_contract: adapter.output_contract,
    entrypoint: adapter.entrypoint,
    adapter_source_sha256: adapter.source_sha256,
    dependency_binding_sha256: deps.binding_sha256,
    dependency_packages: deps.packages,
    closure_packages: deps.closure_packages,
    runtime: NODE_VERSION,
    policy_sha256: POLICY_SHA,
    tool: 'raven-replay-parser-sdk/0.1.0-milestone1',
  };
}

/**
 * Execute registered adapter under hard deadline.
 * Refuse changed bindings is done by callers (runCase) BEFORE calling this when replaying.
 */
export function executeAdapter(adapterId, inputBase64, { comparisonPolicy = DEFAULT_COMPARISON_POLICY } = {}) {
  b64Input(inputBase64);
  const identity = resolveExecutionIdentity(adapterId);
  const adapter = getAdapter(adapterId);
  const stdin = JSON.stringify({ schema: 'raven-replay-adapter-stdin/1', input_base64: inputBase64 }) + '\n';
  const hardMs = POLICY.timeout_ms;
  const result = spawnSync(process.execPath, ['--no-warnings', WATCHDOG, String(hardMs), adapter.entrypoint_abs], {
    input: stdin,
    env: {
      PATH: '',
      HOME: '',
      NODE_PATH: '',
      RAVEN_WATCHDOG_MAX_OUT: String(POLICY.max_output_bytes),
    },
    encoding: null,
    // Outer backup: SIGKILL if watchdog itself fails to return promptly.
    timeout: hardMs + OUTER_GRACE_MS,
    killSignal: 'SIGKILL',
    maxBuffer: POLICY.max_output_bytes + 4096,
    cwd: packageRoot(),
  });
  const stdout = result.stdout || Buffer.alloc(0);
  const stderr = result.stderr || Buffer.alloc(0);
  let status = result.status;
  let signal = result.signal;
  let errorCode = result.error?.code || null;
  // Watchdog uses exit 124 for hard-deadline kill of non-cooperating child.
  if (status === 124) {
    errorCode = errorCode || 'HARD_DEADLINE';
    signal = signal || 'SIGKILL';
    status = null;
  }
  // Watchdog uses exit 125 for stdout/stderr overflow (even with valid JSON prefix).
  if (status === 125) {
    errorCode = errorCode || 'OUTPUT_OVERFLOW';
    status = null;
  }
  if (result.error?.code === 'ETIMEDOUT') {
    errorCode = 'HARD_DEADLINE_OUTER';
    signal = 'SIGKILL';
    status = null;
  }
  const classified = classifyAdapterStdout(stdout, status, signal, errorCode);
  let parsed = classified.parsed;
  if (parsed && comparisonPolicy.exclude_fields?.length) {
    parsed = {
      ...parsed,
      decoded: parsed.decoded ? omitPaths(parsed.decoded, comparisonPolicy.exclude_fields) : null,
    };
  }
  return {
    identity,
    comparison_policy_sha256: sha(canonical(comparisonPolicy)),
    execution: {
      complete: classified.complete,
      exit_code: status,
      signal,
      error_code: errorCode,
      stdin_sha256: sha(stdin),
      stdout_base64: stdout.toString('base64'),
      stderr_base64: stderr.toString('base64'),
      protocol_ok: classified.protocol_ok,
      protocol_reason: classified.reason,
      parsed,
    },
  };
}
