/**
 * Local Conformance revalidation.
 * Re-runs the SAME approved suite (runConformance) for baseline vs proposed,
 * keeps both immutable reports, emits comparison. No second evaluator.
 * Registered target ids only — no filesystem path mode (CLAUDE-066).
 *
 * Probabilistic note: preserves trials; does not promise identical re-runs.
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  statSync,
} from "node:fs";
import path from "node:path";
import {
  runConformance,
  computeDeterministicDigest,
  loadProfile,
  loadCorpus,
  getTarget,
  loadDemoTargets,
} from "./runner.js";
import { APP_ROOT, REPORTS_DIR } from "./paths.js";

const PASS_STATUSES = new Set(["PASS"]);
const UNMEASURED_STATUSES = new Set([
  "INCOMPLETE",
  "RUNNER_FAILURE",
  "SKIPPED_VECTOR",
  "SKIPPED",
]);

export const APPROVED_DEMO_IDS = new Set(loadDemoTargets().map((t) => t.id));

export function sha256Hex(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

export function fileSha256(p) {
  return sha256Hex(readFileSync(p));
}

/**
 * Revalidate accepts registered target ids only (D1 pattern).
 * Path-like args are refused — register in targets/manifests.json first.
 */
function looksLikePath(s) {
  if (!s || typeof s !== "string") return false;
  if (path.isAbsolute(s)) return true;
  if (s.includes("/") || s.includes("\\")) return true;
  if (/\.(mjs|cjs|js|ts|mts|cts)$/i.test(s)) return true;
  try {
    if (existsSync(s) && statSync(s).isFile()) return true;
  } catch {
    /* ignore */
  }
  return false;
}

export function resolveTargetRef(ref) {
  if (!ref || typeof ref !== "string") {
    throw Object.assign(new Error("missing_target_ref"), { code: "MISSING_TARGET_REF" });
  }
  if (looksLikePath(ref)) {
    throw Object.assign(
      new Error(
        "TARGET_NOT_REGISTERED: " +
          JSON.stringify(ref) +
          " looks like a filesystem path. Revalidate accepts registered target ids only. " +
          "Register the target in targets/manifests.json (D1 pattern) before revalidate.",
      ),
      { code: "TARGET_NOT_REGISTERED" },
    );
  }
  let t;
  try {
    t = getTarget(ref);
  } catch (err) {
    throw Object.assign(
      new Error(
        "TARGET_NOT_REGISTERED: " +
          JSON.stringify(ref) +
          " is not a registered target id. " +
          "Register the target in targets/manifests.json (D1 pattern) before revalidate.",
      ),
      { code: "TARGET_NOT_REGISTERED", cause: err },
    );
  }
  return {
    kind: "id",
    id: t.id,
    entryAbs: null,
    display: t.id,
    approved_demo: APPROVED_DEMO_IDS.has(t.id),
  };
}

export function collectRunIdentity({ targetRef, report }) {
  const pkgPath = path.join(APP_ROOT, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const lockPath = path.join(APP_ROOT, "package-lock.json");
  const runnerPath = path.join(APP_ROOT, "src/lib/runner.js");
  const revalidatePath = path.join(APP_ROOT, "src/lib/revalidate.js");
  const profile = loadProfile();
  const corpus = loadCorpus();

  return {
    recorded_at: new Date().toISOString(),
    target: {
      ref: targetRef.display,
      kind: targetRef.kind,
      id: report?.target?.id || targetRef.id,
      entry_sha256: report?.target?.entry_sha256 || null,
    },
    code_artifact: {
      runner_js_sha256: fileSha256(runnerPath),
      revalidate_js_sha256: fileSha256(revalidatePath),
      package_name: pkg.name,
      package_version: pkg.version,
      package_json_sha256: fileSha256(pkgPath),
      package_lock_sha256: existsSync(lockPath) ? fileSha256(lockPath) : null,
      package_lock_present: existsSync(lockPath),
    },
    harness: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      evaluator: "apps/raven-conformance/src/lib/runner.js#runConformance",
      revalidator: "apps/raven-conformance/src/lib/revalidate.js",
    },
    pins: {
      profile_name: profile.data.name,
      profile_version: profile.data.version,
      profile_sha256: profile.digest,
      corpus_id: corpus.data.id,
      corpus_version: corpus.data.version,
      corpus_sha256: corpus.digest,
      corpus_frozen_note: "Corpus 0 remains frozen; revalidate does not mutate corpus.",
    },
    report_binding: report?.binding || null,
    report_run_id: report?.run_id || null,
    report_deterministic_sha256: report?.deterministic_report_sha256 || null,
    report_content_digest_sha256: report?.report_content_digest_sha256 || null,
    probabilistic_note:
      "Preserves trials. Does not promise identical re-runs under nondeterministic isolation or targets.",
  };
}

