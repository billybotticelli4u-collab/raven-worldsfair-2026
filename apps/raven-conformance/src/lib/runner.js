/**
 * Challenge 1 bounded isolation runner.
 * - Real sandbox-exec on Darwin when available; curated_demo otherwise (honest disclosure)
 * - Expanded result taxonomy (no silent PASS for crash/timeout/flood/invalid)
 * - Deterministic report body digest vs volatile metadata
 * - Per-run ephemeral workdirs; process-group kill; output byte caps
 *
 * A local Node child_process alone is NOT a security sandbox.
 */
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { APP_ROOT, CORPUS_DIR, PROFILES_DIR, TARGETS_DIR, REPORTS_DIR } from "./paths.js";
import { sha256Hex, fileSha256 } from "./digest.js";
import {
  DEFAULT_TIMEOUT_MS,
  createRunWorkdir,
  cleanupWorkdir,
  resolveIsolation,
  spawnIsolated,
  softLimitsDisclosure,
  restrictedEnv,
} from "./isolation.js";

const PROFILE_FILE = "raven-canonical-envelope-1.json";
const CORPUS_FILE = "raven-canonical-envelope-demo-corpus-1.json";
const BRANCH_NAME = "billy/fair-challenge1-bounded-runner-2026-09-16";
const PROBE_TIMEOUT_MS = 800;
const PROBE_FLOOD_MAX_STDOUT = 32 * 1024;
const PROBE_FLOOD_MAX_STDERR = 8 * 1024;

export { restrictedEnv, DEFAULT_TIMEOUT_MS };

export function loadProfile() {
  const p = path.join(PROFILES_DIR, PROFILE_FILE);
  return { path: p, digest: fileSha256(p), data: JSON.parse(readFileSync(p, "utf8")) };
}

export function loadCorpus() {
  const p = path.join(CORPUS_DIR, CORPUS_FILE);
  const raw = readFileSync(p, "utf8");
  const data = JSON.parse(raw);
  const forDigest = {
    id: data.id,
    version: data.version,
    profile: data.profile,
    description: data.description,
    vectors: data.vectors,
  };
  const computed = sha256Hex(JSON.stringify(forDigest, null, 2) + "\n");
  return { path: p, digest: computed, declaredDigest: data.content_digest_sha256 || null, data };
}

export function loadTargets() {
  const m = JSON.parse(readFileSync(path.join(TARGETS_DIR, "manifests.json"), "utf8"));
  return m.targets;
}

export function loadDemoTargets() {
  return loadTargets().filter((t) => !t.probe);
}

export function loadProbeTargets() {
  return loadTargets().filter((t) => t.probe === true);
}

export function getTarget(targetId) {
  const t = loadTargets().find((x) => x.id === targetId);
  if (!t) throw new Error(`unknown_target:${targetId}`);
  return t;
}

/**
 * Classify a single vector execution into the Challenge 1 taxonomy.
 * Never maps crash/timeout/flood/invalid to PASS.
 */
export function classifyResult(exec, expectedDecision, { probe = false, probeExpectation = null } = {}) {
  if (exec.spawn_error && !exec.observed) {
    return { status: "RUNNER_FAILURE", evidence_note: exec.spawn_error };
  }
  if (exec.flooded) {
    return { status: "OUTPUT_FLOOD", evidence_note: "stdout/stderr exceeded byte cap" };
  }
  if (exec.timedOut) {
    return { status: "TIMEOUT", evidence_note: "wall-clock timeout; process group killed" };
  }
  if (exec.parseError === "spawn_error" || exec.parseError === "stdin_error") {
    return { status: "RUNNER_FAILURE", evidence_note: exec.parseError };
  }
  // Crash: non-zero exit / signal without a valid observed decision takes priority
  // over mere unparseable stdout (hostile crash probes must not be PASS or soft-invalid-only).
  if (((exec.exitCode !== 0 && exec.exitCode !== null) || exec.signal) && !exec.observed) {
    return {
      status: "TARGET_CRASH",
      evidence_note: `exitCode=${exec.exitCode} signal=${exec.signal}`,
    };
  }
  if (exec.parseError === "unparseable_stdout" || exec.parseError === "missing_decision") {
    return { status: "INVALID_OUTPUT", evidence_note: exec.parseError };
  }

  if (probe && probeExpectation) {
    // Probe-specific classification left to runProbe; fall through for decision probes
  }

  const observedDecision = exec.observed?.decision ?? null;
  if (observedDecision === null) {
    return { status: "INVALID_OUTPUT", evidence_note: "missing_decision" };
  }
  if (observedDecision === expectedDecision) {
    return { status: "PASS", evidence_note: null };
  }
  return { status: "BEHAVIORAL_DIVERGENCE", evidence_note: null };
}

