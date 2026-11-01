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
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, chmodSync, lstatSync, statSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const KIT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = path.join(KIT_DIR, "..", "raven-conformance", "src", "lib");
const PROFILE = "raven-solana-txversion-experimental/0";
const { loadProfile, loadCorpus, classifyResult, DEFAULT_TIMEOUT_MS } = await import(path.join(ENGINE, "runner.js"));
const { createRunWorkdir, cleanupWorkdir, resolveIsolation, spawnIsolated, DEFAULT_MAX_STDOUT_BYTES, DEFAULT_MAX_STDERR_BYTES } =
  await import(path.join(ENGINE, "isolation.js"));
const { APP_ROOT } = await import(path.join(ENGINE, "paths.js"));

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
  INCOMPLETE: "has no usable result",
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
// Expected filesystem failures during setup/export become exit-2 refusals.
// Anything else (programming errors) still propagates with its stack trace.
const FS_SETUP_CODES = new Set(["EACCES", "EPERM", "EROFS", "ENOSPC", "EDQUOT", "EEXIST", "ENOENT", "ENOTDIR", "EISDIR", "ELOOP", "ENAMETOOLONG", "EMFILE", "ENFILE", "EIO", "EBUSY"]);
const isFsSetupError = (e) => e instanceof Error && typeof e.code === "string" && FS_SETUP_CODES.has(e.code);
export class KitSetupError extends Error {}
export const snapshotDirFor = (runId) => path.join(realpathSync(APP_ROOT), `.reader-kit-snapshot-${runId}`);
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
function runIdentity(runId) {
  // Generated default: second-resolution timestamp + process id + 64 random
  // bits, so same-second runs get distinct run-owned snapshot paths.
  // Explicit --run-id values are used verbatim and validated as before.
  const id = runId || `reader-check-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${process.pid}-${randomBytes(8).toString("hex")}`;
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(id)) usage("--run-id may use only letters, digits, . _ -");
  return id;
}

// Resolve components in filesystem order. Lexical normalization would apply
// ".." before following a symlink and can name a different file than the kernel.
// Missing suffixes are allowed for new outputs; dangling links fail closed.
function fileIdentity(filename) {
  const absolute = path.isAbsolute(filename) ? filename : `${process.cwd()}${path.sep}${filename}`;
  let canonical = path.parse(absolute).root;
  let st = statSync(canonical);
  for (const component of absolute.split(path.sep).filter(Boolean)) {
    if (component === "." || component === "..") {
      if (!st?.isDirectory()) throw new Error(`cannot traverse directory: ${canonical}`);
      if (component === "..") canonical = path.dirname(canonical);
      st = statSync(canonical);
      continue;
    }
    if (st && !st.isDirectory()) throw new Error(`not a directory: ${canonical}`);
    canonical = path.join(canonical, component);
    try { lstatSync(canonical); }
    catch (e) {
      if (e.code !== "ENOENT") throw e;
      st = null;
      continue;
    }
    // The native resolver also preserves symlink/.. order inside link targets.
    canonical = realpathSync.native(canonical);
    st = statSync(canonical);
  }
  if (st && !st.isFile()) throw new Error(`not a regular file: ${filename}`);
  return { canonical, inode: st ? `${st.dev}:${st.ino}` : null };
}

