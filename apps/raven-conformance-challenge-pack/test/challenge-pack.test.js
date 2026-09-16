import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadPack, evaluatePack } from "../src/evaluate.js";

let resultPromise;
function evaluatedPack() {
  resultPromise ??= evaluatePack({ write: false });
  return resultPromise;
}

describe("Raven Conformance adversarial challenge pack", () => {
  it("freezes at least twelve materially distinct added vectors", () => {
    const pack = loadPack();
    const added = pack.corpus.vectors.filter((vector) => vector.provenance === "challenge-pack");
    assert.ok(added.length >= 12);
    assert.equal(new Set(added.map((vector) => vector.failure_class)).size, added.length);
    for (const vector of pack.corpus.vectors) {
      assert.ok(vector.input_utf8_base64, `${vector.id} must freeze exact input bytes`);
      assert.ok(vector.expected?.classification, `${vector.id} must freeze an expected outcome`);
      assert.ok(vector.requirement?.citation, `${vector.id} must cite a profile requirement`);
      assert.ok(vector.rationale, `${vector.id} must explain why it exists`);
    }
  });

  it("maps every baseline vector without relabeling underspecified behavior", () => {
    const pack = loadPack();
    const baseline = pack.corpus.vectors.filter((vector) => vector.provenance === "mvp-baseline");
    assert.deepEqual(
      baseline.map((vector) => vector.id),
      [
        "V01_valid_minimal",
        "V02_valid_nested",
        "V03_digest_mismatch",
        "V04_schema_mismatch",
        "V05_missing_digest",
        "V06_empty_id",
        "V07_unexpected_top_level_field",
        "V08_unexpected_extension_key",
        "V09_payload_not_object",
        "V10_missing_schema",
      ],
    );
    assert.ok(pack.corpus.vectors.some((vector) => vector.expected.classification === "UNDERSPECIFIED"));
  });

  it("loads distinct semantic mutants including accept-all and refuse-all", () => {
    const pack = loadPack();
    const mutants = pack.targets.filter((target) => target.role === "mutant");
    assert.ok(mutants.length >= 6);
    assert.equal(new Set(mutants.map((target) => target.violated_requirement)).size, mutants.length);
    assert.ok(mutants.some((target) => target.id === "MUTANT_ACCEPT_EVERYTHING"));
    assert.ok(mutants.some((target) => target.id === "MUTANT_REFUSE_EVERYTHING"));
  });

  it("reference passes controls and every loadable mutant is killed", async () => {
    const result = await evaluatedPack();
    assert.equal(result.reference.infrastructure_failure, null);
    assert.equal(result.reference.scored_divergence_count, 0);
    assert.ok(result.reference.scored_accept_count > 0);
    assert.ok(result.reference.scored_reject_count > 0);
    assert.equal(result.mutants.some((mutant) => mutant.infrastructure_failure), false);
    assert.equal(result.mutants.every((mutant) => mutant.status === "KILLED"), true);
  });

  it("emits requirement-vector-mutant coverage and no certification claim", async () => {
    const result = await evaluatedPack();
    assert.ok(result.coverage.length >= 7);
    assert.ok(result.coverage.every((row) => row.vector_ids.length > 0));
    assert.match(result.claim_limitations.join("\n"), /does not establish/i);
    assert.doesNotMatch(JSON.stringify(result), /certified secure/i);
  });
});
