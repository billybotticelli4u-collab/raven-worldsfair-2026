#!/usr/bin/env node
/**
 * Run all hostile boundary probes. Not conformance demos.
 */
import { runAllProbes } from "../lib/runner.js";

const reports = await runAllProbes({ write: true });
const rows = reports.map((r) => ({
  id: r.target.id,
  status: r.status,
  boundary: r.boundary,
  isolation_mode: r.isolation.mode,
  verified: r.isolation.verified,
  note: r.evidence?.note || null,
  written: r._written_path || null,
}));
console.log(JSON.stringify({ schema: "raven-conformance-probe-suite/1", probes: rows }, null, 2));
const escapes = rows.filter((r) => r.status === "BOUNDARY_ESCAPE" || r.boundary === "BOUNDARY_ESCAPE");
console.error(`\nProbes: ${rows.length}  ESCAPE-like: ${escapes.length}`);
console.error("Note: child_process alone is not a security sandbox. curated_demo must not claim kernel enforcement.");
process.exit(0);
