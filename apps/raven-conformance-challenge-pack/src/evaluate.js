import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CORPUS_PATH = path.join(APP_ROOT, "corpus", "raven-canonical-envelope-challenge-corpus-1.json");
const TARGETS_PATH = path.join(APP_ROOT, "targets", "manifests.json");
const TARGETS_DIR = path.join(APP_ROOT, "targets");
const RESULTS_DIR = path.join(APP_ROOT, "results");
const SOURCE_APP_ROOT = path.resolve(APP_ROOT, "..", "raven-conformance");
const SOURCE_PROFILE_PATH = path.join(SOURCE_APP_ROOT, "profiles", "raven-canonical-envelope-1.json");
const SOURCE_CORPUS_PATH = path.join(SOURCE_APP_ROOT, "corpus", "raven-canonical-envelope-demo-corpus-1.json");
const SOURCE_REFERENCE_PATH = path.join(SOURCE_APP_ROOT, "targets", "CONFORMANT_REFERENCE.mjs");
const DEFAULT_TIMEOUT_MS = 2000;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function exactInputBytes(vector) {
  if (vector.input_utf8_base64 !== undefined) return Buffer.from(vector.input_utf8_base64, "base64");
  return Buffer.from(JSON.stringify(vector.input), "utf8");
}

export function loadPack() {
  const corpus = readJson(CORPUS_PATH);
  const targets = readJson(TARGETS_PATH).targets;
  const sourceCorpus = readJson(SOURCE_CORPUS_PATH);
  const corpusContent = { ...corpus };
  delete corpusContent.content_digest_sha256;
  const computedContentDigest = sha256(Buffer.from(`${JSON.stringify(corpusContent, null, 2)}\n`, "utf8"));
  if (computedContentDigest !== corpus.content_digest_sha256) {
    throw new Error(`corpus_content_digest_mismatch:${computedContentDigest}`);
  }
  for (const [index, sourceVector] of sourceCorpus.vectors.entries()) {
    const mapped = corpus.vectors[index];
    if (mapped?.id !== sourceVector.id
      || JSON.stringify(mapped.input) !== JSON.stringify(sourceVector.input)
      || mapped.expected?.decision !== sourceVector.expected.decision) {
      throw new Error(`baseline_vector_mapping_mismatch:${sourceVector.id}`);
    }
  }
  const vectors = corpus.vectors.map((vector) => {
    const bytes = exactInputBytes(vector);
    return {
      ...vector,
      input_utf8_base64: bytes.toString("base64"),
      input_byte_length: bytes.length,
      input_sha256: sha256(bytes),
    };
  });
  return {
    corpus: { ...corpus, vectors },
    targets,
    identities: {
      corpus_file_sha256: sha256(readFileSync(CORPUS_PATH)),
      corpus_content_sha256: computedContentDigest,
      target_manifest_file_sha256: sha256(readFileSync(TARGETS_PATH)),
      source_profile_file_sha256: sha256(readFileSync(SOURCE_PROFILE_PATH)),
      source_baseline_corpus_file_sha256: sha256(readFileSync(SOURCE_CORPUS_PATH)),
      source_reference_entry_sha256: sha256(readFileSync(SOURCE_REFERENCE_PATH)),
    },
  };
}

function execute(entry, inputBytes, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [entry], {
      cwd: path.dirname(entry),
      env: { PATH: process.env.PATH || "", LANG: process.env.LANG || "C", NODE_OPTIONS: "" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ decision: null, reason: null, process_error: String(error), exit_code: null, timed_out: false, stdout, stderr });
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      const line = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) || "";
      let parsed = null;
      let processError = null;
      try {
        parsed = JSON.parse(line);
        if (!parsed || !["ACCEPT", "REJECT"].includes(parsed.decision)) processError = "invalid_decision_output";
      } catch {
        processError = "unparseable_stdout";
      }
      if (timedOut) processError = "timeout";
      else if (exitCode !== 0) processError = `nonzero_exit:${exitCode}`;
      resolve({
        decision: processError ? null : parsed.decision,
        reason: processError ? null : parsed.reason ?? null,
        process_error: processError,
        exit_code: exitCode,
        timed_out: timedOut,
        stdout,
        stderr,
      });
    });
    child.stdin.end(inputBytes);
  });
}

function preflightTarget(entry) {
  const checked = spawnSync(process.execPath, ["--check", entry], { encoding: "utf8" });
  if (checked.status === 0) return null;
  return {
    kind: "target_load_failure",
    exit_code: checked.status,
    stdout: checked.stdout,
    stderr: checked.stderr,
  };
}

