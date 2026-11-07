import { test } from "node:test";
import assert from "node:assert/strict";
import { ownedId } from "./_isolation.mjs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkReader, explain } from "../check-reader.mjs";
import { runConformance } from "../../raven-conformance/src/lib/runner.js";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const R = (n) => path.join(KIT, "readers", n);
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const ENGINE_TARGETS = path.join(KIT, "..", "raven-conformance", "targets", "solana");

test("reference reader matches all 30 cases and is byte-identical to the engine reference target", async () => {
  const r = await checkReader(R("reference-reader.mjs"), { runId: ownedId("kit-test-reference") });
  assert.equal(r.verdict, "ALL_MATCHED");
  assert.deepEqual(r.counts, { PASS: 30 });
  assert.equal(r.reader.sha256, sha(path.join(ENGINE_TARGETS, "SOL_CONFORMANT_REFERENCE.mjs")));
  assert.equal(r.signed, false);
  assert.equal(r.liveAcquisition, false);
});

test("faulty reader produces exactly the intended V21 size-cap finding", async () => {
  const r = await checkReader(R("faulty-reader-no-size-cap.mjs"), { runId: ownedId("kit-test-faulty") });
  assert.equal(r.verdict, "DIVERGENT");
  assert.deepEqual(r.counts, { PASS: 29, BEHAVIORAL_DIVERGENCE: 1 });
  assert.deepEqual(r.divergent_vector_ids, ["V21_v1_size_cap_exceeded"]);
  const row = r.results.find((x) => x.vector_id === "V21_v1_size_cap_exceeded");
  assert.equal(row.expected.decision, "REJECT");
  assert.equal(row.observed.decision, "ACCEPT");
  assert.equal(row.observed.version, 1);
  assert.match(explain(r), /V21_v1_size_cap_exceeded/);
});

test("unconnected template is reported as not passed, never as a difference or a pass", async () => {
  const r = await checkReader(R("TEMPLATE-connect-your-reader.mjs"), { runId: ownedId("kit-test-template") });
  assert.equal(r.verdict, "NOT_PASSED");
  assert.equal(r.template_not_connected, true);
  assert.equal(r.counts.BEHAVIORAL_DIVERGENCE ?? 0, 0);
  assert.equal(r.counts.TARGET_CRASH, 27);
});

for (const id of ["SOL_CONFORMANT_REFERENCE", "SOL_BROKEN_SUBTLE", "SOL_BROKEN_OBVIOUS"]) {
  test(`kit per-case outcomes equal the unchanged engine for ${id}`, async () => {
    const kit = await checkReader(path.join(ENGINE_TARGETS, `${id}.mjs`), { runId: ownedId(`kit-test-x-${id}`) });
    const eng = await runConformance(id, { profile: "solana", runId: ownedId(`kit-crosscheck-${id}`) });
    assert.deepEqual(kit.results.map((x) => [x.vector_id, x.status]), eng.results.map((x) => [x.vector_id, x.status]));
    assert.equal(kit.profile.sha256, eng.claimed_profile.sha256);
    assert.equal(kit.corpus.sha256, eng.corpus.sha256);
    assert.equal(kit.reader.sha256, eng.target.entry_sha256);
  });
}

test("CLI export equals the run: printed verdict, counts and file hash match the written report", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "raven-kit-"));
  const out = path.join(dir, "faulty.json"), md = path.join(dir, "faulty.md");
  const p = spawnSync(process.execPath, [path.join(KIT, "check-reader.mjs"), "--reader", R("faulty-reader-no-size-cap.mjs"), "--out", out, "--explain", md, "--run-id", ownedId("kit-test-cli")], { encoding: "utf8" });
  assert.equal(p.status, 1, p.stderr);
  const rep = JSON.parse(readFileSync(out, "utf8"));
  assert.match(p.stdout, new RegExp(`verdict: ${rep.verdict} `));
  assert.match(p.stdout, new RegExp(`sha256 ${sha(out)}`));
  assert.match(p.stdout, /BEHAVIORAL_DIVERGENCE V21_v1_size_cap_exceeded: expected REJECT\/null, got ACCEPT\/1/);
  assert.equal(readFileSync(md, "utf8"), explain(rep) + "\n");
});

test("usage errors exit 2", () => {
  const p = spawnSync(process.execPath, [path.join(KIT, "check-reader.mjs"), "--reader", "/nonexistent/x.mjs"], { encoding: "utf8" });
  assert.equal(p.status, 2);
  assert.match(p.stderr, /reader file not found/);
});
