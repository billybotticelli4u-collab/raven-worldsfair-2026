/** Bounded curated-demo runner. Node permissions are not an OS sandbox. */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CORPUS_DIR, PROFILES_DIR, TARGETS_DIR, REPORTS_DIR } from "./paths.js";
import { sha256Hex, fileSha256 } from "./digest.js";

const DEFAULT_TIMEOUT_MS = 3000;
const OUTPUT_LIMIT_BYTES = 65536;
const PROFILE_FILE = "raven-canonical-envelope-1.json";
const CORPUS_FILE = "raven-canonical-envelope-demo-corpus-1.json";

function refuse(code) { const error = new Error(code); error.code = code; throw error; }

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
  if (data.content_digest_sha256 !== computed) refuse("CORPUS_DIGEST_MISMATCH");
  return { path: p, digest: computed, declaredDigest: data.content_digest_sha256 || null, data };
}

export function loadTargets() {
  const m = JSON.parse(readFileSync(path.join(TARGETS_DIR, "manifests.json"), "utf8"));
  return m.targets;
}

export function getTarget(targetId) {
  const t = loadTargets().find((x) => x.id === targetId);
  if (!t) throw new Error(`unknown_target:${targetId}`);
  return t;
}

function restrictedEnv() {
  return { LANG: "C", TZ: "UTC" };
}

const active = new Set();
function terminate(child) {
  if (!child.pid) return;
  try { process.kill(-child.pid, "SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch {} }
}
process.once("exit", () => { for (const child of active) terminate(child); });
process.once("SIGINT", () => process.exit(130));
process.once("SIGTERM", () => process.exit(143));

/** Only curated, single-file Node targets. Child creation is denied by Node permissions. */
export function runVector(entryAbs, inputObj, timeoutMs = DEFAULT_TIMEOUT_MS) {
  if (process.platform === "win32") refuse("UNSUPPORTED_CONTAINMENT_PLATFORM");
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, ["--permission", `--allow-fs-read=${entryAbs}`, entryAbs], {
      cwd: path.dirname(entryAbs), env: restrictedEnv(),
      stdio: ["pipe", "pipe", "pipe"], detached: true, windowsHide: true,
    });
    active.add(child);
    let stdout = Buffer.alloc(0), stderr = Buffer.alloc(0);
    let timedOut = false, outputTruncated = false, spawnError = false;
    const timer = setTimeout(() => { timedOut = true; terminate(child); }, timeoutMs);
    const capture = (which, chunk) => {
      const current = which === "stdout" ? stdout : stderr;
      const remaining = Math.max(0, OUTPUT_LIMIT_BYTES - current.length);
      const next = Buffer.concat([current, chunk.subarray(0, remaining)]);
      if (which === "stdout") stdout = next; else stderr = next;
      if (chunk.length > remaining) { outputTruncated = true; terminate(child); }
    };
    child.stdout.on("data", d => capture("stdout", d));
    child.stderr.on("data", d => capture("stderr", d));
    child.stdin.on("error", () => {}); // early target exit must not crash the harness
    child.on("error", () => { spawnError = true; });
    // Terminate remaining group members even when the direct child exits normally.
    child.on("exit", () => terminate(child));
    child.on("close", (code, signal) => {
      clearTimeout(timer); active.delete(child);
      const out = stdout.toString("utf8"), err = stderr.toString("utf8");
      let observed = null, parseError = null;
      try {
        const lines = out.trim().split(/\r?\n/).filter(Boolean);
        if (lines.length !== 1) throw new Error("one_result_required");
        observed = JSON.parse(lines[0]);
        if (!observed || !["ACCEPT", "REJECT"].includes(observed.decision)) throw new Error("invalid_decision");
      } catch { parseError = "invalid_output"; observed = null; }
      const errorCode = spawnError ? "SPAWN_ERROR" : outputTruncated ? "OUTPUT_LIMIT" : timedOut ? "TIMEOUT"
        : code !== 0 || signal ? "TARGET_CRASH" : parseError ? "INVALID_OUTPUT" : null;
      resolve({ ok: errorCode === null, timedOut, exitCode: code, signal, stdout: out, stderr: err,
        durationMs: Date.now() - started, observed, parseError, errorCode, outputTruncated });
    });
    child.stdin.end(JSON.stringify(inputObj));
  });
}

function environmentIdentity() {
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    os: `${os.type()} ${os.release()}`,
    cwd_policy: "target_dir_only",
    network_policy: "not_restricted",
    credentials_policy: "no_raven_credentials_in_target_env",
    timeout_ms_default: DEFAULT_TIMEOUT_MS,
    isolation: "curated_node_permissions_and_process_group_not_os_sandbox",
  };
}

/**
 * Execute full conformance run for a target id.
 */
