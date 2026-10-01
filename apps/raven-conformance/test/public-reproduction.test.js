// JR-1: the reproduction recipe shown on the Judge UI and stored in every report must work for a
// stranger who has only the public repository, pinned to the commit this instance asserts it was
// built from. Holders of the sealed delivery keep their route in RELEASE-HANDOFF.md.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanCloneRecipe, PUBLIC_REPOSITORY } from "../src/lib/reproduction.js";
import { runConformance } from "../src/lib/runner.js";

const APP = fileURLToPath(new URL("..", import.meta.url));
const PRIVATE = /\.bundle|DELIVERY-IDENTITY\.json|DELIVERY_IDENTITY_MISMATCH|AUTHOR-REPORT\.md/;
const RETIRED = /codex\/challenge2-disclosure-fixes-2026-09-16|challenge2-disclosure-candidate\.bundle|billy-d1-correction|billy\/fair-conformance-mvp/;
const SHA = "527116f7e7b6ae0013a4cc4dd953f9500bcfcfce";

describe("public-repository reproduction recipe", () => {
  it("clones the public repository and pins the asserted build commit", () => {
    const recipe = cleanCloneRecipe("SOL_BROKEN_SUBTLE", "raven-solana-txversion-experimental/0", {
      fairBuildCommit: SHA, commitSource: "platform_asserted", identityStatus: "UNVERIFIED_ASSERTION",
    });
    assert.equal(PUBLIC_REPOSITORY, "https://github.com/billybotticelli4u-collab/raven-worldsfair-2026.git");
    assert.ok(recipe.includes(`git clone ${PUBLIC_REPOSITORY} raven-worldsfair-2026`));
    assert.ok(recipe.includes(`FAIR_BUILD_COMMIT=${SHA}`));
    assert.match(recipe, /platform_asserted, UNVERIFIED_ASSERTION/);
    assert.ok(recipe.includes('git checkout --detach "$FAIR_BUILD_COMMIT"'));
    assert.ok(recipe.includes("git rev-parse HEAD"));
    assert.ok(recipe.includes("git rev-parse 'HEAD^{tree}'"));
    assert.ok(recipe.includes("npm test"));
    assert.ok(recipe.includes("npm run conform -- --profile raven-solana-txversion-experimental/0 --target SOL_BROKEN_SUBTLE"));
    assert.match(recipe, /SOL_BROKEN_SUBTLE intentionally returns exit 1 for V03\/V10\/V16/);
    assert.match(recipe, /RELEASE-HANDOFF\.md/);
    assert.doesNotMatch(recipe, PRIVATE);
    assert.doesNotMatch(recipe, RETIRED);
  });

  it("without a known commit it fails loudly instead of guessing a branch", () => {
    const recipe = cleanCloneRecipe("CONFORMANT_REFERENCE", "raven-canonical-envelope/1", { fairBuildCommit: null, commitSource: "unavailable", identityStatus: "UNKNOWN" });
    assert.doesNotMatch(recipe, /FAIR_BUILD_COMMIT=/);
    assert.ok(recipe.includes(': "${FAIR_BUILD_COMMIT:?'), "a shell guard stops the recipe until the reader sets the commit from /api/build-info");
    assert.match(recipe, /api\/build-info/);
    assert.doesNotMatch(recipe, /git checkout (main|master)\b/);
    assert.ok(recipe.includes("npm run conform -- --target CONFORMANT_REFERENCE"));
    assert.match(recipe, /BROKEN_SUBTLE intentionally returns exit 1 for V07\/V08/);
    assert.doesNotMatch(recipe, PRIVATE);
  });

  it("a live report carries the recipe with this checkout's own commit", async () => {
    const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: APP, encoding: "utf8" }).stdout.trim();
    const report = await runConformance("CONFORMANT_REFERENCE", { write: false });
    const recipe = report.reproduction.clean_clone;
    assert.ok(recipe.includes(`git clone ${PUBLIC_REPOSITORY} raven-worldsfair-2026`));
    assert.ok(recipe.includes(`FAIR_BUILD_COMMIT=${head}`), "pins the commit the identity selection reports for this checkout");
    assert.doesNotMatch(recipe, PRIVATE);
    assert.doesNotMatch(recipe, RETIRED);
  });

  it("the recipe is executable as printed: the guard refuses an unset commit and accepts one", () => {
    const recipe = cleanCloneRecipe("CONFORMANT_REFERENCE", "raven-canonical-envelope/1", { fairBuildCommit: null, commitSource: "unavailable", identityStatus: "UNKNOWN" });
    const guard = recipe.split("\n").find((line) => line.startsWith(': "${FAIR_BUILD_COMMIT:?'));
    assert.ok(guard);
    const dir = mkdtempSync(path.join(os.tmpdir(), "raven-recipe-"));
    try {
      writeFileSync(path.join(dir, "guard.sh"), `set -e\n${guard}\necho ok\n`);
      const unset = spawnSync("sh", ["guard.sh"], { cwd: dir, encoding: "utf8", env: { PATH: process.env.PATH } });
      assert.notEqual(unset.status, 0);
      assert.match(unset.stderr, /api\/build-info/);
      const set = spawnSync("sh", ["guard.sh"], { cwd: dir, encoding: "utf8", env: { PATH: process.env.PATH, FAIR_BUILD_COMMIT: SHA } });
      assert.equal(set.status, 0, set.stderr);
      assert.equal(set.stdout.trim(), "ok");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the handoff and developer documents carry the public route", () => {
    const handoff = readFileSync(path.join(APP, "RELEASE-HANDOFF.md"), "utf8");
    const developer = readFileSync(path.join(APP, "DEVELOPER.md"), "utf8");
    for (const doc of [handoff, developer]) {
      assert.ok(doc.includes(`git clone ${PUBLIC_REPOSITORY} raven-worldsfair-2026`));
      assert.ok(doc.includes('git checkout --detach "$FAIR_BUILD_COMMIT"'));
    }
  });
});
