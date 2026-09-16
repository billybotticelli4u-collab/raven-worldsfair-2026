#!/usr/bin/env node
/**
 * Artifact-substitution harness for the Raven Conformance MVP.
 *
 * Each case builds an isolated copy of apps/raven-conformance in a temp bundle,
 * applies exactly one mutation, optionally re-runs the UNMODIFIED engine inside
 * that bundle, then runs raven-attest against the resulting report.
 *
 * `expect.detected_by` lists the attest check ids that MUST fail. The harness
 * fails the case if a listed check does not fail, or if an unlisted check fails.
 *
 * FREEZE PROVENANCE — read this before quoting the 28/28 figure.
 * "Frozen before execution" is true per case, not for the pack as a whole. Each
 * case carries `freeze_status`:
 *   ORIGINAL_ROUND_1          authored and frozen before ANY case in this pack ran
 *   ORIGINAL_ROUND_2          authored after round 1, frozen before ITS OWN first run
 *   REVISED_AFTER_MEASUREMENT frozen value was changed after observing output
 * Four cases (S04, S05, S12, S19) are REVISED: three had incomplete freezes where
 * the extra detection was correct, one (S12) was frozen wrong. In all four the
 * freeze moved and the checker did not. Separately, S01 exposed a real checker
 * defect and C1 was fixed (see CHECKER_REVISIONS). The 28/28 figure is therefore
 * "reproducible at the current freeze", not "first-try green". Reduction raised
 * by GROK in non-author review, 2026-09-16; accepted.
 *
 * Nothing here edits the engine, the shared schema, or the source tree.
 *
 * Usage: node harness/substitution.js [--json] [--keep]
 */
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { attest, emitPins } from "../src/attest.js";
import { conformanceCoreDigest as coreDigest } from "../src/lib/stable.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ATTEST_APP = path.resolve(HERE, "..");
const REPO_ROOT = path.resolve(ATTEST_APP, "..", "..");
const ENGINE_APP = path.join(REPO_ROOT, "apps", "raven-conformance");
const PINS = path.join(ATTEST_APP, "pins", "bundle-pins-53360df.json");

const sha = (t) => createHash("sha256").update(t, "utf8").digest("hex");
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const writeJson = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2) + "\n");

/** Recompute the engine's report_content_digest_sha256 after editing a report. */
function reseal(report) {
  const clone = { ...report };
  delete clone.report_content_digest_sha256;
  delete clone._written_path;
  return { ...clone, report_content_digest_sha256: sha(JSON.stringify(clone, null, 2) + "\n") };
}

/** Recompute the corpus file's self-declared content digest after editing it. */
function resealCorpus(corpus) {
  const forDigest = {
    id: corpus.id,
    version: corpus.version,
    profile: corpus.profile,
    description: corpus.description,
    vectors: corpus.vectors,
  };
  corpus.content_digest_sha256 = sha(JSON.stringify(forDigest, null, 2) + "\n");
  return corpus;
}

function freshBundle(tmpRoot, name) {
  const root = path.join(tmpRoot, name);
  const app = path.join(root, "apps", "raven-conformance");
  mkdirSync(path.dirname(app), { recursive: true });
  cpSync(ENGINE_APP, app, { recursive: true });
  return { root, app };
}

function runEngine(app, target, cwd) {
  const out = execFileSync(process.execPath, [path.join(app, "src", "cli.js"), "--target", target, "--json"], {
    cwd: cwd || os.tmpdir(),
    encoding: "utf8",
    env: { ...process.env },
    maxBuffer: 32 * 1024 * 1024,
  }).toString();
  return JSON.parse(out);
}

/** execFileSync throws on non-zero exit; the CLI exits 1 for DIVERGENT. */
function runEngineAllowDivergent(app, target, cwd) {
  try {
    return runEngine(app, target, cwd);
  } catch (e) {
    if (e.stdout) return JSON.parse(e.stdout.toString());
    throw e;
  }
}

/**
 * FREEZE LEDGER
 *
 * `freeze_status` is an AUTHOR ASSERTION. A third party can verify that 28/28
 * reproduces; they cannot verify *when* any expectation was authored, because
 * the first commit containing this harness (a2ede06d) already carries the
 * revised freeze. Git cannot date round 1 and neither can anything else here.
 * Residual raised by GROK, 2026-09-16: "I cannot independently date that
 * chronology." Correct, and not retroactively fixable.
 *
 * What IS establishable, from this commit forward: the freeze has not drifted.
 * freezeDigest() hashes {id, freeze_status, expect} for every case. The value is
 * committed in harness/FREEZE_LEDGER.json in its own commit, so any later run
 * shows MATCH or DRIFT against a dated ref. That proves "unchanged since
 * <commit>", never "authored before execution".
 */