/**
 * Fail-closed load of a prior immutable baseline report.
 * Never manufactures success when missing or tampered.
 */
export function loadBaselineReport(reportPath) {
  if (!reportPath) {
    throw Object.assign(new Error("BASELINE_REPORT_MISSING"), { code: "BASELINE_REPORT_MISSING" });
  }
  const abs = path.resolve(reportPath);
  if (!existsSync(abs) || !statSync(abs).isFile()) {
    throw Object.assign(new Error("BASELINE_REPORT_MISSING:" + abs), {
      code: "BASELINE_REPORT_MISSING",
    });
  }
  let report;
  try {
    report = JSON.parse(readFileSync(abs, "utf8"));
  } catch (e) {
    throw Object.assign(new Error("BASELINE_REPORT_UNPARSEABLE:" + abs), {
      code: "BASELINE_REPORT_TAMPERED",
      cause: e,
    });
  }
  if (!report || typeof report !== "object" || !Array.isArray(report.results)) {
    throw Object.assign(new Error("BASELINE_REPORT_INVALID_SHAPE:" + abs), {
      code: "BASELINE_REPORT_TAMPERED",
    });
  }
  const claimed = report.deterministic_report_sha256;
  if (!claimed || typeof claimed !== "string") {
    throw Object.assign(new Error("BASELINE_REPORT_MISSING_DETERMINISTIC_DIGEST:" + abs), {
      code: "BASELINE_REPORT_TAMPERED",
    });
  }
  let computed;
  try {
    computed = computeDeterministicDigest(report);
  } catch (e) {
    throw Object.assign(new Error("BASELINE_REPORT_DIGEST_COMPUTE_FAILED:" + abs), {
      code: "BASELINE_REPORT_TAMPERED",
      cause: e,
    });
  }
  if (computed !== claimed) {
    throw Object.assign(
      new Error(
        "BASELINE_REPORT_TAMPERED:deterministic_mismatch claimed=" +
          claimed +
          " computed=" +
          computed,
      ),
      { code: "BASELINE_REPORT_TAMPERED", claimed, computed },
    );
  }
  if (
    report.binding?.deterministic_report_sha256 &&
    report.binding.deterministic_report_sha256 !== claimed
  ) {
    throw Object.assign(new Error("BASELINE_REPORT_TAMPERED:binding_digest_mismatch"), {
      code: "BASELINE_REPORT_TAMPERED",
    });
  }
  return { report, path: abs, deterministic_report_sha256: claimed };
}

