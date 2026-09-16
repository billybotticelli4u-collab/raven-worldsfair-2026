import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveIsolation,
  createRunWorkdir,
  cleanupWorkdir,
  restrictedEnv,
  softLimitsDisclosure,
} from "../src/lib/isolation.js";

describe("isolation boundary", () => {
  it("resolves mode honestly for this host", () => {
    const work = createRunWorkdir("iso_test");
    try {
      const iso = resolveIsolation(work);
      assert.ok(["sandbox_exec", "curated_demo"].includes(iso.mode));
      if (process.platform !== "darwin") {
        assert.equal(iso.mode, "curated_demo");
        assert.equal(iso.verified, false);
      }
      if (iso.mode === "curated_demo") {
        assert.equal(iso.verified, false);
        assert.ok(iso.assumed_controls.length >= 1);
      }
      if (iso.mode === "sandbox_exec") {
        assert.equal(iso.verified, true);
        assert.ok(iso.verified_controls.includes("deny_network"));
      }
      // Never claim child_process is a sandbox in verified_controls alone
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
        // Documented skip-style assertion: we do not claim verified isolation
        assert.equal(iso.verified, false);
        assert.equal(iso.mode, "curated_demo");
      } else {
        assert.equal(iso.mode, "sandbox_exec");
      }
    } finally {
      cleanupWorkdir(work);
    }
  });
});
