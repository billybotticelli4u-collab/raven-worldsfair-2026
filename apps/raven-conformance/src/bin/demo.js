#!/usr/bin/env node
/**
 * One clean-start demo: run CONFORMANT_REFERENCE and print report + isolation disclosure.
 */
import { runConformance, humanView } from "../lib/runner.js";

const report = await runConformance("CONFORMANT_REFERENCE");
console.log(humanView(report));
console.log("\n--- isolation disclosure ---");
console.log(JSON.stringify(report.isolation, null, 2));
if (report._written_path) console.log(`\nWrote ${report._written_path}`);
console.log("\nReplay: npm run replay -- --report " + (report._written_path || "reports/<run_id>.json"));
process.exit(report.summary.overall === "CONFORMANT" ? 0 : 1);