export function compareReports(baselineReport, proposedReport) {
  const improvements = [];
  const regressions = [];
  const unchanged = [];
  const incomparable = [];

  const baseCorpus = baselineReport.corpus?.sha256 || null;
  const propCorpus = proposedReport.corpus?.sha256 || null;
  const baseProfile = baselineReport.claimed_profile?.sha256 || null;
  const propProfile = proposedReport.claimed_profile?.sha256 || null;

  const suiteComparable =
    Boolean(baseCorpus) &&
    Boolean(propCorpus) &&
    baseCorpus === propCorpus &&
    Boolean(baseProfile) &&
    Boolean(propProfile) &&
    baseProfile === propProfile;

  if (!suiteComparable) {
    incomparable.push({
      scope: "suite",
      reason: "corpus_or_profile_pin_mismatch_or_missing",
      baseline: { corpus: baseCorpus, profile: baseProfile },
      proposed: { corpus: propCorpus, profile: propProfile },
    });
  }

  const baseById = new Map((baselineReport.results || []).map((r) => [r.vector_id, r]));
  const propById = new Map((proposedReport.results || []).map((r) => [r.vector_id, r]));
  const allIds = new Set([...baseById.keys(), ...propById.keys()]);

  for (const id of [...allIds].sort()) {
    const b = baseById.get(id);
    const p = propById.get(id);
    if (!b || !p) {
      incomparable.push({
        vector_id: id,
        reason: !b ? "missing_in_baseline" : "missing_in_proposed",
        baseline_status: b?.status ?? null,
        proposed_status: p?.status ?? null,
      });
      continue;
    }
    if (!suiteComparable) {
      incomparable.push({
        vector_id: id,
        reason: "suite_pins_incomparable",
        baseline_status: b.status,
        proposed_status: p.status,
      });
      continue;
    }
    if (UNMEASURED_STATUSES.has(b.status) || UNMEASURED_STATUSES.has(p.status)) {
      incomparable.push({
        vector_id: id,
        reason: "unmeasured_or_incomplete",
        baseline_status: b.status,
        proposed_status: p.status,
      });
      continue;
    }

    const bPass = PASS_STATUSES.has(b.status);
    const pPass = PASS_STATUSES.has(p.status);

    if (bPass && pPass) {
      unchanged.push({
        vector_id: id,
        baseline_status: b.status,
        proposed_status: p.status,
        note: "both_pass",
      });
    } else if (!bPass && pPass) {
      improvements.push({
        vector_id: id,
        baseline_status: b.status,
        proposed_status: p.status,
      });
    } else if (bPass && !pPass) {
      regressions.push({
        vector_id: id,
        baseline_status: b.status,
        proposed_status: p.status,
      });
    } else if (b.status === p.status) {
      unchanged.push({
        vector_id: id,
        baseline_status: b.status,
        proposed_status: p.status,
        note: "both_non_pass_same_status",
      });
    } else {
      incomparable.push({
        vector_id: id,
        reason: "non_pass_status_changed_without_pass_polarity",
        baseline_status: b.status,
        proposed_status: p.status,
      });
    }
  }

  const overall = {
    baseline: baselineReport.summary?.overall ?? null,
    proposed: proposedReport.summary?.overall ?? null,
  };

  let verdict = "UNCHANGED";
  if (!suiteComparable) verdict = "INCOMPARABLE";
  else if (regressions.length > 0 && improvements.length > 0) verdict = "MIXED";
  else if (regressions.length > 0) verdict = "REGRESSED";
  else if (improvements.length > 0) verdict = "IMPROVED";
  else if (incomparable.some((x) => x.vector_id)) verdict = "UNCHANGED_WITH_INCOMPARABLE";
  else verdict = "UNCHANGED";

  return {
    schema: "raven-conformance-revalidate-comparison/1",
    verdict,
    overall,
    counts: {
      improvements: improvements.length,
      regressions: regressions.length,
      unchanged: unchanged.length,
      incomparable: incomparable.length,
    },
    improvements,
    regressions,
    unchanged,
    incomparable,
    probabilistic_note:
      "Comparison is per preserved trial reports. No guarantee that a fresh re-run yields identical vector statuses.",
  };
}

export async function executeTarget(targetRef, { runIdPrefix = "reval" } = {}) {
  if (targetRef.kind !== "id") {
    throw Object.assign(
      new Error("TARGET_NOT_REGISTERED: executeTarget requires a registered id ref"),
      { code: "TARGET_NOT_REGISTERED" },
    );
  }
  const suffix = sha256Hex(targetRef.display).slice(0, 8);
  const runId = runIdPrefix + "_" + Date.now().toString(36) + "_" + suffix;
  return runConformance(targetRef.id, { write: true, runId });
}

export function formatComparisonText(comparison, { baselinePath, proposedPath, sessionDir } = {}) {
  const lines = [];
  lines.push("Raven Conformance — local revalidation comparison");
  lines.push("Verdict: " + comparison.verdict);
  lines.push(
    "Overall: baseline=" +
      comparison.overall.baseline +
      " → proposed=" +
      comparison.overall.proposed,
  );
  lines.push(
    "Counts: improvements=" +
      comparison.counts.improvements +
      " regressions=" +
      comparison.counts.regressions +
      " unchanged=" +
      comparison.counts.unchanged +
      " incomparable=" +
      comparison.counts.incomparable,
  );
  if (baselinePath) lines.push("Baseline report: " + baselinePath);
  if (proposedPath) lines.push("Proposed report: " + proposedPath);
  if (sessionDir) lines.push("Session evidence: " + sessionDir);
  lines.push("");
  const show = (title, rows, pick) => {
    lines.push("## " + title + " (" + rows.length + ")");
    if (rows.length === 0) lines.push("(none)");
    else for (const r of rows.slice(0, 50)) lines.push("- " + pick(r));
    if (rows.length > 50) lines.push("... " + (rows.length - 50) + " more");
    lines.push("");
  };
  show(
    "Improvements",
    comparison.improvements,
    (r) => r.vector_id + ": " + r.baseline_status + " → " + r.proposed_status,
  );
  show(
    "Regressions",
    comparison.regressions,
    (r) => r.vector_id + ": " + r.baseline_status + " → " + r.proposed_status,
  );
  show("Unchanged", comparison.unchanged, (r) => r.vector_id + ": " + r.baseline_status);
  show("Incomparable / unmeasured", comparison.incomparable, (r) =>
    r.vector_id
      ? r.vector_id + ": " + r.reason + " (" + r.baseline_status + " / " + r.proposed_status + ")"
      : (r.scope || "suite") + ": " + r.reason,
  );
  lines.push(comparison.probabilistic_note);
  return lines.join("\n");
}

