/**
 * UI display adapter over raven-conformance-report/1 (Challenge 1 taxonomy).
 * Does NOT recalculate verdicts or re-run vectors.
 */
export const DISPLAY_KINDS = Object.freeze({
  PASS: "PASS",
  BEHAVIORAL_DIVERGENCE: "BEHAVIORAL_DIVERGENCE",
  TIMEOUT: "TIMEOUT",
  TARGET_CRASH: "TARGET_CRASH",
  INVALID_OUTPUT: "INVALID_OUTPUT",
  OUTPUT_FLOOD: "OUTPUT_FLOOD",
  SKIPPED_VECTOR: "SKIPPED_VECTOR",
  RUNNER_FAILURE: "RUNNER_FAILURE",
  BOUNDARY_ESCAPE: "BOUNDARY_ESCAPE",
  BOUNDARY_HOLD: "BOUNDARY_HOLD",
  INCOMPLETE: "INCOMPLETE",
  UNVERIFIED: "UNVERIFIED",
});

const PLAIN = {
  PASS: "Observed decision matches the corpus expectation for this vector.",
  BEHAVIORAL_DIVERGENCE: "Expectation mismatch only — not a security score.",
  TIMEOUT: "Target did not finish within the runner timeout — not treated as PASS.",
  TARGET_CRASH: "Target exited unsuccessfully or was terminated, even if it emitted a usable decision — not treated as PASS.",
  INVALID_OUTPUT: "Target stdout unparseable or missing decision — not treated as PASS.",
  OUTPUT_FLOOD: "Target exceeded output byte caps — not treated as PASS.",
  SKIPPED_VECTOR: "Vector was skipped — not a behavioral PASS.",
  RUNNER_FAILURE: "Runner/isolation setup failed — not treated as PASS.",
  BOUNDARY_ESCAPE: "Probe boundary escape (not a conformance demo).",
  BOUNDARY_HOLD: "Probe boundary hold (not a conformance demo).",
  INCOMPLETE: "Run interrupted — incomplete; not labeled PASS.",
  UNVERIFIED: "Unrecognized status — not labeled PASS.",
};

export function classifyResult(result) {
  if (!result || typeof result !== "object") {
    return { kind: "UNVERIFIED", label: "UNVERIFIED", engineStatus: null, plainLanguage: PLAIN.UNVERIFIED };
  }
  let engineStatus = result.status ?? null;
  if (engineStatus === "DIVERGENCE") engineStatus = "BEHAVIORAL_DIVERGENCE";
  if (engineStatus === "BEHAVIORAL_DIVERGENCE" || !engineStatus) {
    if (result.observed?.timedOut || result.evidence?.timedOut) engineStatus = "TIMEOUT";
    else if (result.observed?.flooded || result.evidence?.flooded) engineStatus = "OUTPUT_FLOOD";
    else if (result.observed?.parseError || result.evidence?.parseError) engineStatus = "INVALID_OUTPUT";
  }
  const kind = DISPLAY_KINDS[engineStatus] || "UNVERIFIED";
  const label = kind === "BEHAVIORAL_DIVERGENCE" ? "DIVERGENCE" : kind;
  let plain = PLAIN[kind] || PLAIN.UNVERIFIED;
  if (kind === "BEHAVIORAL_DIVERGENCE") {
    plain = `Target returned ${result.observed?.decision ?? "null"} but corpus expected ${result.expected?.decision ?? "?"}. ${PLAIN.BEHAVIORAL_DIVERGENCE}`;
  }
  return { kind, label, engineStatus: result.status ?? engineStatus, plainLanguage: plain };
}

export function summarizeDisplay(results, engineCounts = null) {
  const counts = {
    pass: 0, behavioral_divergence: 0, timeout: 0, target_crash: 0, invalid_output: 0,
    output_flood: 0, skipped: 0, runner_failure: 0, incomplete: 0, boundary_escape: 0,
    boundary_hold: 0, unverified: 0,
  };
  const classified = [];
  const map = {
    PASS: "pass", BEHAVIORAL_DIVERGENCE: "behavioral_divergence", TIMEOUT: "timeout",
    TARGET_CRASH: "target_crash", INVALID_OUTPUT: "invalid_output", OUTPUT_FLOOD: "output_flood",
    SKIPPED_VECTOR: "skipped", RUNNER_FAILURE: "runner_failure", INCOMPLETE: "incomplete",
    BOUNDARY_ESCAPE: "boundary_escape", BOUNDARY_HOLD: "boundary_hold",
  };
  for (const r of results || []) {
    const c = classifyResult(r);
    classified.push({ ...r, display: c });
    counts[map[c.kind] || "unverified"] += 1;
  }
  return { counts, classified, engineCounts };
}

