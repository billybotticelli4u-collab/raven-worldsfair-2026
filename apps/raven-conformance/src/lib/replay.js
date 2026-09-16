/**
 * Replay: verify report bindings then re-execute in clean isolation;
 * compare semantic outcomes (not volatile timestamps).
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { runConformance, loadProfile, loadCorpus, getTarget } from "./runner.js";
import { fileSha256 } from "./digest.js";
import { TARGETS_DIR } from "./paths.js";

export function loadReport(reportPath) {
  const abs = path.resolve(reportPath);
  if (!existsSync(abs)) throw new Error(`report_not_found:${abs}`);
  return { path: abs, data: JSON.parse(readFileSync(abs, "utf8")) };
}

export function checkBundleIdentities(report) {
  const diffs = [];
  const profile = loadProfile();
  const corpus = loadCorpus();
  const targetId = report.target?.id;
  if (!targetId) {
    diffs.push({ field: "target.id", error: "missing" });
    return { ok: false, diffs };
  }
  let target;
  try {
    target = getTarget(targetId);
  } catch {
    diffs.push({ field: "target.id", expected: targetId, error: "unknown_target" });
    return { ok: false, diffs };
  }
  const entryAbs = path.join(TARGETS_DIR, target.entry);
  const entryDigest = fileSha256(entryAbs);

  const expectedProfile = report.binding?.profile_sha256 || report.claimed_profile?.sha256;
  const expectedCorpus = report.binding?.corpus_sha256 || report.corpus?.sha256;
  const expectedTarget = report.binding?.target_entry_sha256 || report.target?.entry_sha256;

  if (expectedProfile && expectedProfile !== profile.digest) {
    diffs.push({
      field: "profile_sha256",
      expected: expectedProfile,
      actual: profile.digest,
    });
  }
  if (expectedCorpus && expectedCorpus !== corpus.digest) {
    diffs.push({
      field: "corpus_sha256",
      expected: expectedCorpus,
      actual: corpus.digest,
    });
  }
  if (expectedTarget && expectedTarget !== entryDigest) {
    diffs.push({
      field: "target_entry_sha256",
      expected: expectedTarget,
      actual: entryDigest,
    });
  }
  return { ok: diffs.length === 0, diffs, profile, corpus, entryDigest, targetId };
}

function semanticSlice(report) {
  return {
    overall: report.summary?.overall,
    counts: report.summary?.counts || {
      PASS: report.summary?.pass,
      BEHAVIORAL_DIVERGENCE: report.summary?.divergence,
    },
    results: (report.results || []).map((r) => ({
      vector_id: r.vector_id,
      status: r.status === "DIVERGENCE" ? "BEHAVIORAL_DIVERGENCE" : r.status,
      expected: r.expected?.decision ?? null,
      observed: r.observed?.decision ?? null,
    })),
  };
}

export function compareSemantic(original, replayed) {
  const a = semanticSlice(original);
  const b = semanticSlice(replayed);
  const diffs = [];
  if (a.overall !== b.overall) {
    diffs.push({ field: "overall", expected: a.overall, actual: b.overall });
  }
  const byId = new Map(b.results.map((r) => [r.vector_id, r]));
  for (const r of a.results) {
    const o = byId.get(r.vector_id);
    if (!o) {
      diffs.push({ field: `results.${r.vector_id}`, error: "missing_in_replay" });
      continue;
    }
    if (r.status !== o.status) {
      diffs.push({
        field: `results.${r.vector_id}.status`,
        expected: r.status,
        actual: o.status,
      });
    }
    if (r.observed !== o.observed) {
      diffs.push({
        field: `results.${r.vector_id}.observed`,
        expected: r.observed,
        actual: o.observed,
      });
    }
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
    write: opts.write === true,
    timeoutMs: opts.timeoutMs,
  });

  const sem = compareSemantic(original, replayed);
  return {
    schema: "raven-conformance-replay/1",
    ok: bundle.ok && sem.ok,
    bundle_match: bundle.ok,
    semantic_match: sem.ok,
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
