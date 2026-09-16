import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveIsolation,
  createRunWorkdir,
  cleanupWorkdir,
  restrictedEnv,
  softLimitsDisclosure,
  probeNodePermissions,
  buildNodePermissionArgs,
  spawnIsolated,
} from "../src/lib/isolation.js";
import { writeFileSync, symlinkSync, mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

describe("isolation boundary", () => {
  it("resolves mode honestly for this host", () => {
    const work = createRunWorkdir("iso_test");
    try {
      const iso = resolveIsolation(work);
      assert.ok(["sandbox_exec", "node_permissions", "unavailable", "curated_demo"].includes(iso.mode));
      if (process.platform === "linux") {
        assert.equal(iso.mode, "node_permissions");
        assert.equal(iso.verified, true);
        assert.equal(iso.fail_closed, false);
        assert.ok(iso.verified_controls.includes("deny_fs_write_via_node_permission"));
        assert.ok(iso.verified_controls.includes("deny_child_process_via_node_permission"));
        assert.ok(iso.verified_controls.includes("deny_worker_via_node_permission"));
        assert.ok(iso.verified_controls.includes("allow_fs_read_entry_realpath_only"));
        assert.ok(iso.assumed_controls.includes("network_not_restricted_by_node_permission_model"));
        assert.match(iso.details, /Network is NOT denied/i);
      }
      if (iso.mode === "curated_demo") {
        assert.equal(iso.verified, false);
        assert.ok(iso.assumed_controls.length >= 1);
      }
      if (iso.mode === "sandbox_exec") {
        assert.equal(iso.verified, true);
        assert.ok(iso.verified_controls.includes("deny_network"));
      }
      if (iso.mode === "unavailable") {
        assert.equal(iso.fail_closed, true);
        assert.equal(iso.verified, false);
      }
      assert.ok(!iso.verified_controls.includes("child_process_is_sandbox"));
    } finally {
      cleanupWorkdir(work);
    }
  });

  it("restrictedEnv does not pass canary or credentials", () => {
    process.env.RAVEN_CONFORMANCE_CANARY = "SHOULD_NOT_LEAK";
    process.env.RAVEN_API_KEY = "secret";
    process.env.GITHUB_TOKEN = "gh";
    const env = restrictedEnv();
    assert.equal(env.RAVEN_CONFORMANCE_CANARY, undefined);
    assert.equal(env.RAVEN_API_KEY, "");
    assert.equal(env.GITHUB_TOKEN, "");
    delete process.env.RAVEN_CONFORMANCE_CANARY;
    delete process.env.RAVEN_API_KEY;
    delete process.env.GITHUB_TOKEN;
  });

  it("soft limits disclosed as unverified by default", () => {
    const d = softLimitsDisclosure();
    assert.equal(d.memory_soft_limit, "unverified");
  });

  it("SKIP discloses when sandbox unavailable — never labels unverified as PASS", () => {
    const work = createRunWorkdir("iso_skip");
    try {
      const iso = resolveIsolation(work);
      if (!iso.verified) {
        assert.equal(iso.verified, false);
        assert.ok(["curated_demo", "unavailable"].includes(iso.mode));
      } else {
        assert.ok(["sandbox_exec", "node_permissions"].includes(iso.mode));
      }
    } finally {
      cleanupWorkdir(work);
    }
  });
});

describe("Linux Node permission positive controls", () => {
  it("probe reports denials and unrestricted positive write succeeds", () => {
    if (process.platform === "win32") return;
    const work = createRunWorkdir("perm_probe");
    try {
      const probe = probeNodePermissions(work);
      assert.equal(probe.available, true, probe.reason);
      assert.equal(probe.probe.write, "ERR_ACCESS_DENIED");
      assert.equal(probe.probe.child, "ERR_ACCESS_DENIED");
      assert.equal(probe.probe.worker, "ERR_ACCESS_DENIED");
      assert.equal(probe.positive.write, "ok");
    } finally {
      cleanupWorkdir(work);
    }
  });

  it("spawnIsolated denies fs-write/child/worker; unrestricted node reaches ops", async () => {
    if (process.platform !== "linux") return;
    const work = createRunWorkdir("perm_spawn");
    const scratch = mkdtempSync(path.join(os.tmpdir(), "raven-perm-pos-"));
    try {
      const isolation = resolveIsolation(work);
      assert.equal(isolation.mode, "node_permissions");
      const outside = path.join(scratch, "outside.txt");
      const entry = path.join(work, "hostile.mjs");
      writeFileSync(
        entry,
        `import { writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { Worker } from "node:worker_threads";
const out = ${JSON.stringify(outside)};
const result = { write: null, child: null, worker: null };
try { writeFileSync(out, "escaped"); result.write = "ok"; } catch (e) { result.write = e.code || String(e); }
try { spawn(process.execPath, ["-e", "1"], { stdio: "ignore" }); result.child = "ok"; }
catch (e) { result.child = e.code || String(e); }
try { new Worker("1+1", { eval: true }); result.worker = "ok"; }
catch (e) { result.worker = e.code || String(e); }
process.stdout.write(JSON.stringify({ decision: "ACCEPT", ...result }));
`,
      );
      // Positive control outside restriction
      const pos = spawnSync(process.execPath, [entry], { encoding: "utf8", timeout: 5000 });
      assert.equal(pos.status, 0, pos.stderr);
      const posObs = JSON.parse(pos.stdout);
      assert.equal(posObs.write, "ok");
      assert.equal(posObs.child, "ok");
      assert.equal(posObs.worker, "ok");
      assert.equal(existsSync(outside), true);
      rmSync(outside, { force: true });

      const sandboxed = await spawnIsolated({
        entryAbs: entry,
        inputObj: {},
        workDir: work,
        isolation,
      });
      assert.equal(sandboxed.exitCode, 0, sandboxed.stderr);
      assert.equal(sandboxed.observed.write, "ERR_ACCESS_DENIED");
      assert.equal(sandboxed.observed.child, "ERR_ACCESS_DENIED");
      assert.equal(sandboxed.observed.worker, "ERR_ACCESS_DENIED");
      assert.equal(existsSync(outside), false);
    } finally {
      cleanupWorkdir(work);
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it("realpath allow covers symlink entry; allow decisions use realpath", async () => {
    if (process.platform !== "linux") return;
    const work = createRunWorkdir("perm_symlink");
    try {
      const isolation = resolveIsolation(work);
      const real = path.join(work, "real-target.mjs");
      const link = path.join(work, "link-target.mjs");
      writeFileSync(
        real,
        `process.stdout.write(JSON.stringify({ decision: "ACCEPT", reason: "via_symlink" }));\n`,
      );
      symlinkSync(real, link);
      const built = buildNodePermissionArgs(link);
      assert.equal(built.realEntry, path.resolve(real));
      assert.ok(built.args.includes(`--allow-fs-read=${built.realEntry}`));
      const sandboxed = await spawnIsolated({
        entryAbs: link,
        inputObj: {},
        workDir: work,
        isolation,
      });
      assert.equal(sandboxed.exitCode, 0, sandboxed.stderr);
      assert.equal(sandboxed.observed.decision, "ACCEPT");
    } finally {
      cleanupWorkdir(work);
    }
  });

  it("fail-closed: unavailable isolation never silently broadens permissions", async () => {
    const work = createRunWorkdir("perm_failclosed");
    try {
      const entry = path.join(work, "t.mjs");
      writeFileSync(entry, `process.stdout.write(JSON.stringify({ decision: "ACCEPT" }));\n`);
      const result = await spawnIsolated({
        entryAbs: entry,
        inputObj: {},
        workDir: work,
        isolation: {
          mode: "unavailable",
          verified: false,
          fail_closed: true,
          probe_reason: "forced_test",
          details: "forced",
        },
      });
      assert.equal(result.parseError, "spawn_error");
      assert.match(result.spawn_error, /isolation_fail_closed/);
      assert.equal(result.observed, null);
    } finally {
      cleanupWorkdir(work);
    }
  });

  it("network is not proven contained by permission flags (separate measurement)", async () => {
    if (process.platform !== "linux") return;
    const work = createRunWorkdir("perm_net");
    try {
      const isolation = resolveIsolation(work);
      assert.ok(isolation.assumed_controls.includes("network_not_restricted_by_node_permission_model"));
      const entry = path.join(work, "net.mjs");
      writeFileSync(
        entry,
        `try {
  const r = await fetch("https://example.com");
  process.stdout.write(JSON.stringify({ decision: "ACCEPT", network: "ok", status: r.status }));
} catch (e) {
  process.stdout.write(JSON.stringify({ decision: "ACCEPT", network: "fail", code: e.code || String(e) }));
}
`,
      );
      const sandboxed = await spawnIsolated({
        entryAbs: entry,
        inputObj: {},
        workDir: work,
        isolation,
        timeoutMs: 8000,
      });
      // Measurement only: do not treat either outcome as full containment proof.
      assert.ok(sandboxed.observed?.network === "ok" || sandboxed.observed?.network === "fail");
      assert.match(isolation.details, /Network is NOT denied/i);
    } finally {
      cleanupWorkdir(work);
    }
  });
});