function emptyCounts() {
  return {
    PASS: 0,
    BEHAVIORAL_DIVERGENCE: 0,
    TARGET_CRASH: 0,
    TIMEOUT: 0,
    INVALID_OUTPUT: 0,
    OUTPUT_FLOOD: 0,
    SKIPPED_VECTOR: 0,
    RUNNER_FAILURE: 0,
    BOUNDARY_ESCAPE: 0,
    BOUNDARY_HOLD: 0,
    INCOMPLETE: 0,
  };
}

function tallyCounts(results) {
  const counts = emptyCounts();
  for (const r of results) {
    if (counts[r.status] !== undefined) counts[r.status] += 1;
    else counts.RUNNER_FAILURE += 1;
  }
  return counts;
}

/**
 * Build deterministic body for digest (exclude volatile fields).
 */
export function deterministicReportBody(report) {
  const results = (report.results || []).map((r) => ({
    vector_id: r.vector_id,
    description: r.description,
    expected: r.expected,
    observed: {
      decision: r.observed?.decision ?? null,
      reason: r.observed?.reason ?? null,
      parseError: r.observed?.parseError ?? null,
      timedOut: r.observed?.timedOut ?? false,
    },
    status: r.status,
    // evidence without durationMs
    evidence: {
      exitCode: r.evidence?.exitCode ?? null,
      flooded: r.evidence?.flooded ?? false,
      timedOut: r.evidence?.timedOut ?? false,
      stdout_sha256: r.evidence?.stdout ? sha256Hex(r.evidence.stdout) : null,
      stderr_sha256: r.evidence?.stderr ? sha256Hex(r.evidence.stderr) : null,
    },
  }));
  return {
    schema: report.schema,
    product: report.product,
    build_stage_note: report.build_stage_note,
    target: report.target,
    claimed_profile: report.claimed_profile,
    corpus: report.corpus,
    isolation: {
      mode: report.isolation?.mode,
      verified: report.isolation?.verified,
      platform: report.isolation?.platform,
      verified_controls: report.isolation?.verified_controls,
      assumed_controls: report.isolation?.assumed_controls,
    },
    binding: report.binding,
    summary: {
      test_count: report.summary.test_count,
      pass: report.summary.pass,
      divergence: report.summary.divergence,
      behavioral_divergence: report.summary.behavioral_divergence,
      counts: report.summary.counts,
      overall: report.summary.overall,
      incomplete: report.summary.incomplete || false,
    },
    results,
    divergence_definition: report.divergence_definition,
    limitations: report.limitations,
  };
}

export function computeDeterministicDigest(report) {
  const body = deterministicReportBody(report);
  return sha256Hex(JSON.stringify(body) + "\n");
}

function environmentIdentity(isolation) {
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    os: `${os.type()} ${os.release()}`,
    cwd_policy: "ephemeral_workdir_per_run",
    network_policy:
      isolation.mode === "sandbox_exec" && isolation.verified
        ? "deny_network_via_sandbox_exec"
        : "outbound_denied_by_proxy_unset_only_not_kernel_boundary",
    credentials_policy: "no_raven_credentials_in_target_env",
    timeout_ms_default: DEFAULT_TIMEOUT_MS,
    isolation_mode: isolation.mode,
    isolation_verified: isolation.verified,
    soft_limits: softLimitsDisclosure(),
    // Honest: child_process is not a sandbox by itself
    child_process_is_not_sandbox: true,
  };
}

/**
 * Run one vector against a target entry script under isolation.
 */
