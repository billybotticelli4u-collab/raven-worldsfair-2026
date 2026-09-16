import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runProbe, runAllProbes, loadProbeTargets } from "../src/lib/runner.js";

describe("hostile probes", () => {
  it("manifest lists eight probes marked probe:true", () => {
    const probes = loadProbeTargets();
    assert.ok(probes.length >= 8);
    for (const p of probes) {
      assert.equal(p.probe, true);
    }
  });

  it("HOSTILE_ENV_CANARY holds (canary not passed)", async () => {
    const r = await runProbe("HOSTILE_ENV_CANARY", { write: false });
    assert.equal(r.status, "BOUNDARY_HOLD");
    assert.equal(r.probe, true);
    assert.ok(r.child_process_is_not_sandbox);
  });

  it("HOSTILE_ENDLESS times out (not PASS)", async () => {
    const r = await runProbe("HOSTILE_ENDLESS", { write: false, timeoutMs: 600 });
    assert.equal(r.status, "TIMEOUT");
    assert.notEqual(r.status, "PASS");
  });

  it("HOSTILE_OUTPUT_FLOOD capped (not PASS)", async () => {
    const r = await runProbe("HOSTILE_OUTPUT_FLOOD", { write: false });
    assert.equal(r.status, "OUTPUT_FLOOD");
  });

  it("HOSTILE_MALFORMED_OUTPUT is INVALID_OUTPUT", async () => {
    const r = await runProbe("HOSTILE_MALFORMED_OUTPUT", { write: false });
    assert.equal(r.status, "INVALID_OUTPUT");
  });

  it("HOSTILE_EXIT_CRASH is TARGET_CRASH not PASS", async () => {
    const r = await runProbe("HOSTILE_EXIT_CRASH", { write: false });
    assert.equal(r.status, "TARGET_CRASH");
  });

  it("HOSTILE_CORPUS_WRITE does not silently PASS", async () => {
    const r = await runProbe("HOSTILE_CORPUS_WRITE", { write: false });
    assert.ok(["BOUNDARY_HOLD", "BOUNDARY_ESCAPE"].includes(r.status));
    // curated_demo may allow writes — that is ESCAPE with evidence, not PASS
    assert.notEqual(r.status, "PASS");
  });

  it("HOSTILE_NETWORK_ATTEMPT produces boundary evidence", async () => {
    const r = await runProbe("HOSTILE_NETWORK_ATTEMPT", { write: false });
    assert.ok(["BOUNDARY_HOLD", "BOUNDARY_ESCAPE"].includes(r.status));
    assert.ok(r.evidence);
    // Without Seatbelt network deny, escape is honest disclosure (incl. node_permissions).
    if (r.isolation.mode === "curated_demo" && r.status === "BOUNDARY_ESCAPE") {
      assert.equal(r.isolation.verified, false);
    }
    if (r.isolation.mode === "node_permissions") {
      assert.ok(r.isolation.assumed_controls.includes("network_not_restricted_by_node_permission_model"));
    }
  });

  it("HOSTILE_CHILD_PERSIST cleanup evidence", async () => {
    const r = await runProbe("HOSTILE_CHILD_PERSIST", { write: false });
    assert.ok(["BOUNDARY_HOLD", "BOUNDARY_ESCAPE"].includes(r.status));
    assert.ok("child_alive_after_cleanup" in r.evidence);
  });

  it("runAllProbes returns suite without labeling unexecuted PASS", async () => {
    const reports = await runAllProbes({ write: false });
    assert.ok(reports.length >= 8);
    for (const r of reports) {
      assert.notEqual(r.status, "PASS");
      assert.ok(r.isolation.mode);
    }
  });
});
