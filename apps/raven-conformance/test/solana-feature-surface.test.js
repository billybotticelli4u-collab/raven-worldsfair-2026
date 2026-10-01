import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCorpus } from "../src/lib/runner.js";

const APP = fileURLToPath(new URL("..", import.meta.url));
const ROOT = path.resolve(APP, "../..");
const PROFILE = "raven-solana-txversion-experimental/0";
const SOURCE_IDS = Array.from({ length: 26 }, (_, index) => `V${String(index + 1).padStart(2, "0")}_`);

describe("usable Solana feature surface", () => {
  it("makes profile selection and replay explicit in the Judge UI", () => {
    const html = readFileSync(path.join(APP, "public/index.html"), "utf8");
    const app = readFileSync(path.join(APP, "public/app.js"), "utf8");

    assert.match(html, /id="profileRow"/);
    assert.match(html, /id="replayBtn"/);
    assert.match(html, /id="replayStatus"/);
    assert.match(app, /fetch\("\/api\/profiles"\)/);
    assert.match(app, /\/api\/targets\?profile=/);
    assert.match(app, /\/api\/meta\?profile=/);
    assert.match(app, /\/api\/run-stream\?profile=/);
    assert.match(app, /fetch\("\/api\/replay"/);
  });

  it("ships a complete, disjoint 26-vector coverage inventory plus four Raven-local additions", () => {
    const inventory = JSON.parse(
      readFileSync(path.join(APP, "SOLANA_COVERAGE_INVENTORY.json"), "utf8"),
    );
    const integrated = loadCorpus(PROFILE).data;
    const included = new Set(inventory.included_from_source.map(row => row.source_id));
    const omitted = new Set(inventory.omitted_from_source.map(row => row.source_id));
    const local = new Set(inventory.raven_local_additions.map(row => row.id));

    assert.equal(inventory.source_vector_count, 26);
    assert.equal(included.size, 26);
    assert.equal(omitted.size, 0);
    assert.equal(local.size, 4);
    assert.deepEqual([...local], ["V15_unexpected_input_key", "LAB01_legacy_unsigned_overflow", "LAB02_v1_unsigned_overflow", "LAB03_v1_required_accounts"]);
    const inventoriedSourceIds = [...included, ...omitted];
    assert.equal(inventoriedSourceIds.length, 26);
    for (const prefix of SOURCE_IDS) {
      assert.equal(inventoriedSourceIds.filter(id => id.startsWith(prefix)).length, 1, prefix);
    }
    assert.deepEqual([...included].filter(id => omitted.has(id)), []);
    assert.deepEqual(
      new Set([...included, ...local]),
      new Set(integrated.vectors.map(row => row.id)),
    );
  });

  it("retains every original source input and expectation under the pinned source hash", () => {
    const bytes = readFileSync(path.join(APP, "corpus/source/raven-solana-txversion-demo-corpus-1.json"));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), "edf533bd64bac1eb00de78833614edd94e190bef437c7f73b80b100e7ea5540e");
    const source = JSON.parse(bytes);
    const rows = new Map(loadCorpus(PROFILE).data.vectors.map(row => [row.id, row]));
    for (const original of source.vectors) {
      assert.ok(rows.has(original.id), `Lost source coverage: ${original.id}`);
      assert.deepEqual(rows.get(original.id).input, original.input, original.id);
      assert.deepEqual(rows.get(original.id).expected, original.expected, original.id);
    }
  });

  it("runs the developer adapter against all 30 integrated vectors", () => {
    const corpus = loadCorpus(PROFILE).data;
    const adapter = path.join(APP, "examples/solana-developer-adapter.mjs");
    for (const vector of corpus.vectors) {
      const result = spawnSync(process.execPath, [adapter], {
        input: `${JSON.stringify(vector.input)}\n`,
        encoding: "utf8",
      });
      assert.equal(result.status, 0, `${vector.id}: ${result.stderr}`);
      const observed = JSON.parse(result.stdout);
      assert.equal(observed.decision, vector.expected.decision, vector.id);
      assert.equal(observed.version, vector.expected.version, vector.id);
    }
  });

  it("includes a CI example that runs both profiles and proves the exact Solana divergence", () => {
    const workflow = readFileSync(path.join(ROOT, ".github/workflows/solana-profile-example.yml"), "utf8");
    assert.match(workflow, /--profile solana --target SOL_CONFORMANT_REFERENCE/);
    assert.match(workflow, /--profile solana --target SOL_BROKEN_SUBTLE/);
    assert.match(workflow, /V03_valid_v1/);
    assert.match(workflow, /V16_valid_v1_two_instructions/);
    assert.match(workflow, /--profile raven-envelope --target CONFORMANT_REFERENCE/);
    assert.match(workflow, /npm test/);
  });

  it("documents a bootstrap compatible with the current delivery identity", () => {
    const developer = readFileSync(path.join(APP, "DEVELOPER.md"), "utf8");

    assert.match(developer, /raven-solana-coverage-repair\.bundle/);
    assert.match(developer, /id\.head!==head/);
    assert.match(developer, /id\.tree!==tree/);
    assert.doesNotMatch(developer, /git apply/);
  });
});