export async function runVector(entryAbs, inputObj, opts = {}) {
  const runId = opts.runId || `vec_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
  const workDir = opts.workDir || createRunWorkdir(runId);
  const ownWorkdir = !opts.workDir;
  const isolation = opts.isolation || resolveIsolation(workDir);
  try {
    return await spawnIsolated({
      entryAbs,
      inputObj,
      workDir,
      isolation,
      timeoutMs: opts.timeoutMs || DEFAULT_TIMEOUT_MS,
      maxStdout: opts.maxStdout,
      maxStderr: opts.maxStderr,
      envExtra: opts.envExtra || {},
      injectCanary: opts.injectCanary === true,
    });
  } finally {
    if (ownWorkdir && opts.cleanup !== false) cleanupWorkdir(workDir);
  }
}

/**
 * Execute full conformance run for a demo target id.
 */
export async function runConformance(targetId, opts = {}) {
  const profile = loadProfile();
  const corpus = loadCorpus();
  const target = getTarget(targetId);
  if (target.probe) {
    throw new Error(`target_is_probe_use_runProbe:${targetId}`);
  }
  const entryAbs = path.join(TARGETS_DIR, target.entry);
  if (!existsSync(entryAbs)) throw new Error(`missing_target_entry:${entryAbs}`);

  const targetDigest = fileSha256(entryAbs);
  const runId = opts.runId || `run_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const startedAt = new Date().toISOString();
  const workDir = createRunWorkdir(runId);
  const isolation = resolveIsolation(workDir);
  const results = [];
  let incomplete = false;
  let runnerFailure = null;

  try {
    for (const vector of corpus.data.vectors) {
      if (opts.signal?.aborted) {
        incomplete = true;
        results.push({
          vector_id: vector.id,
          description: vector.description,
          expected: { decision: vector.expected.decision },
          observed: { decision: null, reason: null },
          status: "INCOMPLETE",
          evidence: { stdout: "", stderr: "run_aborted", exitCode: null, durationMs: 0 },
        });
        break;
      }
      if (vector.skip === true) {
        results.push({
          vector_id: vector.id,
          description: vector.description,
          expected: { decision: vector.expected?.decision ?? null },
          observed: { decision: null, reason: "skipped" },
          status: "SKIPPED_VECTOR",
          evidence: { stdout: "", stderr: "", exitCode: null, durationMs: 0, skipped: true },
        });
        continue;
      }

      let exec;
      try {
        exec = await spawnIsolated({
          entryAbs,
          inputObj: vector.input,
          workDir,
          isolation,
          timeoutMs: opts.timeoutMs || DEFAULT_TIMEOUT_MS,
        });
      } catch (err) {
        incomplete = true;
        runnerFailure = String(err);
        results.push({
          vector_id: vector.id,
          description: vector.description,
          expected: { decision: vector.expected.decision },
          observed: { decision: null, reason: null, parseError: "runner_exception" },
          status: "RUNNER_FAILURE",
          evidence: { stdout: "", stderr: String(err), exitCode: null, durationMs: 0 },
        });
        break;
      }

      const { status, evidence_note } = classifyResult(exec, vector.expected.decision);
      const row = {
        vector_id: vector.id,
        description: vector.description,
        expected: { decision: vector.expected.decision },
        observed: exec.observed && !exec.parseError
          ? { decision: exec.observed.decision, reason: exec.observed.reason ?? null }
          : {
              decision: null,
              reason: null,
              parseError: exec.parseError,
              timedOut: exec.timedOut,
              flooded: exec.flooded,
            },
        status,
        evidence: {
          stdout: exec.stdout,
          stderr: exec.stderr,
          exitCode: exec.exitCode,
          durationMs: exec.durationMs,
          timedOut: exec.timedOut,
          flooded: exec.flooded,
          note: evidence_note,
        },
      };
      results.push(row);
      if (typeof opts.onProgress === "function") {
        opts.onProgress({
          type: "vector_finished",
          run_id: runId,
          index: results.length,
          total: corpus.data.vectors.length,
          vector_id: row.vector_id,
          status: row.status,
          result: row,
        });
      }
    }
  } finally {
    cleanupWorkdir(workDir);
  }

  const counts = tallyCounts(results);
  const passCount = counts.PASS;
  const divergenceCount = counts.BEHAVIORAL_DIVERGENCE;
  let overall;
  if (incomplete || runnerFailure) overall = "INCOMPLETE";
  else if (passCount === results.length) overall = "CONFORMANT";
  else overall = "DIVERGENT";

  const binding = {
    profile_sha256: profile.digest,
    corpus_sha256: corpus.digest,
    target_entry_sha256: targetDigest,
  };

  const reportWithoutDigest = {
    schema: "raven-conformance-report/1",
    run_id: runId,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    product: "raven-conformance",
    build_stage_note:
      "Build Stage product milestone. Does not claim Day-3 Evidence Contract Handshake as this product.",
    target: {
      id: target.id,
      name: target.name,
      version: target.version,
      entry: target.entry,
      entry_sha256: targetDigest,
      claimed_conformance_profile: target.claimed_conformance_profile,
      invocation_interface: target.invocation_interface,
      description: target.description,
    },
    claimed_profile: {
      name: profile.data.name,
      version: profile.data.version,
      file: path.basename(profile.path),
      sha256: profile.digest,
    },
    corpus: {
      id: corpus.data.id,
      version: corpus.data.version,
      file: path.basename(corpus.path),
      sha256: corpus.digest,
      declared_content_digest_sha256: corpus.declaredDigest,
      vector_count: corpus.data.vectors.length,
    },
    isolation: {
      mode: isolation.mode,
      verified: isolation.verified,
      platform: isolation.platform,
      details: isolation.details,
      verified_controls: isolation.verified_controls,
      assumed_controls: isolation.assumed_controls,
      probe_reason: isolation.probe_reason,
      disclosure:
        "Child process alone is not a security sandbox. Mode discloses exact enforcement.",
    },
    environment: environmentIdentity(isolation),
    allowed_resources: {
      filesystem:
        isolation.mode === "sandbox_exec"
          ? "target script read + ephemeral workdir write only (Seatbelt)"
          : "runner-intended: target script + stdin; writes not kernel-confined in curated_demo",
      network:
        isolation.mode === "sandbox_exec" && isolation.verified
          ? "denied_via_sandbox_exec"
          : "denied_by_default_proxy_unset_only",
      credentials: "none_injected",
      corpus_mutation: "forbidden_runner_owns_corpus",
      report_signer: "runner_owns_report_hash_target_cannot_mutate",
      env: "explicit_allowlist_only",
    },
    binding,
    volatile_fields: [
      "run_id",
      "started_at",
      "finished_at",
      "results[].evidence.durationMs",
      "environment.os_release_detail",
    ],
    summary: {
      test_count: results.length,
      pass: passCount,
      divergence: divergenceCount,
      behavioral_divergence: divergenceCount,
      counts,
      overall,
      incomplete,
    },
    results,
    divergence_definition:
      "BEHAVIORAL_DIVERGENCE = observed decision ≠ specified corpus expectation only. Not automatically exploitable, unsafe, or malicious. No generic security score. Crashes/timeouts/invalid/flood are separate statuses and never PASS.",
    limitations: [
      isolation.verified
        ? "Isolation mode sandbox_exec: Seatbelt profile applied; still not a general multi-tenant production sandbox."
        : "Isolation mode curated_demo: NOT a verified security sandbox. Timeout, env allowlist, output caps, and process-group kill are enforced by the runner; network/filesystem are not kernel-confined.",
      "A Node child_process alone is not a security sandbox.",
      "Outbound network in curated_demo is denied only by unsetting proxies — not a kernel network namespace.",
      "Memory/process soft limits are documented as unverified unless separately measured.",
      "Demo targets and corpus are Raven-owned Fair self-contained fixtures — not private production corpora.",
      "Does not include token, marketplace, cert authority, pentest scanner, accounts, registry, billing, or governance architecture.",
      "Author-lane Fair Build Stage product review surface only. No arbitrary public code upload.",
    ],
    reproduction: {
      clean_clone: [
        "git clone https://github.com/billybotticelli4u-collab/raven-worldsfair-2026.git",
        "cd raven-worldsfair-2026",
        `git checkout ${BRANCH_NAME}`,
        "cd apps/raven-conformance",
        "npm test",
        `npm run conform -- --target ${targetId}`,
      ].join("\n"),
      one_liner: `cd apps/raven-conformance && npm run conform -- --target ${targetId}`,
      replay: `cd apps/raven-conformance && npm run replay -- --report reports/<run_id>.json`,
      demo: "cd apps/raven-conformance && npm run demo",
    },
  };

  const deterministicDigest = computeDeterministicDigest(reportWithoutDigest);
  binding.deterministic_report_sha256 = deterministicDigest;

  // Full-body digest for continuity with MVP field name (includes volatile — documented)
  const body = JSON.stringify(reportWithoutDigest, null, 2) + "\n";
  const reportDigest = sha256Hex(body);
  const report = {
    ...reportWithoutDigest,
    binding: { ...binding, deterministic_report_sha256: deterministicDigest },
    report_content_digest_sha256: reportDigest,
    deterministic_report_sha256: deterministicDigest,
  };

  if (opts.write !== false) {
    mkdirSync(REPORTS_DIR, { recursive: true });
    const outPath = path.join(REPORTS_DIR, `${runId}.json`);
    writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");
    report._written_path = outPath;
  }

  return report;
}