// Missing-parent policy: an explicit --out/--explain parent directory must
// already exist (refused with exit 2 otherwise); only the kit-owned default
// results directory is created. Trailing separators are refused.
function validateOutputPaths(reader, out, explainPath, { defaultOut = false } = {}) {
  for (const [label, filename] of [["JSON", out], ["Markdown", explainPath]]) {
    if (filename && /[\\/]$/.test(filename)) usage(`invalid_output_path: ${label} path ends with a directory separator: ${filename}`);
  }
  try {
    const files = [["reader", reader], ["JSON", out], ...(explainPath ? [["Markdown", explainPath]] : [])]
      .map(([label, filename]) => ({ label, ...fileIdentity(filename) }));
    for (let i = 0; i < files.length; i++) for (let j = i + 1; j < files.length; j++) {
      const a = files[i], b = files[j];
      if (a.canonical === b.canonical || (a.inode && a.inode === b.inode)) {
        usage(`output_path_collision: ${a.label} and ${b.label} refer to the same file`);
      }
    }
    for (const f of files.slice(1)) {
      if (f.label === "JSON" && defaultOut) continue;
      const parent = path.dirname(f.canonical);
      let ok = false;
      try { ok = statSync(parent).isDirectory(); } catch (e) { if (!isFsSetupError(e)) throw e; }
      if (!ok) usage(`output_parent_missing: the ${f.label} folder ${parent} does not exist; create it first (the kit creates only its default results folder)`);
    }
  } catch (e) { usage(`invalid_output_path: ${e.message}`); }
}

// Publish an export by writing a private sibling temp file and renaming it over
// the (physical) target, so a failed or partial write never truncates earlier
// bytes at the target. The temp file is removed on failure.
function publishExport(file, bytes, runId) {
  // Same physical resolution as the alias checks (symlink/.. order preserved).
  const target = fileIdentity(file).canonical;
  const tmp = `${target}.${runId}.${randomBytes(6).toString("hex")}.tmp`;
  try { writeFileSync(tmp, bytes, { flag: "wx" }); renameSync(tmp, target); }
  catch (e) { try { rmSync(tmp, { force: true }); } catch {} throw e; }
}

