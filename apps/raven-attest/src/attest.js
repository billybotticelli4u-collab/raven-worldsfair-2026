#!/usr/bin/env node
/**
 * raven-attest — standalone conformance-report checker.
 *
 * Answers one question: does this report refer to exactly the target, profile,
 * corpus and run the reader thinks it does?
 *
 * It does NOT import apps/raven-conformance. It re-derives every digest from the
 * bundle on disk and from the report bytes, so a "digest matches" verdict is not
 * produced by the same code that produced the digest.
 *
 * Usage:
 *   node src/attest.js --report <report.json> --bundle <repo-or-app-dir> [--pins <pins.json>]
 *                      [--ledger <ledger.json>] [--json]
 *   node src/attest.js --emit-pins --bundle <repo-or-app-dir>
 *
 * Exit: 0 all executed checks PASS, 1 any FAIL, 2 usage/IO error.
 *
 * Verdicts: PASS | FAIL | UNDERSPECIFIED | SKIPPED | ERROR.
 * An unexecuted check is never PASS.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveApp,
  bundlePaths,
  loadProfile,
  loadCorpus,
  loadManifests,
  fileSha256,
  recomputeReportDigest,
} from "./lib/bundle.js";
import { auditCorpusExpectations } from "./lib/oracle.js";
import {
  conformanceCoreDigest,
  environmentDigest,
  VARIABLE_FIELDS,
  HOST_DEPENDENT_FIELDS,
} from "./lib/stable.js";

const CLAIM_TERMS = [
  /\bsigner\b/i,
  /\bsignature[sd]?\b/i,
  /\bsigned\b/i,
  /\bauthoriz(e|ed|ation)\b/i,
  /\bdeploy(ed|ment)?\b/i,
  /\bon-?chain\b/i,
  /\bmainnet\b/i,
  /\bsecur(e|ity)\b/i,
  /\bcertif(y|ied|ication)\b/i,
  /\bguarantee[sd]?\b/i,
];
const NEGATION_MARKERS =
  /\b(not|no|never|none|without|cannot|can't|does not|doesn't|denied|deny|forbidden|excluded|only)\b/i;

function parseArgs(argv) {
  const out = { report: null, bundle: null, pins: null, ledger: null, json: false, emitPins: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--report") out.report = argv[++i];
    else if (a === "--bundle") out.bundle = argv[++i];
    else if (a === "--pins") out.pins = argv[++i];
    else if (a === "--ledger") out.ledger = argv[++i];
    else if (a === "--json") out.json = true;
    else if (a === "--emit-pins") out.emitPins = true;
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

function chk(checks, id, title, covers, verdict, detail, evidence) {
  checks.push({ id, title, covers, verdict, detail, evidence: evidence ?? null });
}

function stringLeaves(value, prefix = "", acc = []) {
  if (typeof value === "string") acc.push([prefix, value]);
  else if (Array.isArray(value)) value.forEach((v, i) => stringLeaves(v, `${prefix}[${i}]`, acc));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) stringLeaves(v, prefix ? `${prefix}.${k}` : k, acc);
  }
  return acc;
}

export function emitPins(bundleRoot) {
  const app = resolveApp(bundleRoot);
  const p = bundlePaths(app);
  const profile = loadProfile(app);
  const corpus = loadCorpus(app);
  const manifests = loadManifests(app);
  const targets = {};
  for (const t of manifests.data.targets) {
    const entryAbs = path.join(p.targetsDir, t.entry);
    targets[t.id] = {
      entry: t.entry,
      entry_sha256: existsSync(entryAbs) ? fileSha256(entryAbs) : null,
      claimed_conformance_profile: t.claimed_conformance_profile,
      version: t.version,
    };
  }
  return {
    pins_schema: "raven-attest-pins/1",
    note:
      "Out-of-band anchor. The engine report is self-consistent with whatever bundle was present at run time; without an external pin, corpus/profile/target substitution is undetectable from the report alone.",
    profile_sha256: profile.digest,
    profile_name: profile.data.name,
    profile_version: profile.data.version,
    corpus_computed_sha256: corpus.computedDigest,
    corpus_file_sha256: corpus.fileDigest,
    corpus_id: corpus.data.id,
    corpus_version: corpus.data.version,
    corpus_vector_ids: corpus.data.vectors.map((v) => v.id),
    manifests_sha256: manifests.digest,
    targets,
  };
}

export function attest({ reportPath, bundleRoot, pinsPath, ledgerPath }) {
  const checks = [];
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  const app = resolveApp(bundleRoot);
  const paths = bundlePaths(app);

  // ---------------------------------------------------------------- A. bundle binding
  let profile = null;
  let corpus = null;
  let manifests = null;
  try {
    profile = loadProfile(app);
  } catch (e) {
    chk(checks, "A1", "Profile digest binds report to bundle profile bytes", "claimed_profile.sha256", "ERROR", String(e.message));
  }
  try {
    corpus = loadCorpus(app);
  } catch (e) {
    chk(checks, "A2", "Corpus digest binds report to bundle corpus bytes", "corpus.sha256", "ERROR", String(e.message));
  }
  try {
    manifests = loadManifests(app);
  } catch (e) {
    chk(checks, "A5", "Target manifest entry binds report target identity", "target.*", "ERROR", String(e.message));
  }

  if (profile) {
    const ok = report.claimed_profile?.sha256 === profile.digest;
    chk(checks, "A1", "Profile digest binds report to bundle profile bytes", "claimed_profile.sha256", ok ? "PASS" : "FAIL",
      ok ? "report profile sha256 == sha256(bundle profile file)" : "report profile sha256 != bundle profile file",
      { report: report.claimed_profile?.sha256 ?? null, bundle: profile.digest });

    const nameOk =
      report.claimed_profile?.name === profile.data.name &&
      report.claimed_profile?.version === profile.data.version;
    chk(checks, "A1b", "Profile name/version in report match bundle profile", "claimed_profile.name/version", nameOk ? "PASS" : "FAIL",
      nameOk ? "match" : "profile identity strings differ from bundle",
      { report: `${report.claimed_profile?.name}@${report.claimed_profile?.version}`, bundle: `${profile.data.name}@${profile.data.version}` });
  }

  if (corpus) {
    const ok = report.corpus?.sha256 === corpus.computedDigest;
    chk(checks, "A2", "Corpus digest binds report to bundle corpus content", "corpus.sha256", ok ? "PASS" : "FAIL",
      ok ? "report corpus sha256 == recomputed corpus content digest" : "report corpus sha256 != recomputed corpus content digest",
      { report: report.corpus?.sha256 ?? null, recomputed: corpus.computedDigest });

    const selfOk = corpus.computedDigest === corpus.declaredDigest;
    chk(checks, "A3", "Corpus self-declaration is internally consistent", "corpus file content_digest_sha256", selfOk ? "PASS" : "FAIL",
      selfOk
        ? "corpus content_digest_sha256 matches its own vectors"
        : "corpus file declares a content digest that does not match its own vectors — the engine never compares these at run time",
      { declared: corpus.declaredDigest, recomputed: corpus.computedDigest });

    const carriedOk = report.corpus?.declared_content_digest_sha256 === corpus.declaredDigest;
    chk(checks, "A3b", "Report carries the corpus's own declared digest unaltered", "corpus.declared_content_digest_sha256", carriedOk ? "PASS" : "FAIL",
      carriedOk ? "match" : "report's carried declared digest differs from the corpus file",
      { report: report.corpus?.declared_content_digest_sha256 ?? null, bundle: corpus.declaredDigest });

    const countOk = report.corpus?.vector_count === corpus.data.vectors.length;
    chk(checks, "A4", "Reported vector_count equals bundle corpus vector count", "corpus.vector_count", countOk ? "PASS" : "FAIL",
      countOk ? "match" : "vector_count disagrees with bundle corpus",
      { report: report.corpus?.vector_count ?? null, bundle: corpus.data.vectors.length });
  }

  // target entry bytes + path containment
  const entry = report.target?.entry;
  if (typeof entry !== "string") {
    chk(checks, "A6", "Target entry digest binds report to executed bytes", "target.entry_sha256", "ERROR", "report.target.entry missing or not a string");
  } else {
    const entryAbs = path.resolve(paths.targetsDir, entry);
    const contained = entryAbs === paths.targetsDir || entryAbs.startsWith(paths.targetsDir + path.sep);
    chk(checks, "A7", "Replay reference stays inside the targets directory", "target.entry path containment", contained ? "PASS" : "FAIL",
      contained ? "resolved entry is inside targets/" : "entry escapes targets/ — replay reference is a traversal",
      { entry, resolved: entryAbs, targetsDir: paths.targetsDir });

    if (!contained) {
      chk(checks, "A6", "Target entry digest binds report to executed bytes", "target.entry_sha256", "SKIPPED", "not executed: entry path escapes targets/");
    } else if (!existsSync(entryAbs)) {
      chk(checks, "A6", "Target entry digest binds report to executed bytes", "target.entry_sha256", "FAIL", "referenced target entry does not exist in this bundle", { entry });
    } else {
      const d = fileSha256(entryAbs);
      const ok = report.target?.entry_sha256 === d;
      chk(checks, "A6", "Target entry digest binds report to executed bytes", "target.entry_sha256", ok ? "PASS" : "FAIL",
        ok ? "report entry_sha256 == sha256(bundle target file)" : "report entry_sha256 != bundle target file bytes",
        { report: report.target?.entry_sha256 ?? null, bundle: d });
    }
  }

  // manifest ↔ report target identity (the engine never digests the manifest)
  if (manifests) {
    const m = manifests.data.targets.find((t) => t.id === report.target?.id);
    if (!m) {
      chk(checks, "A5", "Target manifest entry binds report target identity", "target.id", "FAIL",
        "report target id is not present in this bundle's manifests.json", { id: report.target?.id ?? null });
    } else {
      const fields = ["entry", "version", "claimed_conformance_profile", "invocation_interface", "description"];
      const mismatched = fields.filter((f) => m[f] !== report.target?.[f]);
      chk(checks, "A5", "Target manifest entry binds report target identity", "target.entry/version/profile/interface/description",
        mismatched.length === 0 ? "PASS" : "FAIL",
        mismatched.length === 0 ? "all manifest fields match the report" : `manifest disagrees on: ${mismatched.join(", ")}`,
        { mismatched, manifest: m, report: report.target });
    }
  }

  // ---------------------------------------------------------------- B. report self-consistency
  try {
    const recomputed = recomputeReportDigest(report);
    const ok = recomputed === report.report_content_digest_sha256;
    chk(checks, "B1", "Report content digest recomputes over the report's own bytes", "report_content_digest_sha256", ok ? "PASS" : "FAIL",
      ok ? "recomputed digest matches the declared value" : "declared report digest does not cover the report as it now reads",
      { declared: report.report_content_digest_sha256 ?? null, recomputed });
  } catch (e) {
    chk(checks, "B1", "Report content digest recomputes over the report's own bytes", "report_content_digest_sha256", "ERROR", String(e.message));
  }

  const results = Array.isArray(report.results) ? report.results : [];
  const pass = results.filter((r) => r.status === "PASS").length;
  const div = results.filter((r) => r.status === "DIVERGENCE").length;
  const arithOk =
    report.summary?.test_count === results.length &&
    report.summary?.pass === pass &&
    report.summary?.divergence === div &&
    report.summary?.overall === (div === 0 ? "CONFORMANT" : "DIVERGENT");
  chk(checks, "B2", "Summary arithmetic follows from the result rows", "summary.*", arithOk ? "PASS" : "FAIL",
    arithOk ? "counts and overall verdict recompute from results[]" : "summary does not follow from results[]",
    { summary: report.summary ?? null, recomputed: { test_count: results.length, pass, divergence: div, overall: div === 0 ? "CONFORMANT" : "DIVERGENT" } });

  const badStatus = results.filter((r) => {
    const obs = r.observed?.decision ?? null;
    const expected = r.expected?.decision ?? null;
    const shouldPass = obs !== null && obs === expected && !r.observed?.parseError && !r.observed?.timedOut;
    return r.status !== (shouldPass ? "PASS" : "DIVERGENCE");
  });
  chk(checks, "B3", "Per-vector status follows from expected vs observed", "results[].status", badStatus.length === 0 ? "PASS" : "FAIL",
    badStatus.length === 0 ? "every row's status is implied by its own expected/observed pair" : `${badStatus.length} row(s) carry a status their own fields do not imply`,
    { offending: badStatus.map((r) => r.vector_id) });

  // observation vs raw evidence — the report carries the child stdout it claims to summarise
  const tampered = results.filter((r) => {
    const out = r.evidence?.stdout;
    if (typeof out !== "string" || out.trim() === "") return false;
    const line = out.trim().split(/\r?\n/).filter(Boolean).pop();
    let parsed = null;
    try {
      parsed = JSON.parse(line);
    } catch {
      return false;
    }
    return (parsed?.decision ?? null) !== (r.observed?.decision ?? null);
  });
  chk(checks, "B4", "Observed decision matches the raw stdout the report carries", "results[].observed vs results[].evidence.stdout",
    tampered.length === 0 ? "PASS" : "FAIL",
    tampered.length === 0 ? "each observed decision is the last JSON line of its own captured stdout" : `${tampered.length} row(s) summarise a decision their captured stdout does not contain`,
    { offending: tampered.map((r) => r.vector_id) });

  if (corpus) {
    const reportIds = results.map((r) => r.vector_id);
    const corpusIds = corpus.data.vectors.map((v) => v.id);
    const orderOk = JSON.stringify(reportIds) === JSON.stringify(corpusIds);
    chk(checks, "B5", "Result rows cover the bundle corpus, in corpus order", "results[].vector_id", orderOk ? "PASS" : "FAIL",
      orderOk ? "vector ids and order match the bundle corpus exactly" : "vector set or order differs from the bundle corpus",
      { report: reportIds, bundle: corpusIds });

    const byId = new Map(corpus.data.vectors.map((v) => [v.id, v]));
    const wrongExpect = results.filter((r) => {
      const v = byId.get(r.vector_id);
      return v && v.expected?.decision !== r.expected?.decision;
    });
    chk(checks, "B6", "Expected decisions in the report equal the bundle corpus expectations", "results[].expected.decision",
      wrongExpect.length === 0 ? "PASS" : "FAIL",
      wrongExpect.length === 0 ? "no expectation was rewritten in the report" : `${wrongExpect.length} row(s) carry an expectation the corpus does not specify`,
      { offending: wrongExpect.map((r) => ({ vector_id: r.vector_id, report: r.expected?.decision, corpus: byId.get(r.vector_id)?.expected?.decision })) });
  }

  const started = Date.parse(report.started_at ?? "");
  const finished = Date.parse(report.finished_at ?? "");
  const timeOk = Number.isFinite(started) && Number.isFinite(finished) && finished >= started;
  chk(checks, "B7", "Run timestamps are well-formed and ordered", "started_at/finished_at", timeOk ? "PASS" : "FAIL",
    timeOk ? "finished_at >= started_at" : "timestamps missing, unparseable, or inverted",
    { started_at: report.started_at ?? null, finished_at: report.finished_at ?? null });

  // ---------------------------------------------------------------- C. out-of-band pins
  if (!pinsPath) {
    chk(checks, "C1", "Bundle matches an out-of-band pin (profile/corpus/manifest/targets)", "profile+corpus+manifest+target digests", "SKIPPED",
      "no --pins supplied; report-vs-bundle agreement alone cannot detect a wholesale substitution");
  } else if (!existsSync(pinsPath)) {
    chk(checks, "C1", "Bundle matches an out-of-band pin (profile/corpus/manifest/targets)", "profile+corpus+manifest+target digests", "ERROR", `pins file not found: ${pinsPath}`);
  } else {
    const pins = JSON.parse(readFileSync(pinsPath, "utf8"));
    const diffs = [];
    if (profile && pins.profile_sha256 !== profile.digest) diffs.push({ what: "profile_sha256", pin: pins.profile_sha256, actual: profile.digest });
    if (corpus && pins.corpus_computed_sha256 !== corpus.computedDigest) diffs.push({ what: "corpus_computed_sha256", pin: pins.corpus_computed_sha256, actual: corpus.computedDigest });
    if (manifests && pins.manifests_sha256 !== manifests.digest) diffs.push({ what: "manifests_sha256", pin: pins.manifests_sha256, actual: manifests.digest });
    const pinnedTarget = pins.targets?.[report.target?.id];
    if (pinnedTarget) {
      if (pinnedTarget.entry !== report.target?.entry) diffs.push({ what: "target.entry", pin: pinnedTarget.entry, actual: report.target?.entry });
      if (pinnedTarget.entry_sha256 !== report.target?.entry_sha256) diffs.push({ what: "target.entry_sha256(report)", pin: pinnedTarget.entry_sha256, actual: report.target?.entry_sha256 });
      // Pin must also bind the BUNDLE bytes, not only what the report says about them.
      // (Harness run 1 found C1 missed S01 — bytes swapped after the run — because
      //  only the report-side value was compared. See FINDINGS.md "checker revision 1".)
      const pinnedAbs = path.resolve(paths.targetsDir, pinnedTarget.entry);
      const inside = pinnedAbs === paths.targetsDir || pinnedAbs.startsWith(paths.targetsDir + path.sep);
      if (!inside) diffs.push({ what: "target.entry(pin) path containment", pin: pinnedTarget.entry, actual: "escapes targets/" });
      else if (!existsSync(pinnedAbs)) diffs.push({ what: "target.entry(pin) present in bundle", pin: pinnedTarget.entry, actual: "missing" });
      else {
        const onDisk = fileSha256(pinnedAbs);
        if (onDisk !== pinnedTarget.entry_sha256) diffs.push({ what: "target.entry_sha256(bundle)", pin: pinnedTarget.entry_sha256, actual: onDisk });
      }
    } else {
      diffs.push({ what: "target.id", pin: "(not pinned)", actual: report.target?.id ?? null });
    }
    chk(checks, "C1", "Bundle matches an out-of-band pin (profile/corpus/manifest/targets)", "profile+corpus+manifest+target digests",
      diffs.length === 0 ? "PASS" : "FAIL",
      diffs.length === 0 ? "every pinned artifact digest matches this bundle" : `${diffs.length} pinned artifact(s) differ from this bundle`,
      { diffs });
  }

  // ---------------------------------------------------------------- D. independent oracle
  if (profile && corpus) {
    const rows = auditCorpusExpectations(profile.data, corpus.data);
    const bad = rows.filter((r) => !r.agrees);
    chk(checks, "D1", "Corpus expectations are reproducible from the profile rules alone", "corpus vectors[].expected vs profile rules[]",
      bad.length === 0 ? "PASS" : "FAIL",
      bad.length === 0
        ? `all ${rows.length} corpus expectations re-derive from profiles/ rules without reading any target`
        : `${bad.length} corpus expectation(s) are not implied by the profile rules`,
      { rows });
  } else {
    chk(checks, "D1", "Corpus expectations are reproducible from the profile rules alone", "corpus vectors[].expected vs profile rules[]", "SKIPPED", "profile or corpus unavailable");
  }

  // ---------------------------------------------------------------- E. claim hygiene
  const leaves = stringLeaves(report);
  const overclaims = [];
  for (const [p2, v] of leaves) {
    for (const term of CLAIM_TERMS) {
      if (term.test(v) && !NEGATION_MARKERS.test(v)) {
        overclaims.push({ path: p2, value: v, term: String(term) });
        break;
      }
    }
  }
  chk(checks, "E1", "Report makes no unqualified trust/authorization/deployment/on-chain claim", "all report string values",
    overclaims.length === 0 ? "PASS" : "FAIL",
    overclaims.length === 0
      ? "no string value asserts signer trust, authorization, deployment, on-chain execution, security or certification without an explicit negation/qualifier in the same value"
      : `${overclaims.length} unqualified claim string(s)`,
    { overclaims });

  // ---------------------------------------------------------------- F. determinism partition
  // F1 computes; it does not test. Labelling it PASS would claim an assertion
  // that was never made, so it carries the INFO verdict and is excluded from the
  // pass/fail tally. Cross-run equality is tested separately (harness case D01).
  chk(checks, "F1", "Deterministic result content is separated from variable run metadata", "conformance_core_digest",
    "INFO",
    "core digest computed over content that must be byte-identical for the same (target, profile, corpus); run_id/timestamps/durations excluded by construction. This row asserts nothing on its own.",
    {
      conformance_core_digest: conformanceCoreDigest(report),
      environment_digest: environmentDigest(report),
      excluded_variable_fields: VARIABLE_FIELDS,
      excluded_host_dependent_fields: HOST_DEPENDENT_FIELDS,
      caveat: "Two runs on different hosts may differ in environment_digest. This tool does not promise identical runtime metadata across runs.",
    });

  // ---------------------------------------------------------------- G. freshness / run identity
  if (!ledgerPath) {
    chk(checks, "G1", "run_id has not been seen before (replay / collision)", "run_id", "SKIPPED", "no --ledger supplied; a single report cannot establish its own freshness");
  } else {
    let ledger = { seen: {} };
    if (existsSync(ledgerPath)) ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
    const rid = report.run_id;
    const prior = ledger.seen?.[rid];
    const core = conformanceCoreDigest(report);
    if (!prior) {
      ledger.seen = ledger.seen || {};
      ledger.seen[rid] = { conformance_core_digest: core, report_content_digest_sha256: report.report_content_digest_sha256 };
      writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + "\n");
      chk(checks, "G1", "run_id has not been seen before (replay / collision)", "run_id", "PASS", "run_id is new to this ledger", { run_id: rid });
    } else if (prior.report_content_digest_sha256 === report.report_content_digest_sha256) {
      chk(checks, "G1", "run_id has not been seen before (replay / collision)", "run_id", "FAIL",
        "stale report reuse: this exact report has already been presented under this run_id", { run_id: rid });
    } else {
      chk(checks, "G1", "run_id has not been seen before (replay / collision)", "run_id", "FAIL",
        "run_id collision: two different reports claim the same run_id", { run_id: rid, prior, now: { conformance_core_digest: core, report_content_digest_sha256: report.report_content_digest_sha256 } });
    }
  }

  const base = path.basename(reportPath, ".json");
  const nameOk = base === report.run_id;
  chk(checks, "G2", "Report filename binds to the run_id it declares", "filename vs run_id", nameOk ? "PASS" : "UNDERSPECIFIED",
    nameOk
      ? "filename equals run_id, as the engine writes it"
      : "filename does not equal run_id — the engine writes reports/<run_id>.json but nothing forbids renaming; no contract makes filename authoritative",
    { filename: base, run_id: report.run_id ?? null });

  const counts = checks.reduce((acc, c) => ((acc[c.verdict] = (acc[c.verdict] || 0) + 1), acc), {});
  const verdict = counts.FAIL ? "REJECTED" : counts.ERROR ? "INCONCLUSIVE" : "ACCEPTED";

  return {
    attest_schema: "raven-attest-result/1",
    verdict,
    verdict_meaning:
      "ACCEPTED = every executed check passed for THIS report against THIS bundle. It does not establish signer trust, authorization, deployment, or on-chain execution.",
    report_path: reportPath,
    bundle_app: app,
    pins: pinsPath ?? null,
    subject: {
      run_id: report.run_id ?? null,
      target_id: report.target?.id ?? null,
      overall: report.summary?.overall ?? null,
      report_content_digest_sha256: report.report_content_digest_sha256 ?? null,
      conformance_core_digest: conformanceCoreDigest(report),
    },
    counts,
    checks,
  };
}

// ------------------------------------------------------------------ CLI
const IS_MAIN = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (!IS_MAIN) {
  // imported as a library (harness) — do not run the CLI
} else {
const args = parseArgs(process.argv);
if (args.help || (!args.report && !args.emitPins)) {
  console.log(`raven-attest — conformance report checker

  node src/attest.js --report <report.json> --bundle <dir> [--pins <pins.json>] [--ledger <l.json>] [--json]
  node src/attest.js --emit-pins --bundle <dir>
`);
  process.exit(args.help ? 0 : 2);
}

try {
  if (args.emitPins) {
    console.log(JSON.stringify(emitPins(args.bundle), null, 2));
    process.exit(0);
  }
  const result = attest({
    reportPath: args.report,
    bundleRoot: args.bundle,
    pinsPath: args.pins,
    ledgerPath: args.ledger,
  });
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`raven-attest  ${result.verdict}  (${Object.entries(result.counts).map(([k, v]) => `${v} ${k}`).join(", ")})`);
    console.log(`report ${result.subject.run_id}  target ${result.subject.target_id}  overall ${result.subject.overall}`);
    console.log("");
    for (const c of result.checks) console.log(`[${c.verdict.padEnd(14)}] ${c.id.padEnd(4)} ${c.title}\n                 ${c.detail}`);
    console.log("");
    console.log(result.verdict_meaning);
  }
  process.exit(result.verdict === "ACCEPTED" ? 0 : 1);
} catch (err) {
  console.error(`raven-attest error: ${err.message}`);
  process.exit(2);
}
}
