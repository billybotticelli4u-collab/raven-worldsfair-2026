#!/usr/bin/env node
/**
 * Raven reader-check kit — run one transaction reader against Raven's pinned
 * Solana transaction-version profile and export the result.
 *
 * Reuses, unchanged, the Raven Conformance engine pieces: profile and corpus
 * loaders (digest-checked), isolation (Seatbelt on macOS / Node permissions on
 * Linux), per-case limits, and the result classifier. It does not register the
 * reader in the engine's target allowlist and does not change any engine file.
 *
 * Usage:
 *   node apps/raven-reader-check-kit/check-reader.mjs --reader <file.mjs> [--out <report.json>] [--explain <summary.md>]
 * Exit: 0 every case matched, 1 differences or non-passes, 2 setup/usage error.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const KIT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = path.join(KIT_DIR, "..", "raven-conformance", "src", "lib");
const PROFILE = "raven-solana-txversion-experimental/0";
const { loadProfile, loadCorpus, classifyResult, DEFAULT_TIMEOUT_MS } = await import(path.join(ENGINE, "runner.js"));
const { createRunWorkdir, cleanupWorkdir, resolveIsolation, spawnIsolated, DEFAULT_MAX_STDOUT_BYTES, DEFAULT_MAX_STDERR_BYTES } =
  await import(path.join(ENGINE, "isolation.js"));

const EXEC_ERRORS = new Set(["TARGET_CRASH", "TIMEOUT", "INVALID_OUTPUT", "OUTPUT_FLOOD", "RUNNER_FAILURE", "INCOMPLETE"]);
const PLAIN = {
  PASS: "matched the expected answer",
  BEHAVIORAL_DIVERGENCE: "gave a different answer than the profile expects",
  TARGET_CRASH: "exited with an error (no usable answer)",
  TIMEOUT: "took longer than the time limit",
  INVALID_OUTPUT: "printed something that is not a valid answer",
  OUTPUT_FLOOD: "printed more output than allowed",
  RUNNER_FAILURE: "could not be run by Raven",
  SKIPPED_VECTOR: "was skipped by the corpus (not checked)",
  INCOMPLETE: "was not reached",
};

function usage(msg) {
  if (msg) process.stderr.write(`error: ${msg}\n`);
  process.stderr.write("usage: node apps/raven-reader-check-kit/check-reader.mjs --reader <file.mjs> [--out <report.json>] [--explain <summary.md>] [--run-id <id>]\n");
  process.exit(2);
}
function parseArgs(argv) {
  const o = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--reader") o.reader = argv[++i];
    else if (a === "--out") o.out = argv[++i];
    else if (a === "--explain") o.explain = argv[++i];
    else if (a === "--run-id") o.runId = argv[++i];
    else if (a === "--help" || a === "-h") usage();
    else usage(`unknown argument ${a}`);
  }
  return o;
}
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
function gitIdentity() {
  try {
    const run = (args) => execFileSync("git", ["-C", KIT_DIR, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return { commit: run(["rev-parse", "HEAD"]), tree: run(["rev-parse", "HEAD^{tree}"]), worktree_clean: run(["status", "--porcelain", "--untracked-files=no"]) === "" };
  } catch { return { commit: null, tree: null, worktree_clean: null, note: "not a git checkout" }; }
}

export async function checkReader(readerPath, { runId } = {}) {
  if (!readerPath) usage("--reader is required");
  if (!existsSync(readerPath)) usage(`reader file not found: ${readerPath}`);
  const entryAbs = realpathSync(readerPath);
  if (!/\.(mjs|js)$/.test(entryAbs)) usage("reader must be a single .mjs/.js file");
  const readerBytes = readFileSync(entryAbs);
  const profile = loadProfile(PROFILE);
  const corpus = loadCorpus(profile.data.name); // refuses on digest mismatch
  const id = runId || `reader-check-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(id)) usage("--run-id may use only letters, digits, . _ -");
  const workDir = createRunWorkdir(id);
  const isolation = resolveIsolation(workDir);
  if (isolation.mode === "unavailable") {
    cleanupWorkdir(workDir);
    process.stderr.write(`error: isolation unavailable, refusing to run the reader: ${isolation.details}\n`);
    process.exit(2);
  }
  const startedAt = new Date().toISOString();
  const rows = [];
  try {
    for (const v of corpus.data.vectors) {
      if (v.skip === true) {
        rows.push({ vector_id: v.id, expected: { ...v.expected }, observed: null, status: "SKIPPED_VECTOR", evidence: null });
        continue;
      }
      const exec = await spawnIsolated({ entryAbs, inputObj: v.input, workDir, isolation, timeoutMs: DEFAULT_TIMEOUT_MS });
      const { status, evidence_note } = classifyResult(exec, v.expected);
      rows.push({
        vector_id: v.id,
        expected: { ...v.expected },
        observed: exec.observed ? { decision: exec.observed.decision ?? null, version: Object.hasOwn(exec.observed, "version") ? exec.observed.version : null, reason: exec.observed.reason ?? null } : null,
        status,
        evidence: { exitCode: exec.exitCode, durationMs: exec.durationMs, timedOut: exec.timedOut, flooded: exec.flooded, stderr: String(exec.stderr || "").slice(0, 500), note: evidence_note },
      });
    }
  } finally {
    cleanupWorkdir(workDir);
  }
  const counts = {};
  for (const r of rows) counts[r.status] = (counts[r.status] || 0) + 1;
  const ids = (pred) => rows.filter(pred).map((r) => r.vector_id);
  const divergent = ids((r) => r.status === "BEHAVIORAL_DIVERGENCE");
  const execErrors = ids((r) => EXEC_ERRORS.has(r.status));
  const skipped = ids((r) => r.status === "SKIPPED_VECTOR");
  const verdict = rows.length === 0 ? "INCOMPLETE"
    : divergent.length === 0 && execErrors.length === 0 && skipped.length === 0 ? "ALL_MATCHED"
    : divergent.length > 0 ? "DIVERGENT" : "NOT_PASSED";
  const templateNotConnected = rows.some((r) => r.evidence?.stderr?.includes("TEMPLATE_NOT_CONNECTED"));
  return {
    schema: "raven-reader-check-kit-report/0",
    run_id: id,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    signed: false,
    liveAcquisition: false,
    evidence_kind: "fixture corpus (Raven-owned test cases); no chain, RPC or network data was read",
    verdict,
    verdict_meaning: {
      ALL_MATCHED: "every case gave the expected decision and version",
      DIVERGENT: "at least one case gave a different decision or version than the profile expects",
      NOT_PASSED: "no answer differences, but some cases crashed, timed out, gave invalid output or were skipped",
      INCOMPLETE: "no cases ran",
    }[verdict],
    template_not_connected: templateNotConnected,
    kit: { ...gitIdentity(), driver_sha256: sha256(readFileSync(fileURLToPath(import.meta.url))) },
    reader: { path: path.relative(process.cwd(), entryAbs) || entryAbs, sha256: sha256(readerBytes), bytes: readerBytes.length },
    profile: { name: profile.data.name, version: profile.data.version, experimental: true, file: path.basename(profile.path), sha256: profile.digest },
    corpus: { id: corpus.data.id, version: corpus.data.version, file: path.basename(corpus.path), sha256: corpus.digest, vector_count: corpus.data.vectors.length },
    compared_fields: ["decision", "version"],
    not_compared: ["reason text", "signature validity", "signer trust", "execution or on-chain outcome", "fees or safety"],
    limits: { timeout_ms_per_case: DEFAULT_TIMEOUT_MS, max_stdout_bytes: DEFAULT_MAX_STDOUT_BYTES, max_stderr_bytes: DEFAULT_MAX_STDERR_BYTES },
    isolation: { mode: isolation.mode, verified: isolation.verified, platform: isolation.platform, details: isolation.details },
    runtime: { node: process.version, platform: `${process.platform}-${process.arch}` },
    counts,
    divergent_vector_ids: divergent,
    execution_error_vector_ids: execErrors,
    skipped_vector_ids: skipped,
    results: rows,
  };
}

export function explain(report) {
  const L = [];
  L.push(`# Reader check summary — ${report.run_id}`, "");
  L.push(`UNSIGNED kit report. Fixture evidence only (liveAcquisition: false). Checked against Raven's pinned profile and test corpus; this is not an on-chain result and not a security approval.`, "");
  L.push(`- Reader: \`${report.reader.path}\` (sha256 \`${report.reader.sha256}\`)`);
  L.push(`- Profile: \`${report.profile.name}\` v${report.profile.version} (experimental; sha256 \`${report.profile.sha256}\`)`);
  L.push(`- Corpus: \`${report.corpus.id}\` v${report.corpus.version}, ${report.corpus.vector_count} cases (sha256 \`${report.corpus.sha256}\`)`);
  L.push(`- Kit commit: \`${report.kit.commit}\`; isolation: ${report.isolation.mode}; Node ${report.runtime.node} on ${report.runtime.platform}`, "");
  L.push(`## Result: ${report.verdict}`, "", report.verdict_meaning, "");
  L.push("| Outcome | Cases |", "| --- | --- |");
  for (const [k, n] of Object.entries(report.counts)) L.push(`| ${k} (${PLAIN[k] || k}) | ${n} |`);
  L.push("");
  const diffs = report.results.filter((r) => r.status !== "PASS");
  if (diffs.length) {
    L.push("## What differed or did not pass", "", "| Case | Expected | Your reader | Outcome |", "| --- | --- | --- | --- |");
    for (const r of diffs) {
      const e = `${r.expected.decision} / ${JSON.stringify(r.expected.version ?? null)} (${r.expected.reason ?? ""})`;
      const o = r.observed ? `${r.observed.decision} / ${JSON.stringify(r.observed.version)} (${r.observed.reason ?? ""})` : "no answer";
      L.push(`| ${r.vector_id} | ${e} | ${o} | ${r.status} |`);
    }
    L.push("");
  } else L.push("No case differed.", "");
  if (report.template_not_connected) L.push("**The template reader is not connected yet.** Edit `classifyTransaction()` in your copy of the template and re-run.", "");
  L.push("## What was checked", "", `Only the ACCEPT/REJECT decision and the reported transaction version for each of the ${report.corpus.vector_count} fixed test cases. Reason text is shown but not scored.`, "");
  L.push("## What remains unknown", "", "- Signature validity, signer trust, fees, execution, on-chain outcome and safety are not checked.", "- The profile is experimental and covers a bounded set of transaction-format rules (legacy, v0, proposed v1 / SIMD-0385); passing every case is not proof of full Solana correctness.", "- Reasons for REJECT are not compared, so a reader can reject for a different reason and still match.", "- Policy decisions (what you do with a difference) are yours; this report does not approve or block anything.", "");
  return L.join("\n");
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv);
  const report = await checkReader(args.reader, { runId: args.runId });
  const out = args.out || path.join(KIT_DIR, "reader-check-results", `${report.run_id}.json`);
  mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
  const md = explain(report);
  if (args.explain) writeFileSync(args.explain, md + "\n");
  process.stdout.write(`verdict: ${report.verdict}  (${Object.entries(report.counts).map(([k, n]) => `${k}=${n}`).join(" ")})\n`);
  const nonPass = report.results.filter((x) => x.status !== "PASS");
  for (const r of nonPass.slice(0, 10)) {
    process.stdout.write(`  ${r.status} ${r.vector_id}: expected ${r.expected.decision}/${JSON.stringify(r.expected.version ?? null)}, got ${r.observed ? `${r.observed.decision}/${JSON.stringify(r.observed.version)}` : "no answer"}\n`);
  }
  if (nonPass.length > 10) process.stdout.write(`  ... ${nonPass.length - 10} more non-passing cases listed in the report\n`);
  if (report.template_not_connected) process.stdout.write("  hint: the template reader is not connected yet — edit classifyTransaction()\n");
  process.stdout.write(`report: ${out}  sha256 ${sha256(readFileSync(out))}\n`);
  if (args.explain) process.stdout.write(`summary: ${args.explain}\n`);
  process.stdout.write("UNSIGNED; fixture evidence only (liveAcquisition:false)\n");
  process.exit(report.verdict === "ALL_MATCHED" ? 0 : 1);
}
