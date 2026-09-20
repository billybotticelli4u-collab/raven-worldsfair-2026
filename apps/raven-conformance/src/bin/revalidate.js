#!/usr/bin/env node
/**
 * Local Conformance revalidation CLI.
 *
 * Usage:
 *   npm run revalidate -- --baseline CONFORMANT_REFERENCE --proposed BROKEN_SUBTLE
 *   npm run revalidate -- --baseline-report reports/<run>.json --proposed ./fixtures/revalidate/subject_pass.mjs
 *
 * Fail-closed: missing/tampered --baseline-report → exit 2 (never manufactures success).
 * Regressions / incomparable / mixed → exit 1. Unchanged / improved → exit 0.
 *
 * Probabilistic: preserves trial reports; does not promise identical re-runs.
 */
import { revalidate, APPROVED_DEMO_IDS } from "../lib/revalidate.js";

function parseArgs(argv) {
  const out = {
    baseline: null,
    proposed: null,
    baselineReportPath: null,
    outDir: null,
    sessionId: null,
    json: false,
    help: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--baseline" || a === "-b") out.baseline = argv[++i];
    else if (a === "--proposed" || a === "-p") out.proposed = argv[++i];
    else if (a === "--baseline-report") out.baselineReportPath = argv[++i];
    else if (a === "--out-dir") out.outDir = argv[++i];
    else if (a === "--session-id") out.sessionId = argv[++i];
    else if (a === "--json") out.json = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else {
      console.error("Unknown argument:", a);
      out.help = true;
    }
  }
  return out;
}

const args = parseArgs(process.argv);
if (args.help || !args.proposed || (!args.baseline && !args.baselineReportPath)) {
  console.log(`raven-conformance revalidate

Re-run the SAME approved Conformance suite for baseline vs proposed targets.
Keeps both immutable reports and emits comparison (improvements / regressions /
unchanged / incomparable). Reuses runConformance — no second evaluator.

Usage:
  npm run revalidate -- --baseline <id|path> --proposed <id|path>
  npm run revalidate -- --baseline-report <report.json> --proposed <id|path>
  npm run revalidate -- --baseline <id|path> --proposed <id|path> --json
  npm run revalidate -- --baseline <id|path> --proposed <id|path> --out-dir <dir>

Approved demo target ids: ${[...APPROVED_DEMO_IDS].join(" | ")}

Exit codes:
  0  UNCHANGED / IMPROVED / UNCHANGED_WITH_INCOMPARABLE
  1  REGRESSED / MIXED / INCOMPARABLE
  2  missing/tampered baseline report or usage/identity failure (fail-closed)

Probabilistic note: trial reports are preserved; identical re-runs are not promised.
`);
  process.exit(args.help ? 0 : 2);
}

try {
  const result = await revalidate({
    baseline: args.baseline,
    proposed: args.proposed,
    baselineReportPath: args.baselineReportPath,
    outDir: args.outDir,
    sessionId: args.sessionId,
  });
  if (args.json) {
    console.log(
      JSON.stringify(
        {
          session_id: result.session_id,
          verdict: result.comparison.verdict,
          counts: result.comparison.counts,
          overall: result.comparison.overall,
          evidence_dir: result.outDir,
          comparison_json: result.comparisonJsonPath,
          comparison_txt: result.comparisonTxtPath,
          baseline_run_id: result.baselineReport.run_id,
          proposed_run_id: result.proposedReport.run_id,
          baseline_deterministic_sha256: result.baselineReport.deterministic_report_sha256,
          proposed_deterministic_sha256: result.proposedReport.deterministic_report_sha256,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(result.summaryText);
    console.log("\nWrote " + result.comparisonJsonPath);
    console.log("Wrote " + result.comparisonTxtPath);
  }
  process.exit(result.exitCode);
} catch (err) {
  const code = err?.code || "";
  console.error("revalidate failed:", err?.message || err);
  process.exit(2);
}