function freezeDigest(cases) {
  const canon = cases
    .map((c) => ({
      id: c.id,
      freeze_status: c.freeze_status,
      verdict: c.expect.verdict,
      detected_by: [...c.expect.detected_by].sort(),
    }))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  return sha(JSON.stringify(canon));
}

const CHECKER_REVISIONS = [
  {
    id: "checker-revision-1",
    check: "C1",
    found_by: "S01",
    round: 1,
    what:
      "C1 compared the pinned target entry digest only against what the report claimed, not against the bytes on disk, so swapping the target file after the run went unnoticed by the pin. C1 now checks both sides.",
  },
];

const p = (app, ...rest) => path.join(app, ...rest);
const CORPUS = ["corpus", "raven-canonical-envelope-demo-corpus-1.json"];
const PROFILE = ["profiles", "raven-canonical-envelope-1.json"];
const MANIFESTS = ["targets", "manifests.json"];

// ---------------------------------------------------------------------------
// Case catalogue. `expect.detected_by` is frozen here, before execution.
// ---------------------------------------------------------------------------
const CASES = [
  {
    id: "P01",
    freeze_status: "ORIGINAL_ROUND_1",
    kind: "positive-control",
    title: "Valid replay of a CONFORMANT report succeeds",
    expect: { verdict: "ACCEPTED", detected_by: [] },
    run: ({ app }) => ({ report: runEngine(app, "CONFORMANT_REFERENCE"), bundle: app }),
  },
  {
    id: "P02",
    freeze_status: "ORIGINAL_ROUND_1",
    kind: "positive-control",
    title: "Valid replay of a DIVERGENT report also succeeds (integrity ≠ conformance)",
    note: "BROKEN_SUBTLE legitimately fails 2 vectors. The report is honest, so attest must ACCEPT it.",
    expect: { verdict: "ACCEPTED", detected_by: [] },
    run: ({ app }) => ({ report: runEngineAllowDivergent(app, "BROKEN_SUBTLE"), bundle: app }),
  },
  {
    id: "P03",
    freeze_status: "ORIGINAL_ROUND_1",
    kind: "positive-control",
    title: "Clean-room replay from an unrelated working directory succeeds",
    note: "Engine invoked with cwd=/ ; attest invoked with absolute paths only.",
    expect: { verdict: "ACCEPTED", detected_by: [] },
    run: ({ app }) => ({ report: runEngine(app, "CONFORMANT_REFERENCE", path.parse(process.cwd()).root), bundle: app }),
  },

  {
    id: "S01",
    freeze_status: "ORIGINAL_ROUND_1",
    kind: "target-substitution",
    title: "Target bytes swapped after the run (same id, same entry filename)",
    expect: { verdict: "REJECTED", detected_by: ["A6", "C1"] },
    run: ({ app }) => {
      const report = runEngine(app, "CONFORMANT_REFERENCE");
      cpSync(p(app, "targets", "BROKEN_OBVIOUS.mjs"), p(app, "targets", "CONFORMANT_REFERENCE.mjs"));
      return { report, bundle: app };
    },
  },
  {
    id: "S02",
    freeze_status: "ORIGINAL_ROUND_1",
    kind: "target-substitution",
    title: "Manifest re-points CONFORMANT_REFERENCE at the broken implementation, then runs",
    note: "The engine never digests manifests.json, so the emitted report is fully self-consistent.",
    expect: { verdict: "REJECTED", detected_by: ["C1"] },
    run: ({ app }) => {
      const m = readJson(p(app, ...MANIFESTS));
      m.targets.find((t) => t.id === "CONFORMANT_REFERENCE").entry = "BROKEN_OBVIOUS.mjs";
      writeJson(p(app, ...MANIFESTS), m);
      return { report: runEngineAllowDivergent(app, "CONFORMANT_REFERENCE"), bundle: app };
    },
  },
  {
    id: "S03",
    freeze_status: "ORIGINAL_ROUND_1",
    kind: "corpus-substitution",
    title: "Corpus shrunk to hide the two vectors BROKEN_SUBTLE fails, digest resealed",
    note: "Yields a CONFORMANT verdict for a target that is known-broken. Self-consistent end to end.",
    expect: { verdict: "REJECTED", detected_by: ["C1"] },
    run: ({ app }) => {
      const c = readJson(p(app, ...CORPUS));
      c.vectors = c.vectors.filter((v) => !v.id.includes("unexpected"));
      writeJson(p(app, ...CORPUS), resealCorpus(c));
      return { report: runEngine(app, "BROKEN_SUBTLE"), bundle: app };
    },
  },
  {
    id: "S04",
    freeze_status: "REVISED_AFTER_MEASUREMENT",
    kind: "corpus-substitution",
    title: "Corpus vector expectation flipped, self-declared digest NOT resealed",
    expect: { verdict: "REJECTED", detected_by: ["A3", "C1", "D1"] },
    freeze_revision:
      "Run 1 froze [A3,C1] and measured [A3,C1,D1]. D1 is correct: flipping a corpus expectation also makes that expectation un-derivable from the profile rules. The freeze was incomplete; the checker was not changed.",
    run: ({ app }) => {
      const c = readJson(p(app, ...CORPUS));
      c.vectors.find((v) => v.id === "V07_unexpected_top_level_field").expected.decision = "ACCEPT";
      writeJson(p(app, ...CORPUS), c);
      return { report: runEngineAllowDivergent(app, "BROKEN_SUBTLE"), bundle: app };
    },
  },
  {
    id: "S05",
    freeze_status: "REVISED_AFTER_MEASUREMENT",
    kind: "profile-substitution",
    title: "Profile rules rewritten to permit unexpected fields; version bumped to 2.0.0",
    note: "Measured consequence: the run outcome is byte-identical. The profile is descriptive, not executed.",
    expect: { verdict: "REJECTED", detected_by: ["C1", "D1"] },
    freeze_revision:
      "Run 1 froze [C1] and measured [C1,D1]. D1 is correct: after the rules are rewritten, the corpus expectations no longer follow from the profile. The freeze was incomplete; the checker was not changed.",
    run: ({ app }) => {
      const before = runEngineAllowDivergent(app, "BROKEN_SUBTLE");
      const prof = readJson(p(app, ...PROFILE));
      prof.version = "2.0.0";
      prof.allowed_top_level_keys = [...prof.allowed_top_level_keys, "extra", "x_extension"];
      prof.rules[0] = "Unexpected top-level keys are permitted.";
      writeJson(p(app, ...PROFILE), prof);
      const after = runEngineAllowDivergent(app, "BROKEN_SUBTLE");
      return {
        report: after,
        bundle: app,
        side_evidence: {
          question: "Does rewriting the profile change any executed outcome?",
          summary_before: before.summary,
          summary_after: after.summary,
          outcomes_identical:
            JSON.stringify(before.results.map((r) => [r.vector_id, r.status])) ===
            JSON.stringify(after.results.map((r) => [r.vector_id, r.status])),
        },
      };
    },
  },
  {
    id: "S06",
    freeze_status: "ORIGINAL_ROUND_1",
    kind: "report-tamper",
    title: "Expected results rewritten inside the report, report digest resealed",
    expect: { verdict: "REJECTED", detected_by: ["B6"] },
    run: ({ app }) => {
      let r = runEngineAllowDivergent(app, "BROKEN_SUBTLE");
      for (const row of r.results) {
        if (row.status === "DIVERGENCE" && row.observed.decision) {
          row.expected.decision = row.observed.decision;
          row.status = "PASS";
        }
      }
      r.summary = {
        test_count: r.results.length,
        pass: r.results.length,
        divergence: 0,
        overall: "CONFORMANT",
      };
      return { report: reseal(r), bundle: app };
    },
  },
  {
    id: "S07",
    freeze_status: "ORIGINAL_ROUND_1",
    kind: "report-tamper",
    title: "Observed decisions rewritten inside the report, status+summary+digest made self-consistent",
    note: "Only the retained raw stdout still disagrees.",
    expect: { verdict: "REJECTED", detected_by: ["B4"] },
    run: ({ app }) => {
      let r = runEngineAllowDivergent(app, "BROKEN_SUBTLE");
      for (const row of r.results) {
        if (row.status === "DIVERGENCE") {
          row.observed.decision = row.expected.decision;
          row.observed.reason = "canonical_envelope_ok";
          row.status = "PASS";
        }
      }
      r.summary = { test_count: r.results.length, pass: r.results.length, divergence: 0, overall: "CONFORMANT" };
      return { report: reseal(r), bundle: app };
    },
  },
  {
    id: "S08",
    freeze_status: "ORIGINAL_ROUND_1",
    kind: "report-tamper",
    title: "Summary inflated without touching rows, report digest resealed",
    expect: { verdict: "REJECTED", detected_by: ["B2"] },
    run: ({ app }) => {
      let r = runEngineAllowDivergent(app, "BROKEN_SUBTLE");
      r.summary = { test_count: r.results.length, pass: r.results.length, divergence: 0, overall: "CONFORMANT" };
      return { report: reseal(r), bundle: app };
    },
  },
  {
    id: "S09",
    freeze_status: "ORIGINAL_ROUND_1",
    kind: "report-tamper",
    title: "Report edited but digest NOT resealed",
    expect: { verdict: "REJECTED", detected_by: ["B1", "B2"] },
    run: ({ app }) => {
      const r = runEngineAllowDivergent(app, "BROKEN_SUBTLE");
      r.summary.overall = "CONFORMANT";
      r.summary.divergence = 0;
      r.summary.pass = r.results.length;
      return { report: r, bundle: app };
    },
  },
  {
    id: "S10",
    freeze_status: "ORIGINAL_ROUND_1",
    kind: "reordering",
    title: "Result rows reordered inside the report, digest resealed",
    expect: { verdict: "REJECTED", detected_by: ["B5"] },
    run: ({ app }) => {
      const r = runEngine(app, "CONFORMANT_REFERENCE");
      r.results.reverse();
      return { report: reseal(r), bundle: app };
    },
  },
  {
    id: "S11",
    freeze_status: "ORIGINAL_ROUND_1",
    kind: "reordering",
    title: "Corpus vectors reordered in the bundle, corpus digest resealed, engine re-run",
    note: "Report is self-consistent with the reordered corpus; only the pin disagrees.",
    expect: { verdict: "REJECTED", detected_by: ["C1"] },
    run: ({ app }) => {
      const c = readJson(p(app, ...CORPUS));
      c.vectors.reverse();
      writeJson(p(app, ...CORPUS), resealCorpus(c));
      return { report: runEngine(app, "CONFORMANT_REFERENCE"), bundle: app };
    },
  },
  {
    id: "S12",
    freeze_status: "REVISED_AFTER_MEASUREMENT",
    kind: "path-traversal",
    title: "Replay reference escapes targets/ via ../ in the manifest entry",
    note: "Also measures whether the UNMODIFIED engine executes the escaped path.",
    expect: { verdict: "REJECTED", detected_by: ["A7", "C1"] },
    freeze_revision:
      "Run 1 froze [A6,A7,C1] and measured [A7,C1]. A6 is SKIPPED by design: once A7 shows the reference escapes targets/, attest refuses to read the file to digest it. The freeze was wrong; the checker was not changed.",
    run: ({ app }) => {
      const m = readJson(p(app, ...MANIFESTS));
      m.targets.find((t) => t.id === "CONFORMANT_REFERENCE").entry = "../src/traversal-probe.mjs";
      writeJson(p(app, ...MANIFESTS), m);
      writeFileSync(
        p(app, "src", "traversal-probe.mjs"),
        'process.stdin.on("data",()=>{});process.stdout.write(JSON.stringify({decision:"ACCEPT",reason:"executed_outside_targets_dir"})+"\\n");\n',
      );
      const report = runEngineAllowDivergent(app, "CONFORMANT_REFERENCE");
      return {
        report,
        bundle: app,
        side_evidence: {
          question: "Did the unmodified engine spawn a file outside targets/ ?",
          engine_executed_escaped_path: report.results.some((r) =>
            (r.evidence?.stdout || "").includes("executed_outside_targets_dir"),
          ),
          reported_entry: report.target.entry,
        },
      };
    },
  },
  {
    id: "S13",
    freeze_status: "ORIGINAL_ROUND_1",
    kind: "stale-reuse",
    title: "The same report presented twice against a run-id ledger",
    expect: { verdict: "REJECTED", detected_by: ["G1"] },
    ledger: true,
    run: ({ app, ledgerPath, reportDir }) => {
      const r = runEngine(app, "CONFORMANT_REFERENCE");
      const first = path.join(reportDir, `${r.run_id}.json`);
      writeJson(first, r);
      attest({ reportPath: first, bundleRoot: app, pinsPath: PINS, ledgerPath }); // first presentation
      return { report: r, bundle: app, side_evidence: { first_presentation: "recorded in ledger" } };
    },
  },
  {
    id: "S14",
    freeze_status: "ORIGINAL_ROUND_1",
    kind: "run-id-collision",
    title: "Two materially different reports forced to share one run_id",
    expect: { verdict: "REJECTED", detected_by: ["G1"] },
    ledger: true,
    run: ({ app, ledgerPath, reportDir }) => {
      const a = runEngine(app, "CONFORMANT_REFERENCE");
      const b = runEngineAllowDivergent(app, "BROKEN_OBVIOUS");
      b.run_id = a.run_id;
      const sealedA = reseal(a);
      const sealedB = reseal(b);
      const first = path.join(reportDir, `${sealedA.run_id}.json`);
      writeJson(first, sealedA);
      attest({ reportPath: first, bundleRoot: app, pinsPath: PINS, ledgerPath });
      return { report: sealedB, bundle: app };
    },
  },
  {
    id: "S15",
    freeze_status: "ORIGINAL_ROUND_1",
    kind: "overclaim",
    title: "Report body edited to claim signer trust and successful on-chain execution",
    expect: { verdict: "REJECTED", detected_by: ["E1"] },
    run: ({ app }) => {
      const r = runEngine(app, "CONFORMANT_REFERENCE");
      r.divergence_definition =
        "All vectors matched, so the signer is trusted and the transaction executed on-chain as deployed.";
      return { report: reseal(r), bundle: app };
    },
  },
  {
    id: "S16",
    freeze_status: "ORIGINAL_ROUND_1",
    kind: "corpus-substitution",
    title: "Same attack as S03, but attest run WITHOUT an out-of-band pin",
    note: "Establishes what the report alone can and cannot show. Expected to be ACCEPTED — that is the gap, not a bug in attest.",
    expect: { verdict: "ACCEPTED", detected_by: [] },
    noPins: true,
    run: ({ app }) => {
      const c = readJson(p(app, ...CORPUS));
      c.vectors = c.vectors.filter((v) => !v.id.includes("unexpected"));
      writeJson(p(app, ...CORPUS), resealCorpus(c));
      return { report: runEngine(app, "BROKEN_SUBTLE"), bundle: app };
    },
  },

  // --- cases added in run 2 so that every non-INFO check is shown to be able to fail.
  //     A check that never fails in any case is an untested guard, not a passing one.
  {
    id: "S17",
    freeze_status: "ORIGINAL_ROUND_2",
    kind: "profile-substitution",
    title: "Profile bytes swapped after the run (report keeps the old profile digest)",
    expect: { verdict: "REJECTED", detected_by: ["A1", "C1", "D1"] },
    run: ({ app }) => {
      const report = runEngine(app, "CONFORMANT_REFERENCE");
      const prof = readJson(p(app, ...PROFILE));
      prof.schema_value = "raven-canonical-envelope/2";
      writeJson(p(app, ...PROFILE), prof);
      return { report, bundle: app };
    },
  },
  {
    id: "S18",
    freeze_status: "ORIGINAL_ROUND_2",
    kind: "report-tamper",
    title: "Corpus vector_count and carried declared digest rewritten in the report",
    expect: { verdict: "REJECTED", detected_by: ["A3b", "A4"] },
    run: ({ app }) => {
      const r = runEngine(app, "CONFORMANT_REFERENCE");
      r.corpus.vector_count = 42;
      r.corpus.declared_content_digest_sha256 = "0".repeat(64);
      return { report: reseal(r), bundle: app };
    },
  },
  {
    id: "S19",
    freeze_status: "REVISED_AFTER_MEASUREMENT",
    kind: "report-tamper",
    title: "Target identity fields rewritten in the report (manifest still says otherwise)",
    expect: { verdict: "REJECTED", detected_by: ["A5", "E1"] },
    freeze_revision:
      "Run 2 froze [A5] and measured [A5,E1]. E1 is correct: the injected description string \"Audited and certified implementation.\" is an unqualified certification claim. The freeze was incomplete; the checker was not changed.",
    run: ({ app }) => {
      const r = runEngine(app, "CONFORMANT_REFERENCE");
      r.target.version = "9.9.9";
      r.target.description = "Audited and certified implementation.";
      return { report: reseal(r), bundle: app };
    },
  },
  {
    id: "S20",
    freeze_status: "ORIGINAL_ROUND_2",
    kind: "report-tamper",
    title: "Row status flipped to PASS with summary made to agree; expected/observed left intact",
    expect: { verdict: "REJECTED", detected_by: ["B3"] },
    run: ({ app }) => {
      const r = runEngineAllowDivergent(app, "BROKEN_SUBTLE");
      for (const row of r.results) if (row.status === "DIVERGENCE") row.status = "PASS";
      r.summary = { test_count: r.results.length, pass: r.results.length, divergence: 0, overall: "CONFORMANT" };
      return { report: reseal(r), bundle: app };
    },
  },
  {
    id: "S21",
    freeze_status: "ORIGINAL_ROUND_2",
    kind: "report-tamper",
    title: "Run timestamps inverted (finished before started)",
    expect: { verdict: "REJECTED", detected_by: ["B7"] },
    run: ({ app }) => {
      const r = runEngine(app, "CONFORMANT_REFERENCE");
      const s = r.started_at;
      r.started_at = r.finished_at;
      r.finished_at = s === r.started_at ? new Date(Date.parse(s) - 60000).toISOString() : s;
      return { report: reseal(r), bundle: app };
    },
  },
  {
    id: "S22",
    freeze_status: "ORIGINAL_ROUND_2",
    kind: "target-substitution",
    title: "Report references a target id that this bundle does not define",
    expect: { verdict: "REJECTED", detected_by: ["A5", "C1"] },
    run: ({ app }) => {
      const r = runEngine(app, "CONFORMANT_REFERENCE");
      r.target.id = "AUDITED_PRODUCTION_VERIFIER";
      return { report: reseal(r), bundle: app };
    },
  },
  {
    id: "S23",
    freeze_status: "ORIGINAL_ROUND_2",
    kind: "profile-substitution",
    title: "Profile name/version restated in the report while the profile digest is left correct",
    note: "Shows that claimed_profile.sha256 does not cover the human-readable profile identity printed beside it.",
    expect: { verdict: "REJECTED", detected_by: ["A1b"] },
    run: ({ app }) => {
      const r = runEngine(app, "CONFORMANT_REFERENCE");
      r.claimed_profile.name = "raven-production-envelope";
      r.claimed_profile.version = "3.0.0";
      return { report: reseal(r), bundle: app };
    },
  },
  {
    id: "S24",
    freeze_status: "ORIGINAL_ROUND_2",
    kind: "report-tamper",
    title: "Corpus digest rewritten in the report while the bundle corpus is untouched",
    expect: { verdict: "REJECTED", detected_by: ["A2"] },
    run: ({ app }) => {
      const r = runEngine(app, "CONFORMANT_REFERENCE");
      r.corpus.sha256 = "f".repeat(64);
      return { report: reseal(r), bundle: app };
    },
  },
  {
    id: "S25",
    freeze_status: "ORIGINAL_ROUND_2",
    kind: "stale-reuse",
    title: "Report file renamed away from its run_id",
    note: "Classified UNDERSPECIFIED, not rejected: no contract in the MVP makes the filename authoritative.",
    expect: { verdict: "ACCEPTED", detected_by: [] },
    renameReport: "AUDIT_EVIDENCE_FINAL.json",
    run: ({ app }) => ({ report: runEngine(app, "CONFORMANT_REFERENCE"), bundle: app }),
  },
];

