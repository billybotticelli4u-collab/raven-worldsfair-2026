/**
 * MVP isolation runner — local Node child process only (not a general sandbox).
 * - No Raven credentials in target env
 * - Outbound network denied by default (proxies unset; documented)
 * - Bounded time via timeout
 * - Deterministic stdin; target cannot mutate corpus/report signer
 */
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { APP_ROOT, CORPUS_DIR, PROFILES_DIR, TARGETS_DIR, REPORTS_DIR } from "./paths.js";
import { sha256Hex, fileSha256 } from "./digest.js";

const DEFAULT_TIMEOUT_MS = 3000;
const PROFILE_FILE = "raven-canonical-envelope-1.json";
const CORPUS_FILE = "raven-canonical-envelope-demo-corpus-1.json";

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

export function getTarget(targetId) {
  const t = loadTargets().find((x) => x.id === targetId);
  if (!t) throw new Error(`unknown_target:${targetId}`);
  return t;
}

function restrictedEnv() {
  const keep = ["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "USER", "LOGNAME"];
  const env = {};
  for (const k of keep) {
    if (process.env[k]) env[k] = process.env[k];
  }
  // Explicitly deny common proxy / credential leakage into target.
  env.HTTP_PROXY = "";
  env.HTTPS_PROXY = "";
  env.http_proxy = "";
  env.https_proxy = "";
  env.ALL_PROXY = "";
  env.all_proxy = "";
  env.NO_PROXY = "*";
  env.NODE_OPTIONS = "";
  env.npm_config_registry = "";
  env.RAVEN_API_KEY = "";
  env.RAVEN_TOKEN = "";
  env.AWS_SECRET_ACCESS_KEY = "";
  env.AWS_ACCESS_KEY_ID = "";
  env.GITHUB_TOKEN = "";
  return env;
}

/**
 * Run one vector against a target entry script.
 */
export function runVector(entryAbs, inputObj, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [entryAbs], {
      cwd: path.dirname(entryAbs),
      env: restrictedEnv(),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.stderr.on("data", (d) => {
      stderr += d;
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        timedOut: false,
        exitCode: null,
        stdout,
        stderr: stderr + String(err),
        durationMs: Date.now() - started,
        observed: null,
        parseError: "spawn_error",
      });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      let observed = null;
      let parseError = null;
      const line = stdout.trim().split(/\r?\n/).filter(Boolean).pop() || "";
      try {
        observed = JSON.parse(line);
        if (!observed || typeof observed.decision !== "string") {
          parseError = "missing_decision";
          observed = null;
        }
      } catch {
        parseError = "unparseable_stdout";
      }
      resolve({
        ok: !killed && code === 0 && !parseError,
        timedOut: killed,
        exitCode: code,
        stdout,
        stderr,
        durationMs: Date.now() - started,
        observed,
        parseError,
      });
    });

    child.stdin.write(JSON.stringify(inputObj));
    child.stdin.end();
  });
}

function environmentIdentity() {
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    os: `${os.type()} ${os.release()}`,
    cwd_policy: "target_dir_only",
    network_policy: "outbound_denied_by_default_proxies_unset",
    credentials_policy: "no_raven_credentials_in_target_env",
    timeout_ms_default: DEFAULT_TIMEOUT_MS,
    isolation: "local_node_child_process_mvp_not_general_sandbox",
  };
}

/**
 * Execute full conformance run for a target id.
 */
export async function runConformance(targetId, opts = {}) {
  const profile = loadProfile();
  const corpus = loadCorpus();
  const target = getTarget(targetId);
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
    if (exec.timedOut) status = "DIVERGENCE";
    else if (exec.parseError) status = "DIVERGENCE";
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
        durationMs: exec.durationMs,
      },
    });
  }

  const passCount = results.filter((r) => r.status === "PASS").length;
  const divergenceCount = results.filter((r) => r.status === "DIVERGENCE").length;
  const overall = divergenceCount === 0 ? "CONFORMANT" : "DIVERGENT";

  const reproduction = {
    clean_clone: [
      "git clone https://github.com/billybotticelli4u-collab/raven-worldsfair-2026.git",
      "cd raven-worldsfair-2026",
      `git checkout billy/fair-conformance-mvp-2026-09-16`,
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
      filesystem: "target script + stdin only",
      network: "denied_by_default",
      credentials: "none_injected",
      corpus_mutation: "forbidden_runner_owns_corpus",
      report_signer: "runner_owns_report_hash_target_cannot_mutate",
    },
    summary: {
      test_count: results.length,
      pass: passCount,
      divergence: divergenceCount,
      overall,
    },
    results,
    divergence_definition:
      "DIVERGENCE = observed decision ≠ specified corpus expectation only. Not automatically exploitable, unsafe, or malicious. No generic security score.",
    limitations: [
      "MVP isolation is local Node child_process with restricted env and timeout — not a general sandbox or container hardened runtime.",
      "Outbound network is denied by unsetting proxies and documenting policy; this does not install a kernel network namespace.",
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
  lines.push(`Overall: ${report.summary.overall}  (${report.summary.pass} PASS / ${report.summary.divergence} DIVERGENCE of ${report.summary.test_count})`);
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
