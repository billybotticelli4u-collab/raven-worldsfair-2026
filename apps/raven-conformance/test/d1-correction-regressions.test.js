import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createHash,
} from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  statSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createRunWorkdir,
  cleanupWorkdir,
  probeNodePermissions,
} from "../src/lib/isolation.js";
import {
  runConformance,
  getDeliveryIdentity,
} from "../src/lib/runner.js";
import { FAIR_BUILT, readBuildInfo } from "../src/lib/buildInfo.js";

const APP = fileURLToPath(new URL("..", import.meta.url));
const OLD_BRANCH = "codex/challenge2-disclosure-fixes-2026-09-16";
const OLD_BUNDLE = "challenge2-disclosure-candidate.bundle";

describe("R3 probeNodePermissions argv / marker regression", () => {
  it("positive control creates all markers; entry bytes unchanged; probe dir cleaned", (t) => {
    if (process.platform === "win32") { t.skip("win32: Node permission probe not applicable"); return; }
    const work = createRunWorkdir("r3_probe");
    const sentinelOutside = path.join(work, "must-not-leak.txt");
    try {
      writeFileSync(sentinelOutside, "sentinel");
      const probeDir = path.join(work, "perm-probe");
      // Pre-create nothing; probe owns the dir.
      const result = probeNodePermissions(work);
      assert.equal(result.available, true, result.reason);
      assert.equal(result.probe.write, "ERR_ACCESS_DENIED");
      assert.equal(result.probe.child, "ERR_ACCESS_DENIED");
      assert.equal(result.probe.worker, "ERR_ACCESS_DENIED");
      assert.equal(result.positive.write, "ok");
      assert.equal(result.positive.child, "ok");
      assert.equal(result.positive.worker, "ok");
      assert.ok(result.entry_sha256 && /^[a-f0-9]{64}$/.test(result.entry_sha256));
      // Cleanup must remove the probe directory entirely.
      assert.equal(existsSync(probeDir), false, "perm-probe dir must be removed");
      // No leftover positive artifacts under workdir.
      const leftovers = [];
      const walk = (dir) => {
        for (const name of readdirSync(dir)) {
          const p = path.join(dir, name);
          const st = statSync(p);
          if (st.isDirectory()) walk(p);
          else leftovers.push(path.relative(work, p));
        }
      };
      walk(work);
      assert.deepEqual(
        leftovers.filter((f) => f !== "must-not-leak.txt"),
        [],
        `unexpected leftovers: ${leftovers.join(",")}`,
      );
      assert.equal(readFileSync(sentinelOutside, "utf8"), "sentinel");
    } finally {
      cleanupWorkdir(work);
    }
  });

  it("red→green: argv[1]-as-out mutant overwrites entry; fixed probe does not", (t) => {
    if (process.platform === "win32") { t.skip("win32: Node permission probe not applicable"); return; }
    const scratch = mkdtempSync(path.join(os.tmpdir(), "r3-argv-mutant-"));
    try {
      const entry = path.join(scratch, "entry.mjs");
      const outside = path.join(scratch, "outside.txt");
      const marker = path.join(scratch, "child-marker.txt");
      const broken = `import { writeFileSync } from "node:fs";
const out = process.argv[1];
const marker = process.argv[2];
try { writeFileSync(out, "x"); } catch {}
process.stdout.write(JSON.stringify({ write: "ok" }));
`;
      writeFileSync(entry, broken);
      const before = createHash("sha256").update(readFileSync(entry)).digest("hex");
      const brokenRun = spawnSync(process.execPath, [entry, outside, marker], {
        encoding: "utf8",
        timeout: 5000,
        cwd: scratch,
      });
      assert.equal(brokenRun.status, 0);
      const afterBroken = createHash("sha256").update(readFileSync(entry)).digest("hex");
      assert.notEqual(afterBroken, before, "mutant must overwrite entry.mjs via argv[1]");
      assert.equal(readFileSync(entry, "utf8"), "x");

      // Fixed script embeds paths — entry unchanged, outside created.
      const fixed = `import { writeFileSync } from "node:fs";
const out = ${JSON.stringify(outside)};
try { writeFileSync(out, "x"); } catch {}
process.stdout.write(JSON.stringify({ write: "ok" }));
`;
      writeFileSync(entry, fixed);
      const beforeFixed = createHash("sha256").update(readFileSync(entry)).digest("hex");
      const fixedRun = spawnSync(process.execPath, [entry], {
        encoding: "utf8",
        timeout: 5000,
        cwd: scratch,
      });
      assert.equal(fixedRun.status, 0);
      assert.equal(
        createHash("sha256").update(readFileSync(entry)).digest("hex"),
        beforeFixed,
      );
      assert.equal(existsSync(outside), true);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});

describe("R1 reproduction instructions + About inventory", () => {
  it("fresh report binds C2 release bundle/branch and refuses old disclosure names", async () => {
    const id = getDeliveryIdentity();
    assert.equal(id.bundle, "raven-c2-release-recipe-2026-09-19.bundle");
    assert.equal(id.branch, "codex/c2-release-recipe-2026-09-19");
    assert.notEqual(id.branch, OLD_BRANCH);
    assert.notEqual(id.bundle, OLD_BUNDLE);

    const report = await runConformance("CONFORMANT_REFERENCE", { write: false });
    const repro = report.reproduction.clean_clone;
    assert.equal(typeof repro, "string");
    assert.doesNotMatch(repro, /codex\/challenge2-disclosure-fixes-2026-09-16/);
    assert.doesNotMatch(repro, /challenge2-disclosure-candidate\.bundle/);
    assert.match(repro, /raven-c2-release-recipe-2026-09-19\.bundle/);
    assert.match(repro, /codex\/c2-release-recipe-2026-09-19/);
    assert.match(repro, /git rev-parse HEAD/);
    assert.match(repro, /HEAD\^\{tree\}/);
    assert.match(repro, /AUTHOR-REPORT\.md/);
    assert.match(repro, /DELIVERY-IDENTITY\.json/);
  });

  it("About/build inventory discloses Node permissions — not curated_demo-only for Linux", () => {
    const info = readBuildInfo();
    const runnerLine = FAIR_BUILT.find((x) => /Challenge 1 bounded runner/i.test(x));
    assert.ok(runnerLine, "FAIR_BUILT must include Challenge 1 runner line");
    assert.match(runnerLine, /Node --permission/i);
    assert.match(runnerLine, /not an OS\/kernel sandbox/i);
    assert.match(runnerLine, /Seatbelt|sandbox-exec/i);
    // Must not be the stale curated_demo-only inventory line.
    assert.notEqual(
      runnerLine,
      "Challenge 1 bounded runner: sandbox-exec on Darwin / curated_demo disclosure otherwise",
    );
    assert.ok(info.fairBuilt.includes(runnerLine));
  });

  it("executed clean-clone against delivered bundle asserts branch and HEAD/TREE", (t) => {
    const id = getDeliveryIdentity();
    const bundlePath =
      process.env.C2_DELIVERY_BUNDLE ||
      path.join(APP, "../../..", id.bundle);
    const identityPath =
      process.env.C2_DELIVERY_IDENTITY ||
      path.join(APP, "../../../DELIVERY-IDENTITY.json");

    // Always-on source guard: old disclosure names must stay gone.
    const runnerSrc = readFileSync(path.join(APP, "src/lib/reproduction.js"), "utf8");
    assert.doesNotMatch(runnerSrc, /codex\/challenge2-disclosure-fixes-2026-09-16/);
    assert.doesNotMatch(runnerSrc, /challenge2-disclosure-candidate\.bundle/);
    assert.match(runnerSrc, /raven-c2-release-recipe-2026-09-19\.bundle/);
    assert.match(runnerSrc, /codex\/c2-release-recipe-2026-09-19/);

    if (!existsSync(bundlePath) || !existsSync(identityPath)) {
      t.skip("sealed bundle/identity unavailable; source checks passed, clone execution NOT_EXECUTED");
      return;
    }

    const expected = JSON.parse(readFileSync(identityPath, "utf8"));
    assert.equal(expected.branch, id.branch);
    assert.equal(expected.bundle, id.bundle);
    assert.notEqual(expected.branch, OLD_BRANCH);
    assert.ok(/^[a-f0-9]{40}$/.test(expected.head));
    assert.ok(/^[a-f0-9]{40}$/.test(expected.tree));

    const cloneDir = mkdtempSync(path.join(os.tmpdir(), "d1-repro-clone-"));
    try {
      const clone = spawnSync(
        "git",
        ["clone", "--branch", id.branch, bundlePath, path.join(cloneDir, "repo")],
        { encoding: "utf8", timeout: 60000 },
      );
      assert.equal(clone.status, 0, clone.stderr || clone.stdout);
      const repo = path.join(cloneDir, "repo");
      const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" });
      const tree = spawnSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: repo, encoding: "utf8" });
      assert.equal(head.status, 0, head.stderr);
      assert.equal(tree.status, 0, tree.stderr);
      assert.equal(head.stdout.trim(), expected.head);
      assert.equal(tree.stdout.trim(), expected.tree);
      // Old disclosure branch must not exist in this bundle.
      const branches = spawnSync("git", ["branch", "-a"], { cwd: repo, encoding: "utf8" });
      assert.doesNotMatch(branches.stdout, /codex\/challenge2-disclosure-fixes-2026-09-16/);

      // Also execute the documented branch checkout command shape (must not exit 128).
      const co = spawnSync("git", ["checkout", id.branch], { cwd: repo, encoding: "utf8" });
      assert.equal(co.status, 0, co.stderr);
    } finally {
      rmSync(cloneDir, { recursive: true, force: true });
    }
  });
});
