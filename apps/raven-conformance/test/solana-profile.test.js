import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import {
  loadCorpus,
  loadDemoTargets,
  loadProfile,
  runConformance,
} from "../src/lib/runner.js";
import { replayReport } from "../src/lib/replay.js";
import { fileSha256 } from "../src/lib/digest.js";
import { APP_ROOT } from "../src/lib/paths.js";

const SOLANA_PROFILE = "raven-solana-txversion-experimental/0";

describe("Solana transaction-version profile", () => {
  it("loads as a second profile with its own targets and corpus", () => {
    const profile = loadProfile(SOLANA_PROFILE);
    const corpus = loadCorpus(SOLANA_PROFILE);
    const targets = loadDemoTargets(SOLANA_PROFILE);

    assert.equal(profile.data.name, SOLANA_PROFILE);
    assert.equal(corpus.data.profile, SOLANA_PROFILE);
    assert.equal(corpus.data.vectors.length, 12);
    assert.ok(corpus.data.vectors.some((vector) => vector.id === "V15_unexpected_input_key"));
    assert.ok(!corpus.data.vectors.some((vector) => vector.id === "V14_malformed_base64"));
    assert.equal(corpus.data.lineage.source_demo_head, "08889b69798ad69a719a2634cabbebb0eb82c5fe");
    assert.equal(corpus.data.lineage.source_demo_tree, "384507c892c83c372eddb2331fabb5fad392ddd4");
    assert.equal(
      corpus.data.lineage.source_corpus_file_sha256,
      "edf533bd64bac1eb00de78833614edd94e190bef437c7f73b80b100e7ea5540e",
    );
    assert.equal(
      corpus.data.lineage.source_corpus_content_digest_sha256,
      "c463a23b9ee3d1e91204e1d2bc9b1a3bf121e97ca9ba00e7a970b8fd97c5aa1a",
    );
    assert.equal(
      corpus.data.lineage.selection_record_package_path,
      "REVIEWS/RAVEN_SOLANA_PROFILE_PROVENANCE_AND_SELECTION_KIMI_2026_09_20.md",
    );
    assert.equal(
      corpus.data.lineage.selection_record_sha256,
      "4586542b491668478167ddc83cb4087e9097ccc4936860ccd7e50c5e50497ee6",
    );
    assert.equal(corpus.digest, corpus.declaredDigest);
    assert.deepEqual(
      targets.map((target) => target.id),
      ["SOL_CONFORMANT_REFERENCE", "SOL_BROKEN_OBVIOUS", "SOL_BROKEN_SUBTLE"],
    );
  });

  it("binds every vector to an explicit source or profile clause", () => {
    const profile = loadProfile(SOLANA_PROFILE);
    const corpus = loadCorpus(SOLANA_PROFILE);
    const requiredFields = [
      "specification",
      "spec_version",
      "spec_digest",
      "section",
      "normative_clause",
      "requirement_level",
      "behaviour_class",
      "expected_outcome",
    ];

    for (const vector of corpus.data.vectors) {
      for (const field of requiredFields) {
        assert.ok(vector[field], `${vector.id} missing ${field}`);
      }
      if (vector.requirement_level === "PROFILE_TRANSPORT") {
        assert.equal(vector.policy_source, "profiles/raven-solana-txversion-experimental-0.json#R1");
        assert.equal(vector.spec_digest, profile.digest);
      } else {
        assert.match(vector.specification, /https:\/\//);
        assert.ok(vector.spec_snapshot, `${vector.id} missing spec_snapshot`);
        assert.match(vector.spec_digest_scope, /committed UTF-8 clause snapshot/);
        assert.equal(fileSha256(path.join(APP_ROOT, vector.spec_snapshot)), vector.spec_digest);
      }
      assert.match(vector.spec_digest, /^[a-f0-9]{64}$/);
      assert.equal(typeof vector.normative_clause, "string");
      assert.ok(vector.normative_clause.length >= 20);
      assert.deepEqual(vector.expected_outcome, vector.expected);
    }

    const sizeCapVector = corpus.data.vectors.find((vector) => vector.id === "V21_v1_size_cap_exceeded");
    assert.equal(Buffer.from(sizeCapVector.input.tx_base64, "base64").length, 4202);
    assert.equal(
      corpus.data.vectors.find((vector) => vector.id === "V15_unexpected_input_key").expected.reason,
      "malformed_input:keys",
    );

    const simdSnapshot = readFileSync(
      path.join(APP_ROOT, "spec-snapshots/simd-0385-transaction-v1-2026-09-20.md"),
      "utf8",
    );
    assert.match(simdSnapshot, /no trailing data after the signatures field/);
    const versionedSnapshot = readFileSync(
      path.join(APP_ROOT, "spec-snapshots/solana-versioned-transactions-2026-09-20.md"),
      "utf8",
    );
    assert.match(versionedSnapshot, /compact-u16 signature-array count/);
    assert.match(versionedSnapshot, /address_table_lookups/);
  });

  it("compares both decision and detected transaction version", async () => {
    const report = await runConformance("SOL_CONFORMANT_REFERENCE", {
      profile: SOLANA_PROFILE,
      write: false,
    });

    assert.equal(report.summary.overall, "CONFORMANT");
    assert.equal(report.summary.pass, report.corpus.vector_count);
    assert.match(report.reproduction.clean_clone, /raven-solana-profile-base-fa205f85\.bundle/);
    assert.match(report.reproduction.clean_clone, /git apply \.\.\/raven-solana-profile-v1\.patch/);
    assert.ok(report.results.some((row) => row.expected.version === "legacy"));
    assert.ok(report.results.some((row) => row.expected.version === 0));
    assert.ok(report.results.some((row) => row.expected.version === 1));
    assert.ok(report.results.every((row) => row.expected.version === row.observed.version));
  });

  it("keeps the reviewed subtle target divergences behavioral", async () => {
    const report = await runConformance("SOL_BROKEN_SUBTLE", {
      profile: SOLANA_PROFILE,
      write: false,
    });

    assert.equal(report.summary.overall, "DIVERGENT");
    assert.deepEqual(
      report.summary.behavioral_divergence_vector_ids,
      ["V03_valid_v1", "V16_valid_v1_two_instructions"],
    );
    assert.deepEqual(report.summary.execution_error_vector_ids, []);
    assert.ok(report.results.every((row) => typeof row.description === "string" && row.description.length > 0));
  });

  it("V15 kills deletion of the exact input-key guard", () => {
    const corpus = loadCorpus(SOLANA_PROFILE);
    const vector = corpus.data.vectors.find((candidate) => candidate.id === "V15_unexpected_input_key");
    assert.ok(vector, "V15 fail-closed input-shape vector is required");

    const sourcePath = path.join(APP_ROOT, "targets/solana/SOL_CONFORMANT_REFERENCE.mjs");
    const source = readFileSync(sourcePath, "utf8");
    const guard = '  if (keys.length !== 1 || keys[0] !== "tx_base64") throw fail("malformed_input:keys");';
    const mutant = source.replace(guard, "  // mutation: exact input-key guard removed");
    assert.notEqual(mutant, source, "guard mutation must change one source site");

    const tempDirectory = mkdtempSync(path.join(os.tmpdir(), "raven-solana-v15-mutant-"));
    const mutantPath = path.join(tempDirectory, "target.mjs");
    writeFileSync(mutantPath, mutant);
    const invoke = (entryPath) => {
      const result = spawnSync(process.execPath, [entryPath], {
        input: `${JSON.stringify(vector.input)}\n`,
        encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout);
    };

    try {
      assert.equal(invoke(sourcePath).decision, "REJECT");
      assert.equal(invoke(mutantPath).decision, "ACCEPT");
    } finally {
      rmSync(tempDirectory, { recursive: true, force: true });
    }
  });

  it("replays a Solana report against the bound profile", async () => {
    const report = await runConformance("SOL_CONFORMANT_REFERENCE", {
      profile: SOLANA_PROFILE,
      write: true,
    });
    try {
      const replay = await replayReport(report._written_path, { write: false });

      assert.equal(replay.ok, true);
      assert.equal(replay.bundle_match, true);
      assert.equal(replay.semantic_match, true);
    } finally {
      rmSync(report._written_path, { force: true });
    }
  });

  it("rejects a report run id that could escape the reports directory", async () => {
    await assert.rejects(
      runConformance("SOL_CONFORMANT_REFERENCE", {
        profile: SOLANA_PROFILE,
        runId: "../outside",
        write: true,
      }),
      (error) => error.code === "INVALID_RUN_ID",
    );
  });
});