// ---------------------------------------------------------------------------
// D01 — cross-run determinism experiment (not a substitution case).
// Establishes which report content is reproducible and which is not.
// ---------------------------------------------------------------------------
function determinismExperiment(tmpRoot) {
  const { app } = freshBundle(tmpRoot, "D01");
  const a = runEngine(app, "CONFORMANT_REFERENCE");
  const b = runEngine(app, "CONFORMANT_REFERENCE");
  const coreA = coreDigest(a);
  const coreB = coreDigest(b);
  const differing = Object.keys(a).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  return {
    id: "D01",
    kind: "determinism",
    title: "Two honest runs of byte-identical inputs",
    measured: {
      engine_report_digest_equal: a.report_content_digest_sha256 === b.report_content_digest_sha256,
      attest_conformance_core_digest_equal: coreA === coreB,
      conformance_core_digest: coreA,
      top_level_keys_that_differ: differing,
    },
    conclusion:
      "The engine's report_content_digest_sha256 is NOT reproducible across runs — it covers run_id, timestamps and per-vector durations. It detects edits to one report file only. raven-attest's conformance_core_digest is reproducible and is the value two runs can be compared on. Neither promises identical runtime metadata across runs or hosts.",
  };
}

// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const asJson = args.includes("--json");
const keep = args.includes("--keep");
const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "raven-attest-"));
const reportDir = path.join(tmpRoot, "_reports");
mkdirSync(reportDir, { recursive: true });