async function evaluateTarget(target, vectors, timeoutMs) {
  const entry = path.resolve(TARGETS_DIR, target.entry);
  const infrastructureFailure = preflightTarget(entry);
  if (infrastructureFailure) {
    return {
      id: target.id,
      role: target.role,
      violated_requirement: target.violated_requirement ?? null,
      entry_sha256: sha256(readFileSync(entry)),
      infrastructure_failure: infrastructureFailure,
      status: target.role === "mutant" ? "INFRASTRUCTURE_FAILURE" : "INVALID_REFERENCE",
      scored_divergence_count: null,
      observations: [],
    };
  }
  const observations = [];
  for (const vector of vectors) {
    const observed = await execute(entry, Buffer.from(vector.input_utf8_base64, "base64"), timeoutMs);
    const specified = vector.expected.classification === "SPECIFIED";
    const pass = specified && !observed.process_error && observed.decision === vector.expected.decision;
    observations.push({
      vector_id: vector.id,
      input_sha256: vector.input_sha256,
      expectation_classification: vector.expected.classification,
      expected_decision: vector.expected.decision ?? null,
      observed_decision: observed.decision,
      observed_reason: observed.reason,
      process_error: observed.process_error,
      status: specified ? (pass ? "PASS" : "DIVERGENCE") : "UNSCORED_UNDERSPECIFIED",
    });
  }
  const scored = observations.filter((observation) => observation.expectation_classification === "SPECIFIED");
  const killedBy = scored.filter((observation) => observation.status === "DIVERGENCE").map((observation) => observation.vector_id);
  return {
    id: target.id,
    role: target.role,
    violated_requirement: target.violated_requirement ?? null,
    entry_sha256: sha256(readFileSync(entry)),
    support_file_sha256: target.role === "mutant"
      ? sha256(readFileSync(path.join(TARGETS_DIR, "runtime.mjs")))
      : null,
    infrastructure_failure: null,
    status: target.role === "mutant"
      ? (killedBy.length > 0 ? "KILLED" : "SURVIVED")
      : (killedBy.length === 0 ? "REFERENCE_SATISFIES_SPECIFIED_VECTORS" : "REFERENCE_DIVERGES"),
    scored_vector_count: scored.length,
    scored_accept_count: scored.filter((observation) => observation.expected_decision === "ACCEPT").length,
    scored_reject_count: scored.filter((observation) => observation.expected_decision === "REJECT").length,
    scored_divergence_count: killedBy.length,
    killed_by: killedBy,
    observations,
  };
}

function requirementRows(vectors, mutants) {
  const specified = vectors.filter((vector) => vector.expected.classification === "SPECIFIED");
  const ids = new Set(specified.map((vector) => vector.requirement.id));
  ids.add("REQ-ACCEPT-ONLY-ALL");
  const rows = [];
  for (const id of [...ids].sort()) {
    const applicable = id === "REQ-ACCEPT-ONLY-ALL"
      ? specified.filter((vector) => vector.expected.decision === "REJECT")
      : specified.filter((vector) => vector.requirement.id === id);
    const targeted = mutants.filter((mutant) => mutant.violated_requirement === id);
    rows.push({
      requirement_id: id,
      citation: id === "REQ-ACCEPT-ONLY-ALL"
        ? "profiles/raven-canonical-envelope-1.json#/rules/6"
        : applicable[0]?.requirement.citation ?? null,
      vector_ids: applicable.map((vector) => vector.id),
      mutant_outcomes: targeted.map((mutant) => ({
        mutant_id: mutant.id,
        measured_outcome: mutant.status,
        killed_by_applicable_vectors: mutant.killed_by.filter((vectorId) => applicable.some((vector) => vector.id === vectorId)),
      })),
    });
  }
  return rows;
}