export function firstMeaningfulIssue(classified) {
  const order = ["BEHAVIORAL_DIVERGENCE","TIMEOUT","TARGET_CRASH","INVALID_OUTPUT","OUTPUT_FLOOD","RUNNER_FAILURE","INCOMPLETE","BOUNDARY_ESCAPE","SKIPPED_VECTOR","UNVERIFIED"];
  for (const kind of order) {
    const hit = (classified || []).find((r) => r.display?.kind === kind);
    if (hit) return hit;
  }
  return null;
}

export function relatedRequirement(profile, result) {
  const rules = Array.isArray(profile?.rules) ? profile.rules : [];
  const hay = `${result?.vector_id || ""} ${result?.description || ""}`.toLowerCase();
  let best = { rule: profile?.claimed_conformance_meaning || rules[0] || "See claimed profile rules.", score: 0 };
  for (const rule of rules) {
    let score = 0;
    const low = rule.toLowerCase();
    for (const w of low.split(/[^a-z0-9]+/).filter((x) => x.length > 3)) if (hay.includes(w)) score += 1;
    if (/unexpected|top-level|field/.test(hay) && /unexpected|top-level|field/.test(low)) score += 5;
    if (/digest/.test(hay) && /digest/.test(low)) score += 5;
    if (/schema/.test(hay) && /schema/.test(low)) score += 5;
    if (score > best.score) best = { rule, score };
  }
  return best.rule;
}

export function validateReport(report) {
  if (!report || typeof report !== "object") return { ok: false, reason: "missing_report" };
  if (report.schema !== "raven-conformance-report/1") return { ok: false, reason: "unsupported_schema" };
  if (!report.summary || typeof report.summary !== "object") return { ok: false, reason: "missing_summary" };
  if (!Array.isArray(report.results)) return { ok: false, reason: "missing_results" };
  return { ok: true, reason: null };
}

export function adaptReport(report, profile = null) {
  const validation = validateReport(report);
  if (!validation.ok) return { ok: false, reason: validation.reason, engine: report || null, display: null };
  const { counts, classified } = summarizeDisplay(report.results, report.summary?.counts || null);
  const issue = firstMeaningfulIssue(classified);
  const withReq = classified.map((r) => ({ ...r, related_requirement: relatedRequirement(profile, r) }));
  const executionErrorKinds = new Set(["TIMEOUT","TARGET_CRASH","INVALID_OUTPUT","OUTPUT_FLOOD","RUNNER_FAILURE","INCOMPLETE"]);
  const execution_error_vector_ids = report.summary?.execution_error_vector_ids
    || withReq.filter((r) => executionErrorKinds.has(r.display?.kind)).map((r) => r.vector_id);
  const behavioral_divergence_vector_ids = report.summary?.behavioral_divergence_vector_ids
    || withReq.filter((r) => r.display?.kind === "BEHAVIORAL_DIVERGENCE").map((r) => r.vector_id);
  const skipped_vector_ids = report.summary?.skipped_vector_ids
    || withReq.filter((r) => r.display?.kind === "SKIPPED_VECTOR").map((r) => r.vector_id);
  const nonPass = counts.behavioral_divergence + counts.timeout + counts.target_crash + counts.invalid_output + counts.output_flood + counts.runner_failure + counts.incomplete;
  const all_error = Boolean(report.summary?.all_execution_errors)
    || (nonPass > 0 && counts.pass === 0 && counts.behavioral_divergence === 0 && nonPass === report.results.length - counts.skipped);
  const mixed = Boolean(report.summary?.mixed_execution_and_behavioral)
    || (execution_error_vector_ids.length > 0 && behavioral_divergence_vector_ids.length > 0);
  let presentation_banner = null;
  if (report.results.length === 0 || report.summary?.empty_result_set) {
    presentation_banner = "EMPTY RESULT SET — not labeled PASS.";
  } else if (all_error) {
    presentation_banner = `ALL EXECUTION FAILURES — affected vectors: ${execution_error_vector_ids.join(", ") || "(none listed)"}. Not behavioral mismatches; never PASS.`;
  } else if (mixed) {
    presentation_banner = `MIXED run — execution errors [${execution_error_vector_ids.join(", ")}] vs behavioral mismatches [${behavioral_divergence_vector_ids.join(", ")}].`;
  } else if (skipped_vector_ids.length && counts.pass + counts.skipped === report.results.length) {
    presentation_banner = `Skipped vectors present: ${skipped_vector_ids.join(", ")} — skips are not behavioral PASS credit beyond remaining PASS rows.`;
  }
  return {
    ok: true, reason: null, engine: report,
    display: {
      counts, engine_counts: report.summary?.counts || null, results: withReq,
      first_issue: issue ? { ...issue, related_requirement: relatedRequirement(profile, issue) } : null,
      empty: report.results.length === 0,
      all_error,
      mixed_execution_and_behavioral: mixed,
      execution_error_vector_ids,
      behavioral_divergence_vector_ids,
      skipped_vector_ids,
      presentation_banner,
      overall_engine: report.summary?.overall || null,
      isolation: report.isolation || null,
    },
  };
}