function gitIdentity() {
  try {
    const run = (args) => execFileSync("git", ["-C", KIT_DIR, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return { commit: run(["rev-parse", "HEAD"]), tree: run(["rev-parse", "HEAD^{tree}"]), worktree_clean: run(["status", "--porcelain", "--untracked-files=no"]) === "" };
  } catch { return { commit: null, tree: null, worktree_clean: null, note: "not a git checkout" }; }
}

export async function checkReader(readerPath, { runId } = {}) {
  if (!readerPath) usage("--reader is required");
  if (!existsSync(readerPath)) usage(`reader file not found: ${readerPath}`);
  const entryAbs = fileIdentity(readerPath).canonical;
  if (!/\.(mjs|js)$/.test(entryAbs)) usage("reader must be a single .mjs/.js file");
  const readerBytes = readFileSync(entryAbs);
  const readerDigest = sha256(readerBytes);
  const profile = loadProfile(PROFILE);
  const corpus = loadCorpus(profile.data.name); // refuses on digest mismatch
  const id = runIdentity(runId);
  const workDir = createRunWorkdir(id);
  const isolation = resolveIsolation(workDir);
  if (isolation.mode === "unavailable") {
    cleanupWorkdir(workDir);
    process.stderr.write(`error: isolation unavailable, refusing to run the reader: ${isolation.details}\n`);
    process.exit(2);
  }
  const startedAt = new Date().toISOString();
  const rows = [];
  const recordStoppedFrom = (index) => {
    for (const [offset, vector] of corpus.data.vectors.slice(index).entries()) {
      rows.push({ vector_id: vector.id, expected: { ...vector.expected }, observed: null, status: "INCOMPLETE",
        evidence: { note: offset === 0 ? "reader_snapshot_changed" : "not_run_after_reader_snapshot_changed" } });
    }
  };
  let snapshotDir;
  try {
    // APP_ROOT is explicitly write-denied by the existing Seatbelt profile,
    // including when the checkout is under /tmp. Node permissions also deny
    // writes. A normal temp/workDir copy would be writable by a Mac reader.
    // One run-owned snapshot path per run id; an existing path (for example a
    // hard-kill leftover) is never reused or deleted here.
    const ownedDir = snapshotDirFor(id);
    try { mkdirSync(ownedDir, { mode: 0o700 }); }
    catch (e) {
      if (!isFsSetupError(e)) throw e;
      throw new KitSetupError(`capture_failed: could not create the reader snapshot folder ${ownedDir} (${e.code}). ` +
        (e.code === "EEXIST" ? "It already exists, probably left by an interrupted run with this run id; see README 'Recovering after a hard kill' or use another --run-id." : "The engine folder must be writable by you; nothing was run."));
    }
    snapshotDir = ownedDir;
    const capturedEntry = path.join(snapshotDir, "reader.mjs");
    try {
      writeFileSync(capturedEntry, readerBytes, { flag: "wx", mode: 0o400 });
      chmodSync(snapshotDir, 0o500);
    } catch (e) {
      if (!isFsSetupError(e)) throw e;
      throw new KitSetupError(`capture_failed: could not capture the reader into ${snapshotDir} (${e.code}); nothing was run.`);
    }
    const snapshotMatches = () => {
      try { return sha256(readFileSync(capturedEntry)) === readerDigest; }
      catch { return false; }
    };
    for (const [index, v] of corpus.data.vectors.entries()) {
      if (v.skip === true) {
        rows.push({ vector_id: v.id, expected: { ...v.expected }, observed: null, status: "SKIPPED_VECTOR", evidence: null });
        continue;
      }
      if (!snapshotMatches()) {
        recordStoppedFrom(index);
        break;
      }
      const exec = await spawnIsolated({ entryAbs: capturedEntry, inputObj: v.input, workDir, isolation, timeoutMs: DEFAULT_TIMEOUT_MS });
      if (!snapshotMatches()) {
        recordStoppedFrom(index);
        break;
      }
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
    if (snapshotDir) {
      chmodSync(snapshotDir, 0o700);
      rmSync(snapshotDir, { recursive: true });
    }
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
  const stoppedForSnapshot = rows.some((r) => r.evidence?.note === "reader_snapshot_changed");
  return {
    schema: "raven-reader-check-kit-report/0",
    run_id: id,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    signed: false,
    liveAcquisition: false,
    evidence_kind: "Raven supplied fixed fixture inputs; the kit makes no provider calls. Reader access to other data depends on the reported isolation controls and execution environment.",
    verdict,
    verdict_meaning: {
      ALL_MATCHED: "every case gave the expected decision and version",
      DIVERGENT: "at least one case gave a different decision or version than the profile expects",
      NOT_PASSED: "no answer differences, but some cases crashed, timed out, gave invalid output or were skipped",
      INCOMPLETE: "no cases ran",
    }[verdict] + (stoppedForSnapshot ? ". The run stopped because the captured reader changed. The affected case and every remaining case are INCOMPLETE; no answer is claimed for them." : ""),
    template_not_connected: templateNotConnected,
    kit: { ...gitIdentity(), driver_sha256: sha256(readFileSync(fileURLToPath(import.meta.url))) },
    reader: { path: path.relative(process.cwd(), entryAbs) || entryAbs, sha256: readerDigest, bytes: readerBytes.length, execution_binding: "captured_single_file" },
    profile: { name: profile.data.name, version: profile.data.version, experimental: true, file: path.basename(profile.path), sha256: profile.digest },
    corpus: { id: corpus.data.id, version: corpus.data.version, file: path.basename(corpus.path), sha256: corpus.digest, digest_kind: "canonical_content", file_sha256: sha256(readFileSync(corpus.path)), vector_count: corpus.data.vectors.length },
    compared_fields: ["decision", "version"],
    not_compared: ["reason text", "signature validity", "signer trust", "execution or on-chain outcome", "fees or safety"],
    limits: { timeout_ms_per_case: DEFAULT_TIMEOUT_MS, max_stdout_bytes: DEFAULT_MAX_STDOUT_BYTES, max_stderr_bytes: DEFAULT_MAX_STDERR_BYTES },
    isolation: { mode: isolation.mode, verified: isolation.verified, platform: isolation.platform, details: isolation.details, verified_controls: isolation.verified_controls, assumed_controls: isolation.assumed_controls },
    runtime: { node: process.version, platform: `${process.platform}-${process.arch}`, electron: process.versions.electron ?? null },
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
  L.push(`- Corpus: \`${report.corpus.id}\` v${report.corpus.version}, ${report.corpus.vector_count} cases (canonical content SHA-256 \`${report.corpus.sha256}\`; file SHA-256 \`${report.corpus.file_sha256}\`)`);
  L.push(`- Kit commit: \`${report.kit.commit}\`; isolation: ${report.isolation.mode}; Node ${report.runtime.node} on ${report.runtime.platform}`, "");
  L.push(`Isolation limits: ${report.isolation.details}`, "", "Run only reviewed code in an approved environment without credentials. These controls do not establish that the host contains no secrets.", "");
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
  if (!args.reader) usage("--reader is required");
  if (!existsSync(args.reader)) usage(`reader file not found: ${args.reader}`);
  const runId = runIdentity(args.runId);
  const defaultOut = !args.out;
  const out = args.out || path.join(KIT_DIR, "reader-check-results", `${runId}.json`);
  validateOutputPaths(args.reader, out, args.explain, { defaultOut });
  let report;
  try { report = await checkReader(args.reader, { runId }); }
  catch (e) { if (e instanceof KitSetupError) usage(e.message); throw e; }
  // Recheck before writes in case paths changed while the reader ran.
  validateOutputPaths(args.reader, out, args.explain, { defaultOut });
  const jsonBytes = Buffer.from(JSON.stringify(report, null, 2) + "\n");
  try {
    if (defaultOut) mkdirSync(path.dirname(out), { recursive: true });
    publishExport(out, jsonBytes, runId);
  } catch (e) {
    if (!isFsSetupError(e)) throw e;
    usage(`export_write_failed: could not write the JSON report ${out} (${e.code}); no result is reported as complete`);
  }
  // Newly created names may alias through filesystem case/Unicode folding.
  // JSON now has an inode: refuse before Markdown can replace its contents.
  validateOutputPaths(args.reader, out, args.explain, { defaultOut });
  const md = explain(report);
  const mdBytes = Buffer.from(md + "\n");
  if (args.explain) {
    try { publishExport(args.explain, mdBytes, runId); }
    catch (e) {
      if (!isFsSetupError(e)) throw e;
      usage(`export_write_failed: could not write the Markdown summary ${args.explain} (${e.code}); the JSON report ${out} was written and kept; no success is claimed`);
    }
  }
  // Another writer may have replaced an export after we published it. Never
  // print this run's verdict beside bytes this run did not write.
  for (const [label, file, bytes] of [["JSON report", out, jsonBytes], ...(args.explain ? [["Markdown summary", args.explain, mdBytes]] : [])]) {
    let same = false;
    try { same = readFileSync(file).equals(bytes); } catch (e) { if (!isFsSetupError(e)) throw e; }
    if (!same) usage(`export_overwritten: the ${label} ${file} no longer holds this run's bytes (another run or writer replaced it); no success is claimed`);
  }
  process.stdout.write(`verdict: ${report.verdict}  (${Object.entries(report.counts).map(([k, n]) => `${k}=${n}`).join(" ")})\n`);
  const nonPass = report.results.filter((x) => x.status !== "PASS");
  for (const r of nonPass.slice(0, 10)) {
    process.stdout.write(`  ${r.status} ${r.vector_id}: expected ${r.expected.decision}/${JSON.stringify(r.expected.version ?? null)}, got ${r.observed ? `${r.observed.decision}/${JSON.stringify(r.observed.version)}` : "no answer"}\n`);
  }
  if (nonPass.length > 10) process.stdout.write(`  ... ${nonPass.length - 10} more non-passing cases listed in the report\n`);
  if (report.template_not_connected) process.stdout.write("  hint: the template reader is not connected yet — edit classifyTransaction()\n");
  process.stdout.write(`report: ${out}  sha256 ${sha256(jsonBytes)}\n`);
  if (args.explain) process.stdout.write(`summary: ${args.explain}\n`);
  process.stdout.write("UNSIGNED; fixture evidence only (liveAcquisition:false)\n");
  process.exit(report.verdict === "ALL_MATCHED" ? 0 : 1);
}