/**
 * Full revalidation session.
 */
export async function revalidate(args) {
  const proposedRef = resolveTargetRef(args.proposed);
  let baselineReport;
  let baselinePath;
  let baselineIdentity;
  let baselineRef = null;

  const sessionId =
    args.sessionId ||
    "reval_" +
      new Date().toISOString().replace(/[:.]/g, "-") +
      "_" +
      sha256Hex(String(args.proposed)).slice(0, 6);
  const outDir = path.resolve(
    args.outDir || path.join(APP_ROOT, "evidence", "revalidate", sessionId),
  );
  mkdirSync(outDir, { recursive: true });

  if (args.baselineReportPath) {
    const loaded = loadBaselineReport(args.baselineReportPath);
    baselineReport = loaded.report;
    baselinePath = loaded.path;
    const dest = path.join(outDir, "baseline_" + baselineReport.run_id + ".json");
    if (path.resolve(dest) !== path.resolve(baselinePath)) {
      copyFileSync(baselinePath, dest);
      baselinePath = dest;
    }
    baselineIdentity = collectRunIdentity({
      targetRef: {
        kind: "report",
        id: baselineReport.target?.id || "baseline",
        display: args.baselineReportPath,
      },
      report: baselineReport,
    });
  } else {
    if (!args.baseline) {
      throw Object.assign(new Error("BASELINE_REQUIRED"), { code: "BASELINE_REQUIRED" });
    }
    baselineRef = resolveTargetRef(args.baseline);
    baselineReport = await executeTarget(baselineRef, { runIdPrefix: "baseline" });
    baselinePath = baselineReport._written_path;
    if (!baselinePath) {
      throw Object.assign(new Error("BASELINE_WRITE_FAILED"), { code: "BASELINE_WRITE_FAILED" });
    }
    const dest = path.join(outDir, "baseline_" + baselineReport.run_id + ".json");
    copyFileSync(baselinePath, dest);
    baselinePath = dest;
    baselineIdentity = collectRunIdentity({ targetRef: baselineRef, report: baselineReport });
  }

  const proposedReport = await executeTarget(proposedRef, { runIdPrefix: "proposed" });
  const proposedWritten = proposedReport._written_path;
  if (!proposedWritten) {
    throw Object.assign(new Error("PROPOSED_WRITE_FAILED"), { code: "PROPOSED_WRITE_FAILED" });
  }
  const proposedDest = path.join(outDir, "proposed_" + proposedReport.run_id + ".json");
  copyFileSync(proposedWritten, proposedDest);
  const proposedIdentity = collectRunIdentity({ targetRef: proposedRef, report: proposedReport });

  const comparison = compareReports(baselineReport, proposedReport);
  const comparisonDoc = {
    schema: "raven-conformance-revalidate-session/1",
    session_id: sessionId,
    created_at: new Date().toISOString(),
    baseline: {
      ref: baselineRef?.display || args.baselineReportPath,
      report_path: baselinePath,
      run_id: baselineReport.run_id,
      overall: baselineReport.summary?.overall,
      deterministic_report_sha256: baselineReport.deterministic_report_sha256,
      identity: baselineIdentity,
    },
    proposed: {
      ref: proposedRef.display,
      report_path: proposedDest,
      run_id: proposedReport.run_id,
      overall: proposedReport.summary?.overall,
      deterministic_report_sha256: proposedReport.deterministic_report_sha256,
      identity: proposedIdentity,
    },
    comparison,
    reports_dir: REPORTS_DIR,
    evidence_dir: outDir,
    notes: [
      "Both reports retain unique run_id filenames; prior failure reports are never overwritten by later passes.",
      "Evaluator is runConformance only — no second scoring engine.",
      "Corpus 0 frozen; pins recorded in identity.",
      "Probabilistic: trial reports are preserved; identical re-runs are not promised.",
    ],
  };

  const comparisonJsonPath = path.join(outDir, "comparison.json");
  const comparisonTxtPath = path.join(outDir, "comparison.txt");
  writeFileSync(comparisonJsonPath, JSON.stringify(comparisonDoc, null, 2) + "\n");
  const summaryText = formatComparisonText(comparison, {
    baselinePath,
    proposedPath: proposedDest,
    sessionDir: outDir,
  });
  writeFileSync(comparisonTxtPath, summaryText + "\n");

  const failVerdicts = new Set(["REGRESSED", "INCOMPARABLE", "MIXED"]);
  return {
    session_id: sessionId,
    outDir,
    comparisonJsonPath,
    comparisonTxtPath,
    comparison,
    baselineReport,
    proposedReport,
    summaryText,
    exitCode: failVerdicts.has(comparison.verdict) ? 1 : 0,
  };
}