function coverageMarkdown(result) {
  const lines = [
    "# Coverage Matrix",
    "",
    `Frozen corpus: \`${result.pack.corpus_id}@${result.pack.corpus_version}\` (file SHA-256 \`${result.pack.corpus_file_sha256}\`)`,
    "",
    "| Requirement | Vectors | Targeted mutant → measured outcome |",
    "|---|---|---|",
  ];
  for (const row of result.coverage) {
    const mutants = row.mutant_outcomes.length
      ? row.mutant_outcomes.map((item) => `${item.mutant_id} → ${item.measured_outcome}`).join("<br>")
      : "none";
    lines.push(`| \`${row.requirement_id}\` | ${row.vector_ids.map((id) => `\`${id}\``).join(", ")} | ${mutants} |`);
  }
  lines.push(
    "",
    "## Redundancy and Limits",
    "",
    "- `V07` and `V08` are behaviorally redundant for the current allow-extra-fields mutant; both are retained because one is a generic field and one is extension-shaped.",
    "- `V02` and `C02` both catch insertion-order hashing; `C02` provides a smaller nested counterexample paired with negative `C16`.",
    "- Malformed bytes and duplicate-member behavior are measured but unscored because the profile does not specify refusal versus process error or duplicate-member parsing.",
    "- The profile contains no signer or key field, so signer/key representation claims are not applicable and are not invented here.",
    "- Passing this corpus does not establish security, authorization, signer trust, deployment identity, or successful on-chain execution.",
    "",
  );
  return lines.join("\n");
}

export async function evaluatePack(options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pack = loadPack();
  const evaluated = [];
  for (const target of pack.targets) evaluated.push(await evaluateTarget(target, pack.corpus.vectors, timeoutMs));
  const reference = evaluated.find((target) => target.role === "reference");
  const mutants = evaluated.filter((target) => target.role === "mutant");
  const underspecified = pack.corpus.vectors.filter((vector) => vector.expected.classification === "UNDERSPECIFIED");
  const result = {
    schema: "raven-conformance-challenge-result/1",
    generated_at: new Date().toISOString(),
    pack: {
      corpus_id: pack.corpus.id,
      corpus_version: pack.corpus.version,
      corpus_file_sha256: pack.identities.corpus_file_sha256,
      corpus_content_sha256: pack.identities.corpus_content_sha256,
      target_manifest_file_sha256: pack.identities.target_manifest_file_sha256,
      source_profile_file_sha256: pack.identities.source_profile_file_sha256,
      source_baseline_corpus_file_sha256: pack.identities.source_baseline_corpus_file_sha256,
      source_reference_entry_sha256: pack.identities.source_reference_entry_sha256,
      source_mvp_head: pack.corpus.source_mvp_head,
      source_mvp_tree: pack.corpus.source_mvp_tree,
      vector_count: pack.corpus.vectors.length,
      added_vector_count: pack.corpus.vectors.filter((vector) => vector.provenance === "challenge-pack").length,
      scored_vector_count: pack.corpus.vectors.length - underspecified.length,
      underspecified_vector_count: underspecified.length,
      mutant_count: mutants.length,
    },
    vectors: pack.corpus.vectors.map((vector) => ({
      id: vector.id,
      provenance: vector.provenance,
      failure_class: vector.failure_class,
      input_encoding: "utf8_base64",
      input_utf8_base64: vector.input_utf8_base64,
      input_byte_length: vector.input_byte_length,
      input_sha256: vector.input_sha256,
      expected: vector.expected,
      requirement: vector.requirement,
      rationale: vector.rationale,
    })),
    reference,
    mutants,
    coverage: requirementRows(pack.corpus.vectors, mutants),
    surviving_mutants: mutants.filter((mutant) => mutant.status === "SURVIVED").map((mutant) => mutant.id),
    infrastructure_failures: evaluated.filter((target) => target.infrastructure_failure).map((target) => target.id),
    underspecified_cases: underspecified.map((vector) => ({
      vector_id: vector.id,
      citation: vector.requirement.citation,
      reason: vector.requirement.text,
      reference_observation: reference.observations.find((observation) => observation.vector_id === vector.id),
    })),
    judge_visible_divergences: [
      {
        title: "Accept-everything is caught",
        target: "MUTANT_ACCEPT_EVERYTHING",
        evidence: mutants.find((mutant) => mutant.id === "MUTANT_ACCEPT_EVERYTHING")?.killed_by ?? [],
      },
      {
        title: "Refuse-everything is caught by valid controls",
        target: "MUTANT_REFUSE_EVERYTHING",
        evidence: mutants.find((mutant) => mutant.id === "MUTANT_REFUSE_EVERYTHING")?.killed_by ?? [],
      },
      {
        title: "Insertion-order hashing diverges from recursive sorted-key canonicalization",
        target: "MUTANT_HASH_INSERTION_ORDER",
        evidence: mutants.find((mutant) => mutant.id === "MUTANT_HASH_INSERTION_ORDER")?.killed_by ?? [],
      },
    ],
    claim_limitations: [
      "A passing target matches the specified decisions in this named frozen corpus only.",
      "This result does not establish full profile completeness, security, authorization, signer trust, provenance, deployment, or successful on-chain execution.",
      "Malformed-input and duplicate-member observations are descriptive because the current profile leaves them underspecified.",
      "No signer/key representation vectors exist because the named profile has no signer or key field.",
    ],
  };
  if (options.write !== false) {
    mkdirSync(RESULTS_DIR, { recursive: true });
    writeFileSync(path.join(RESULTS_DIR, "measured.json"), `${JSON.stringify(result, null, 2)}\n`);
    writeFileSync(path.join(APP_ROOT, "COVERAGE_MATRIX.md"), `${coverageMarkdown(result)}\n`);
  }
  return result;
}