const runs = [];
for (const c of CASES) {
  const { app } = freshBundle(tmpRoot, c.id);
  const ledgerPath = c.ledger ? path.join(tmpRoot, `${c.id}-ledger.json`) : null;
  let out;
  try {
    out = c.run({ app, ledgerPath, reportDir });
  } catch (e) {
    runs.push({ id: c.id, kind: c.kind, title: c.title, harness_error: String(e.message), case_result: "HARNESS_ERROR" });
    continue;
  }
  const caseDir = path.join(reportDir, c.id);
  mkdirSync(caseDir, { recursive: true });
  const reportPath = path.join(caseDir, c.renameReport || `${out.report.run_id}.json`);
  writeJson(reportPath, out.report);

  let res;
  try {
    res = attest({
      reportPath,
      bundleRoot: out.bundle,
      pinsPath: c.noPins ? null : PINS,
      ledgerPath,
    });
  } catch (e) {
    runs.push({ id: c.id, kind: c.kind, title: c.title, harness_error: String(e.message), case_result: "HARNESS_ERROR" });
    continue;
  }

  const failed = res.checks.filter((x) => x.verdict === "FAIL").map((x) => x.id).sort();
  const expected = [...c.expect.detected_by].sort();
  const missing = expected.filter((x) => !failed.includes(x));
  const unexpected = failed.filter((x) => !expected.includes(x));
  const verdictOk = res.verdict === c.expect.verdict;
  const caseResult = verdictOk && missing.length === 0 && unexpected.length === 0 ? "AS_FROZEN" : "OFF_EXPECTATION";

  runs.push({
    id: c.id,
    kind: c.kind,
    title: c.title,
    note: c.note ?? null,
    pins_used: !c.noPins,
    frozen_expectation: { verdict: c.expect.verdict, detected_by: expected },
    measured: {
      verdict: res.verdict,
      failed_checks: failed,
      underspecified_checks: res.checks.filter((x) => x.verdict === "UNDERSPECIFIED").map((x) => x.id),
      counts: res.counts,
    },
    missing_detections: missing,
    unexpected_detections: unexpected,
    case_result: caseResult,
    freeze_status: c.freeze_status,
    freeze_revision: c.freeze_revision ?? null,
    side_evidence: out.side_evidence ?? null,
    failure_detail: res.checks.filter((x) => x.verdict === "FAIL").map((x) => ({ id: x.id, detail: x.detail })),
  });
}