/**
 * Run a single hostile probe target. Returns probe result with BOUNDARY_HOLD / BOUNDARY_ESCAPE.
 */
export async function runProbe(targetId, opts = {}) {
  const target = getTarget(targetId);
  if (!target.probe) throw new Error(`not_a_probe:${targetId}`);
  const entryAbs = path.join(TARGETS_DIR, target.entry);
  if (!existsSync(entryAbs)) throw new Error(`missing_target_entry:${entryAbs}`);

  const runId = opts.runId || `probe_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const workDir = createRunWorkdir(runId);
  const isolation = resolveIsolation(workDir);
  const startedAt = new Date().toISOString();

  const corpusPath = path.join(CORPUS_DIR, CORPUS_FILE);
  const reportsPath = REPORTS_DIR;
  const writeMarker = `hostile_write_probe_${runId}`;
  const input = {
    probe: target.probe_kind || target.id,
    corpus_path: corpusPath,
    reports_path: reportsPath,
    work_dir: workDir,
    canary_env_key: "RAVEN_CONFORMANCE_CANARY",
    write_marker: writeMarker,
  };

  let exec;
  try {
    exec = await spawnIsolated({
      entryAbs,
      inputObj: input,
      workDir,
      isolation,
      timeoutMs: opts.timeoutMs || (target.probe_kind === "timeout" || target.id.includes("ENDLESS") ? PROBE_TIMEOUT_MS : DEFAULT_TIMEOUT_MS),
      maxStdout: opts.maxStdout || (target.id.includes("FLOOD") ? PROBE_FLOOD_MAX_STDOUT : undefined),
      maxStderr: opts.maxStderr || (target.id.includes("FLOOD") ? PROBE_FLOOD_MAX_STDERR : undefined),
      injectCanary: false,
    });

    const kind = target.probe_kind || target.id;
    let status;
    let evidence = {
      stdout: exec.stdout,
      stderr: exec.stderr,
      exitCode: exec.exitCode,
      durationMs: exec.durationMs,
      timedOut: exec.timedOut,
      flooded: exec.flooded,
      isolation_mode: isolation.mode,
      isolation_verified: isolation.verified,
    };

    // Interpret by probe kind
    if (kind === "network" || target.id === "HOSTILE_NETWORK_ATTEMPT") {
      const observed = exec.observed;
      const blocked =
        observed?.network_blocked === true ||
        observed?.decision === "BOUNDARY_HOLD" ||
        /ENOTFOUND|ECONNREFUSED|network|denied|EPERM|getaddrinfo/i.test(exec.stdout + exec.stderr);
      // On curated_demo, network may succeed — that is BOUNDARY_ESCAPE for network claim
      if (blocked || (observed?.ok === false && observed?.error)) {
        status = "BOUNDARY_HOLD";
        evidence.note = "network attempt failed or reported blocked";
      } else if (observed?.network_ok === true || observed?.decision === "BOUNDARY_ESCAPE") {
        status = "BOUNDARY_ESCAPE";
        evidence.note = "network appeared to succeed — boundary did not hold";
      } else {
        // Ambiguous: treat crash/timeout as hold-ish for sandbox deny
        status = exec.timedOut || exec.exitCode !== 0 ? "BOUNDARY_HOLD" : "BOUNDARY_ESCAPE";
        evidence.note = "ambiguous network probe outcome; classified from exit/timeout";
      }
    } else if (kind === "env" || target.id === "HOSTILE_ENV_CANARY") {
      const observed = exec.observed;
      const leaked = observed?.canary_present === true;
      status = leaked ? "BOUNDARY_ESCAPE" : "BOUNDARY_HOLD";
      evidence.note = leaked ? "canary env visible to target" : "canary env absent from target (hold)";
      evidence.canary_env_expected_absent = true;
    } else if (kind === "write" || target.id === "HOSTILE_CORPUS_WRITE") {
      const observed = exec.observed;
      const wrote = observed?.write_succeeded === true;
      const { unlinkSync } = await import("node:fs");
      for (const a of observed?.attempts || []) {
        if (a?.path && existsSync(a.path)) {
          try { unlinkSync(a.path); } catch { /* */ }
        }
      }
      const probeFile = path.join(CORPUS_DIR, `.${writeMarker}`);
      const reportProbe = path.join(REPORTS_DIR, `.${writeMarker}.txt`);
      const exists = existsSync(probeFile) || existsSync(reportProbe);
      for (const pth of [probeFile, reportProbe]) {
        if (existsSync(pth)) {
          try { unlinkSync(pth); } catch { /* */ }
        }
      }
      status = wrote || exists ? "BOUNDARY_ESCAPE" : "BOUNDARY_HOLD";
      evidence.note = wrote || exists ? "corpus/report write succeeded (curated_demo may not confine FS)" : "write failed as expected";
      evidence.write_succeeded = Boolean(wrote || exists);
    } else if (kind === "timeout" || target.id === "HOSTILE_ENDLESS") {
      status = exec.timedOut ? "TIMEOUT" : exec.flooded ? "OUTPUT_FLOOD" : "BOUNDARY_ESCAPE";
      // Map to boundary: timeout is HOLD of runaway
      if (exec.timedOut) {
        evidence.boundary = "BOUNDARY_HOLD";
        evidence.note = "endless loop killed by timeout (hold)";
      } else {
        evidence.boundary = "BOUNDARY_ESCAPE";
        evidence.note = "endless loop did not timeout";
      }
    } else if (kind === "child" || target.id === "HOSTILE_CHILD_PERSIST") {
      // Runner cleanup: kill process group already done in spawnIsolated;
      // also explicitly reap any child_pid the probe reported.
      const childPid = exec.observed?.child_pid;
      if (childPid) {
        try { process.kill(-childPid, "SIGKILL"); } catch { /* */ }
        try { process.kill(childPid, "SIGKILL"); } catch { /* */ }
      }
      // Brief settle
      await new Promise((r) => setTimeout(r, 50));
      let alive = false;
      if (childPid) {
        try {
          process.kill(childPid, 0);
          alive = true;
        } catch {
          alive = false;
        }
      }
      // Final kill attempt if still alive (evidence of escape before kill)
      if (alive && childPid) {
        try { process.kill(childPid, "SIGKILL"); } catch { /* */ }
        try { process.kill(-childPid, "SIGKILL"); } catch { /* */ }
        await new Promise((r) => setTimeout(r, 50));
        try {
          process.kill(childPid, 0);
          alive = true;
        } catch {
          alive = false;
        }
        // If we had to specially kill outside process-group, still HOLD if now dead —
        // but record that group-kill alone was insufficient (curated_demo disclosure).
        evidence.required_explicit_child_kill = true;
      }
      // Classification: if group+explicit kill left it dead → HOLD; if immortal → ESCAPE
      let stillAlive = false;
      if (childPid) {
        try {
          process.kill(childPid, 0);
          stillAlive = true;
        } catch {
          stillAlive = false;
        }
      }
      status = stillAlive ? "BOUNDARY_ESCAPE" : "BOUNDARY_HOLD";
      evidence.note = stillAlive
        ? "child still alive after runner cleanup"
        : "child reaped by runner cleanup (hold)";
      evidence.child_pid = childPid ?? null;
      evidence.child_alive_after_cleanup = stillAlive;
    } else if (kind === "flood" || target.id === "HOSTILE_OUTPUT_FLOOD") {
      status = exec.flooded ? "OUTPUT_FLOOD" : "BOUNDARY_ESCAPE";
      evidence.boundary = exec.flooded ? "BOUNDARY_HOLD" : "BOUNDARY_ESCAPE";
      evidence.note = exec.flooded ? "output flood capped by runner" : "flood not detected";
    } else if (kind === "malformed" || target.id === "HOSTILE_MALFORMED_OUTPUT") {
      const { status: st } = classifyResult(exec, "ACCEPT");
      status = st === "INVALID_OUTPUT" ? "INVALID_OUTPUT" : st;
      evidence.boundary = status === "INVALID_OUTPUT" ? "BOUNDARY_HOLD" : "BOUNDARY_ESCAPE";
      evidence.note = "malformed stdout classification";
    } else if (kind === "crash" || target.id === "HOSTILE_EXIT_CRASH") {
      const { status: st } = classifyResult(exec, "ACCEPT");
      status = st === "TARGET_CRASH" ? "TARGET_CRASH" : st === "PASS" ? "BOUNDARY_ESCAPE" : st;
      evidence.boundary = status === "TARGET_CRASH" ? "BOUNDARY_HOLD" : "BOUNDARY_ESCAPE";
      evidence.note = "crash must not classify as PASS";
    } else {
      status = "RUNNER_FAILURE";
      evidence.note = `unknown_probe_kind:${kind}`;
    }

    const report = {
      schema: "raven-conformance-probe-report/1",
      run_id: runId,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      probe: true,
      target: {
        id: target.id,
        name: target.name,
        entry: target.entry,
        probe_kind: target.probe_kind,
        entry_sha256: fileSha256(entryAbs),
      },
      isolation: {
        mode: isolation.mode,
        verified: isolation.verified,
        platform: isolation.platform,
        details: isolation.details,
        verified_controls: isolation.verified_controls,
        assumed_controls: isolation.assumed_controls,
        disclosure: "Child process alone is not a security sandbox.",
      },
      status,
      boundary:
        evidence.boundary ||
        (status === "BOUNDARY_HOLD" || status === "TIMEOUT" || status === "OUTPUT_FLOOD" || status === "INVALID_OUTPUT" || status === "TARGET_CRASH"
          ? "BOUNDARY_HOLD"
          : status === "BOUNDARY_ESCAPE"
            ? "BOUNDARY_ESCAPE"
            : null),
      evidence,
      child_process_is_not_sandbox: true,
    };

    if (opts.write !== false) {
      mkdirSync(REPORTS_DIR, { recursive: true });
      const outPath = path.join(REPORTS_DIR, `${runId}.json`);
      writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");
      report._written_path = outPath;
    }
    return report;
  } finally {
    cleanupWorkdir(workDir);
  }
}

export async function runAllProbes(opts = {}) {
  const probes = loadProbeTargets();
  const reports = [];
  for (const p of probes) {
    reports.push(await runProbe(p.id, { ...opts, write: opts.write }));
  }
  return reports;
}

export function humanView(report) {
  const lines = [];
  lines.push(`Raven Conformance Report  ${report.run_id}`);
  const c = report.summary?.counts || {};
  lines.push(
    `Overall: ${report.summary.overall}  (${report.summary.pass} PASS / ${report.summary.divergence} BEHAVIORAL_DIVERGENCE of ${report.summary.test_count})`,
  );
  if (c.TIMEOUT || c.TARGET_CRASH || c.INVALID_OUTPUT || c.OUTPUT_FLOOD || c.RUNNER_FAILURE) {
    lines.push(
      `Other: TIMEOUT=${c.TIMEOUT || 0} CRASH=${c.TARGET_CRASH || 0} INVALID=${c.INVALID_OUTPUT || 0} FLOOD=${c.OUTPUT_FLOOD || 0} RUNNER_FAILURE=${c.RUNNER_FAILURE || 0}`,
    );
  }
  lines.push(`Target: ${report.target.id}  claimed profile: ${report.target.claimed_conformance_profile}`);
  lines.push(`Corpus: ${report.corpus.id}@${report.corpus.version}  sha256=${report.corpus.sha256}`);
  if (report.isolation) {
    lines.push(
      `Isolation: mode=${report.isolation.mode} verified=${report.isolation.verified} (child_process alone ≠ sandbox)`,
    );
  }
  lines.push(`Report digest: ${report.report_content_digest_sha256}`);
  if (report.deterministic_report_sha256) {
    lines.push(`Deterministic digest: ${report.deterministic_report_sha256}`);
  }
  lines.push("");
  for (const r of report.results) {
    const obs = r.observed.decision ?? `null(${r.observed.parseError || "n/a"})`;
    lines.push(`[${r.status}] ${r.vector_id}  expected=${r.expected.decision}  observed=${obs}`);
    if (r.status !== "PASS") {
      lines.push(`         reason=${r.observed.reason ?? "n/a"}  — ${r.description}`);
    }
  }
  lines.push("");
  lines.push("Reproduction:");
  lines.push(report.reproduction.one_liner);
  lines.push("");
  lines.push(
    "Note: BEHAVIORAL_DIVERGENCE means observed ≠ specified expectation only — not a security score.",
  );
  return lines.join("\n");
}
