/**
 * Replay: verify report bindings then re-execute in clean isolation;
 * compare semantic outcomes (not volatile timestamps).
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { runConformance, loadProfile, loadCorpus, getTarget, computeDeterministicDigest } from "./runner.js";
import { isDeepStrictEqual } from "node:util";
import { fileSha256, sha256Hex } from "./digest.js";
import { TARGETS_DIR } from "./paths.js";

/**
 * Escaped-transcript size accounting (beside replay).
 *
 * Bounds the UTF-8 byte length of the JSON-serialized evidence string
 * (JSON.stringify), which expands under escaping — not only raw stream bytes.
 * Encoding: UTF-8. Thresholds intentionally allow modest expansion over the
 * runner's raw caps but reject pathological escaping blow-ups.
 *
 * Self-hashes / digests are consistency checks, not authentication of
 * attacker-controlled evidence.
 */
export const ESCAPED_STDOUT_LIMIT_BYTES = 3 * 256 * 1024; // 3× DEFAULT_MAX_STDOUT_BYTES
export const ESCAPED_STDERR_LIMIT_BYTES = 3 * 64 * 1024;  // 3× DEFAULT_MAX_STDERR_BYTES

/** UTF-8 byte length of JSON.stringify(value) — measures escaping expansion. */
export function serializedEvidenceBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

/**
 * Verify evidence transcripts are present, well-typed, and within escaped-size
 * limits. Does not claim digests authenticate evidence.
 */
export function checkEscapedTranscriptSizes(report) {
  const diffs = [];
  if (!report || typeof report !== "object") {
    return { ok: false, diffs: [{ field: "report", error: "invalid_report_structure" }] };
  }
  if (!Array.isArray(report.results)) {
    return { ok: false, diffs: [{ field: "results", error: "missing_results" }] };
  }
  for (let i = 0; i < report.results.length; i++) {
    const r = report.results[i];
    const e = r?.evidence;
    if (!e || typeof e !== "object") {
      diffs.push({ field: `results[${i}].evidence`, error: "malformed_evidence", vector_id: r?.vector_id });
      continue;
    }
    if (typeof e.stdout !== "string" || typeof e.stderr !== "string") {
      diffs.push({
        field: `results[${i}].evidence.transcript`,
        error: "transcript_not_string",
        vector_id: r?.vector_id,
      });
      continue;
    }
    const outBytes = serializedEvidenceBytes(e.stdout);
    const errBytes = serializedEvidenceBytes(e.stderr);
    if (outBytes > ESCAPED_STDOUT_LIMIT_BYTES) {
      diffs.push({
        field: `results[${i}].evidence.stdout`,
        error: "escaped_transcript_limit",
        vector_id: r?.vector_id,
        serialized_utf8_bytes: outBytes,
        limit: ESCAPED_STDOUT_LIMIT_BYTES,
        encoding: "utf8",
        representation: "JSON.stringify(stdout)",
      });
    }
    if (errBytes > ESCAPED_STDERR_LIMIT_BYTES) {
      diffs.push({
        field: `results[${i}].evidence.stderr`,
        error: "escaped_transcript_limit",
        vector_id: r?.vector_id,
        serialized_utf8_bytes: errBytes,
        limit: ESCAPED_STDERR_LIMIT_BYTES,
        encoding: "utf8",
        representation: "JSON.stringify(stderr)",
      });
    }
  }
  return {
    ok: diffs.length === 0,
    diffs,
    limits: {
      stdout_escaped_utf8_bytes: ESCAPED_STDOUT_LIMIT_BYTES,
      stderr_escaped_utf8_bytes: ESCAPED_STDERR_LIMIT_BYTES,
      encoding: "utf8",
      representation: "JSON.stringify(transcript)",
      note: "Bounds serialized evidence size (escaping expansion). Digest self-consistency is not attestation.",
    },
  };
}


export function loadReport(reportPath) {
  const abs = path.resolve(reportPath);
  if (!existsSync(abs)) throw new Error(`report_not_found:${abs}`);
  return { path: abs, data: JSON.parse(readFileSync(abs, "utf8")) };
}

export function checkBundleIdentities(report) {
  const diffs = [];
  const profileName = report.claimed_profile?.name;
  if (!profileName) {
    diffs.push({ field: "claimed_profile.name", error: "missing" });
    return { ok: false, diffs };
  }
  let profile;
  let corpus;
  try {
    profile = loadProfile(profileName);
    corpus = loadCorpus(profileName);
  } catch (error) {
    diffs.push({ field: "claimed_profile.name", error: error.code || String(error) });
    return { ok: false, diffs };
  }
  const targetId = report.target?.id;
  if (!targetId) {
    diffs.push({ field: "target.id", error: "missing" });
    return { ok: false, diffs };
  }
  const target = getTarget(targetId, profileName);
  const entryAbs = path.join(TARGETS_DIR, target.entry);
  const entryDigest = fileSha256(entryAbs);

  for (const [field, values, actual] of [
    ["profile_sha256", [report.binding?.profile_sha256, report.claimed_profile?.sha256], profile.digest],
    ["corpus_sha256", [report.binding?.corpus_sha256, report.corpus?.sha256, report.corpus?.declared_content_digest_sha256], corpus.digest],
    ["target_entry_sha256", [report.binding?.target_entry_sha256, report.target?.entry_sha256], entryDigest],
  ]) {
    if (values.some(value => value !== actual)) diffs.push({ field, expected: values, actual });
  }
  for (const [field, actual, expected] of [
    ["claimed_profile.name", report.claimed_profile?.name, profile.data.name],
    ["claimed_profile.version", report.claimed_profile?.version, profile.data.version],
    ["target.claimed_conformance_profile", report.target?.claimed_conformance_profile, profile.data.name],
    ["target.claimed_conformance_profile_version", report.target?.claimed_conformance_profile_version, profile.data.version],
    ["target.entry", report.target?.entry, target.entry],
    ["target.version", report.target?.version, target.version],
    ["corpus.id", report.corpus?.id, corpus.data.id],
    ["corpus.version", report.corpus?.version, corpus.data.version],
    ["corpus.vector_count", report.corpus?.vector_count, corpus.data.vectors.length],
  ]) if (actual !== expected) diffs.push({ field, expected, actual });
  return { ok: diffs.length === 0, diffs, profile, corpus, entryDigest, targetId, profileName };
}

