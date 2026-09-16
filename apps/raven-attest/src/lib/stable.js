/**
 * Deterministic / variable partition of a conformance report.
 *
 * MEASURED FACT this exists to fix: two honest `npm run conform -- --target
 * CONFORMANT_REFERENCE` runs over byte-identical inputs produce DIFFERENT
 * report_content_digest_sha256 values, because that digest covers run_id,
 * started_at, finished_at and per-vector durationMs. The engine's report digest
 * therefore detects post-hoc edits to one report file; it can never be used to
 * compare two runs.
 *
 * conformanceCoreDigest() covers only content that MUST be byte-identical for
 * the same (target, profile, corpus) on any host. It deliberately excludes the
 * environment block, which is stable per host but varies across hosts.
 */
import { createHash } from "node:crypto";

export const VARIABLE_FIELDS = [
  "run_id",
  "started_at",
  "finished_at",
  "report_content_digest_sha256",
  "_written_path",
  "results[].evidence.durationMs",
];

export const HOST_DEPENDENT_FIELDS = [
  "environment.node",
  "environment.platform",
  "environment.arch",
  "environment.os",
];

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortKeys(value[key]);
    return out;
  }
  return value;
}

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** The subset of a report that must reproduce byte-for-byte on any host. */
export function conformanceCore(report) {
  return {
    schema: report.schema,
    product: report.product,
    build_stage_note: report.build_stage_note,
    target: report.target,
    claimed_profile: report.claimed_profile,
    corpus: report.corpus,
    allowed_resources: report.allowed_resources,
    summary: report.summary,
    divergence_definition: report.divergence_definition,
    limitations: report.limitations,
    reproduction: report.reproduction,
    results: (report.results || []).map((r) => ({
      vector_id: r.vector_id,
      description: r.description,
      expected: r.expected,
      observed: r.observed,
      status: r.status,
      evidence: {
        stdout: r.evidence?.stdout ?? null,
        stderr: r.evidence?.stderr ?? null,
        exitCode: r.evidence?.exitCode ?? null,
      },
    })),
  };
}

export function conformanceCoreDigest(report) {
  return sha256(JSON.stringify(sortKeys(conformanceCore(report))));
}

export function environmentDigest(report) {
  return sha256(JSON.stringify(sortKeys(report.environment ?? null)));
}