// Freeze-drift check against the dated ledger.
const LEDGER_PATH = path.join(HERE, "FREEZE_LEDGER.json");
const liveFreezeDigest = freezeDigest(CASES);
let freezeLedger;
try {
  const led = readJson(LEDGER_PATH);
  freezeLedger = {
    ledger_freeze_digest: led.freeze_digest,
    live_freeze_digest: liveFreezeDigest,
    status: led.freeze_digest === liveFreezeDigest ? "MATCH" : "DRIFT",
    established_at_commit: led.established_at_commit,
    proves: led.proves,
    cannot_prove: led.cannot_prove,
  };
} catch {
  freezeLedger = {
    ledger_freeze_digest: null,
    live_freeze_digest: liveFreezeDigest,
    status: "NO_LEDGER",
    note: "harness/FREEZE_LEDGER.json absent — drift cannot be checked.",
  };
}

const determinism = determinismExperiment(tmpRoot);

// Detector coverage: a check that never fails in any case is an untested guard.
const ALL_CHECK_IDS = (() => {
  const { app } = freshBundle(tmpRoot, "_probe");
  const r = runEngine(app, "CONFORMANT_REFERENCE");
  const probeDir = path.join(reportDir, "_probe");
  mkdirSync(probeDir, { recursive: true });
  const rp = path.join(probeDir, `${r.run_id}.json`);
  writeJson(rp, r);
  return attest({ reportPath: rp, bundleRoot: app, pinsPath: PINS, ledgerPath: null }).checks.map((c) => ({
    id: c.id,
    verdict_on_clean_report: c.verdict,
  }));
})();
const firedBy = {};
const flaggedBy = {};
for (const r of runs) {
  for (const id of r.measured?.failed_checks ?? []) (firedBy[id] ||= []).push(r.id);
  for (const id of r.measured?.underspecified_checks ?? []) (flaggedBy[id] ||= []).push(r.id);
}
const detectorCoverage = ALL_CHECK_IDS.map((c) => ({
  check: c.id,
  clean_report_verdict: c.verdict_on_clean_report,
  fired_in: firedBy[c.id] ?? [],
  underspecified_in: flaggedBy[c.id] ?? [],
  status:
    c.verdict_on_clean_report === "INFO"
      ? "INFORMATIONAL — asserts nothing"
      : (firedBy[c.id] ?? []).length
        ? "EXERCISED — shown to fail on at least one attack"
        : (flaggedBy[c.id] ?? []).length
          ? "EXERCISED AS UNDERSPECIFIED — no contract to fail against; classified, not rejected"
          : c.verdict_on_clean_report === "SKIPPED"
            ? "NOT EXERCISED — does not execute without extra input"
            : "UNTESTED GUARD — always passes in this pack; treat as unproven",
}));