export function checkReportIntegrity(report) {
  const diffs = [];
  try {
    const computed = computeDeterministicDigest(report);
    if (report.deterministic_report_sha256 !== computed || report.binding?.deterministic_report_sha256 !== computed)
      diffs.push({ field: "deterministic_report_sha256", error: "missing_or_mismatched_digest" });
    // Preserve the producer's documented full-body serialization (top-level digests are added afterward).
    const { _written_path, report_content_digest_sha256, deterministic_report_sha256, ...body } = report;
    if (report_content_digest_sha256 !== sha256Hex(JSON.stringify(body, null, 2) + "\n"))
      diffs.push({ field: "report_content_digest_sha256", error: "missing_or_mismatched_digest" });
  } catch {
    diffs.push({ field: "report", error: "invalid_report_structure" });
  }
  return { ok: diffs.length === 0, diffs };
}

function semanticSlice(report) {
  return {
    summary: report.summary,
    results: (report.results || []).map((r) => ({
      vector_id: r.vector_id,
      description: r.description,
      status: r.status,
      expected: r.expected,
      observed: {
        decision: r.observed?.decision ?? null,
        version: r.observed?.version ?? null,
        version_present: r.observed?.version_present ?? null,
        reason: r.observed?.reason ?? null,
        parseError: r.observed?.parseError ?? null,
        timedOut: r.observed?.timedOut ?? false,
        flooded: r.observed?.flooded ?? false,
      },
      exitCode: r.evidence?.exitCode ?? null,
    })),
  };
}

export function compareSemantic(original, replayed) {
  const a = semanticSlice(original), b = semanticSlice(replayed), diffs = [];
  if (!isDeepStrictEqual(a.summary, b.summary)) diffs.push({ field: "summary", error: "mismatch" });
  if (!Array.isArray(original.results) || !Array.isArray(replayed.results) || a.results.length !== b.results.length)
    diffs.push({ field: "results", error: "cardinality_mismatch" });
  const unique = rows => new Set(rows.map(r => r.vector_id)).size === rows.length;
  if (!unique(a.results) || !unique(b.results)) diffs.push({ field: "results", error: "duplicate_vector" });
  // Comparing the full ordered list makes omitted, added and reordered vectors visible.
  for (let i = 0; i < Math.max(a.results.length, b.results.length); i++) {
    if (!isDeepStrictEqual(a.results[i], b.results[i])) diffs.push({ field: `results[${i}]`, error: "semantic_mismatch" });
  }
  return { ok: diffs.length === 0, diffs };
}

/**
 * Replay a saved conformance report.
 */
export async function replayReport(reportPath, opts = {}) {
  const { data: original } = loadReport(reportPath);
  if (original.probe) {
    return {
      schema: "raven-conformance-replay/1",
      ok: false,
      bundle_match: false,
      semantic_match: false,
      error: "probe_reports_not_replayed_via_corpus_replay",
      diffs: [],
    };
  }

  const integrity = checkReportIntegrity(original);
  if (!integrity.ok) return {
    schema: "raven-conformance-replay/1", ok: false, bundle_match: false, semantic_match: false,
    error: "report_integrity_mismatch", diffs: integrity.diffs,
  };

  const transcripts = checkEscapedTranscriptSizes(original);
  if (!transcripts.ok) return {
    schema: "raven-conformance-replay/1",
    ok: false,
    bundle_match: false,
    semantic_match: false,
    error: "escaped_transcript_limit",
    diffs: transcripts.diffs,
    transcript_limits: transcripts.limits,
    attestation: false,
    note: "Escaped-transcript size check failed. Digests do not authenticate attacker-controlled evidence.",
  };

  const bundle = checkBundleIdentities(original);
  if (!bundle.ok) {
    return {
      schema: "raven-conformance-replay/1",
      ok: false,
      bundle_match: false,
      semantic_match: false,
      original_binding: original.binding || null,
      diffs: bundle.diffs,
      error: "bundle_identity_mismatch",
    };
  }

  const replayed = await runConformance(bundle.targetId, {
    profile: bundle.profileName,
    write: opts.write === true,
    timeoutMs: opts.timeoutMs,
  });

  const sem = compareSemantic(original, replayed);
  return {
    schema: "raven-conformance-replay/1",
    ok: bundle.ok && sem.ok,
    bundle_match: bundle.ok,
    semantic_match: sem.ok,
    escaped_transcript_ok: true,
    attestation: false,
    original_binding: original.binding || {
      profile_sha256: original.claimed_profile?.sha256,
      corpus_sha256: original.corpus?.sha256,
      target_entry_sha256: original.target?.entry_sha256,
    },
    replay_binding: replayed.binding,
    original_overall: original.summary?.overall,
    replay_overall: replayed.summary?.overall,
    original_deterministic_sha256: original.deterministic_report_sha256 || null,
    replay_deterministic_sha256: replayed.deterministic_report_sha256 || null,
    diffs: sem.diffs,
    isolation_replay: replayed.isolation,
  };
}