export async function runConformance(targetId, opts = {}) {
  const profile = loadProfile();
  const corpus = loadCorpus();
  const target = getTarget(targetId);
  if (target.claimed_conformance_profile !== profile.data.name ||
      target.claimed_conformance_profile_version !== profile.data.version || corpus.data.profile !== profile.data.name)
    refuse("PROFILE_MISMATCH");
  const entryAbs = path.join(TARGETS_DIR, target.entry);
  if (!existsSync(entryAbs)) throw new Error(`missing_target_entry:${entryAbs}`);

  const targetDigest = fileSha256(entryAbs);
  const runId = opts.runId || `run_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const startedAt = new Date().toISOString();
  const results = [];

  for (const vector of corpus.data.vectors) {
    const exec = await runVector(entryAbs, vector.input, opts.timeoutMs || DEFAULT_TIMEOUT_MS);
    const expectedDecision = vector.expected.decision;
    const observedDecision = exec.observed?.decision ?? null;
    let status;
    if (!exec.ok) status = "HARNESS_ERROR";
    else if (observedDecision === expectedDecision) status = "PASS";
    else status = "DIVERGENCE";

    results.push({
      vector_id: vector.id,
      description: vector.description,
      expected: { decision: expectedDecision },
      observed: exec.observed
        ? { decision: exec.observed.decision, reason: exec.observed.reason ?? null }
        : { decision: null, reason: null, parseError: exec.parseError, timedOut: exec.timedOut },
      status,
      evidence: {
        stdout: exec.stdout,
        stderr: exec.stderr,
        exitCode: exec.exitCode,
        signal: exec.signal,
        error_code: exec.errorCode,
        timed_out: exec.timedOut,
        output_truncated: exec.outputTruncated,
        output_limit_bytes_per_stream: OUTPUT_LIMIT_BYTES,
        durationMs: exec.durationMs,
      },
    });
  }

  const passCount = results.filter((r) => r.status === "PASS").length;
  const divergenceCount = results.filter((r) => r.status === "DIVERGENCE").length;
  const harnessCount = results.filter(r => r.status === "HARNESS_ERROR").length;
  const overall = harnessCount ? "HARNESS_ERROR" : divergenceCount === 0 ? "CONFORMANT" : "DIVERGENT";

  const reproduction = {
    clean_clone: [
      "git clone https://github.com/billybotticelli4u-collab/raven-worldsfair-2026.git",
      "cd raven-worldsfair-2026",
      `git checkout codex/phase1-fair-fixes-2026-09-16`,
      "cd apps/raven-conformance",
      "npm test",
      `npm run conform -- --target ${targetId}`,
    ].join("\n"),
    one_liner: `cd apps/raven-conformance && npm run conform -- --target ${targetId}`,
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
      claimed_conformance_profile_version: target.claimed_conformance_profile_version,
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
    environment: environmentIdentity(),
    allowed_resources: {
      filesystem: "Node permission read allowlist: entry script; stdin via inherited fd; no fs writes; not OS containment",
      network: "not_restricted",
      credentials: "none_injected",
      corpus_mutation: "fs_writes_denied_by_node_permissions_not_os_sandbox",
      report_signer: "unsigned_runner_generated_digest_not_execution_attestation",
    },
    summary: {
      test_count: results.length,
      pass: passCount,
      divergence: divergenceCount,
      harness_error: harnessCount,
      graded_count: passCount + divergenceCount,
      divergent_vector_ids: results.filter(r => r.status === "DIVERGENCE").map(r => r.vector_id),
      harness_error_vector_ids: results.filter(r => r.status === "HARNESS_ERROR").map(r => r.vector_id),
      overall,
    },
    results,
    divergence_definition:
      "DIVERGENCE = observed decision ≠ specified corpus expectation only. Not automatically exploitable, unsafe, or malicious. No generic security score.",
    limitations: [
      "Curated Node targets only: permission allowlist, no child-process grant, process-group cleanup, timeout and 64 KiB per-stream output cap. Not an OS sandbox for hostile arbitrary code.",
      "Network access is not restricted by this runner. Environment omission is not an egress control.",
      "Demo targets and corpus are Raven-owned Fair self-contained fixtures — not private production corpora.",
      "Does not include token, marketplace, cert authority, pentest scanner, accounts, registry, billing, or governance architecture.",
      "Author-lane Fair Build Stage product review surface only.",
    ],
    reproduction,
  };

  const body = JSON.stringify(reportWithoutDigest, null, 2) + "\n";
  const reportDigest = sha256Hex(body);
  const report = { ...reportWithoutDigest, report_content_digest_sha256: reportDigest };

  if (opts.write !== false) {
    mkdirSync(REPORTS_DIR, { recursive: true });
    const outPath = path.join(REPORTS_DIR, `${runId}.json`);
    writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");
    report._written_path = outPath;
  }

  return report;
}

export function humanView(report) {
  const lines = [];
  lines.push(`Raven Conformance Report  ${report.run_id}`);
  lines.push(`Overall: ${report.summary.overall}  (${report.summary.pass} PASS / ${report.summary.divergence} DIVERGENCE / ${report.summary.harness_error} HARNESS_ERROR of ${report.summary.test_count})`);
  lines.push(`Divergent vectors: ${report.summary.divergent_vector_ids.join(", ") || "none"}`);
  lines.push(`Target: ${report.target.id}  claimed profile: ${report.target.claimed_conformance_profile}`);
  lines.push(`Corpus: ${report.corpus.id}@${report.corpus.version}  sha256=${report.corpus.sha256}`);
  lines.push(`Report digest: ${report.report_content_digest_sha256}`);
  lines.push("");
  for (const r of report.results) {
    const obs = r.observed.decision ?? `null(${r.observed.parseError || "n/a"})`;
    lines.push(`[${r.status}] ${r.vector_id}  expected=${r.expected.decision}  observed=${obs}`);
    if (r.status === "DIVERGENCE") {
      lines.push(`         reason=${r.observed.reason ?? "n/a"}  — ${r.description}`);
    }
  }
  lines.push("");
  lines.push("Reproduction:");
  lines.push(report.reproduction.one_liner);
  lines.push("");
  lines.push("Note: DIVERGENCE means observed ≠ specified expectation only — not a security score.");
  return lines.join("\n");
}