const summary = {
  harness: "raven-attest substitution pack",
  cases: runs.length,
  as_frozen: runs.filter((r) => r.case_result === "AS_FROZEN").length,
  off_expectation: runs.filter((r) => r.case_result === "OFF_EXPECTATION").length,
  harness_errors: runs.filter((r) => r.case_result === "HARNESS_ERROR").length,
  untested_guards: detectorCoverage.filter((d) => d.status.startsWith("UNTESTED")).map((d) => d.check),
  freeze_provenance: {
    original_round_1: runs.filter((r) => r.freeze_status === "ORIGINAL_ROUND_1").map((r) => r.id),
    original_round_2: runs.filter((r) => r.freeze_status === "ORIGINAL_ROUND_2").map((r) => r.id),
    revised_after_measurement: runs.filter((r) => r.freeze_status === "REVISED_AFTER_MEASUREMENT").map((r) => r.id),
    checker_revisions: CHECKER_REVISIONS,
    provenance_class: {
      ORIGINAL_ROUND_1:
        "AUTHOR ASSERTION — not independently verifiable. Git cannot date it: the first commit containing this harness already carries the revised freeze.",
      ORIGINAL_ROUND_2:
        "AUTHOR ASSERTION — same limitation. These cases were added after round 1 and matched their freeze on first run, but only the author observed that.",
      REVISED_AFTER_MEASUREMENT:
        "AUTHOR DISCLOSURE AGAINST INTEREST — a third party can read the freeze_revision note and see the admission. Treat 4 as a LOWER BOUND on revisions, not a verified count.",
    },
    freeze_ledger: freezeLedger,
    honest_reading:
      "28/28 is reproducible at the current freeze. It is not a first-try result: 4 freezes were revised after measurement and 1 checker defect was fixed. Both are enumerated here rather than absorbed into the score.",
  },
};

// The JSON artifact is deliberately free of temp paths, run ids and timestamps,
// so `node harness/substitution.js --json` is byte-reproducible. Flagging the
// engine's non-reproducible report digest (F-5) while shipping a non-reproducible
// result file would be the same mistake.
if (asJson) {
  console.log(JSON.stringify({ summary, runs, determinism, detector_coverage: detectorCoverage }, null, 2));
} else {
  console.log(`(temp bundles under ${tmpRoot})`);
  for (const r of runs) {
    console.log(`[${r.case_result.padEnd(15)}] ${r.id}  ${r.title}`);
    console.log(`                    frozen: ${r.frozen_expectation ? `${r.frozen_expectation.verdict} via [${r.frozen_expectation.detected_by.join(",") || "—"}]` : "n/a"}`);
    console.log(`                    measured: ${r.measured ? `${r.measured.verdict} via [${r.measured.failed_checks.join(",") || "—"}]` : r.harness_error}`);
    console.log(`                    freeze: ${r.freeze_status}`);
    if (r.freeze_revision) console.log(`                    freeze revised: ${r.freeze_revision}`);
    if (r.side_evidence) console.log(`                    side: ${JSON.stringify(r.side_evidence)}`);
  }
  console.log("");
  console.log("FREEZE LEDGER:", JSON.stringify(freezeLedger));
  console.log("");
  console.log("DETERMINISM (D01):", JSON.stringify(determinism.measured));
  console.log("");
  console.log("DETECTOR COVERAGE");
  for (const d of detectorCoverage) console.log(`  ${d.check.padEnd(4)} ${d.status}  fired_in=[${d.fired_in.join(",")}] underspecified_in=[${d.underspecified_in.join(",")}]`);
  console.log("");
  console.log(JSON.stringify(summary, null, 2));
}

if (!keep) rmSync(tmpRoot, { recursive: true, force: true });
process.exit(summary.off_expectation === 0 && summary.harness_errors === 0 ? 0 : 1);
