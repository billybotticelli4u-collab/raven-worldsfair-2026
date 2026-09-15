#!/usr/bin/env node
/**
 * Clean-clone reproduction CLI.
 * Usage: node src/cli.js --target CONFORMANT_REFERENCE
 *        npm run conform -- --target BROKEN_SUBTLE
 */
import { runConformance, humanView, loadTargets } from "./lib/runner.js";

function parseArgs(argv) {
  const out = { target: null, json: false, list: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--target" || a === "-t") out.target = argv[++i];
    else if (a === "--json") out.json = true;
    else if (a === "--list") out.list = true;
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

const args = parseArgs(process.argv);
if (args.help) {
  console.log(`raven-conformance CLI

Usage:
  npm run conform -- --target <ID>
  npm run conform -- --list
  npm run conform -- --target <ID> --json

Targets: CONFORMANT_REFERENCE | BROKEN_OBVIOUS | BROKEN_SUBTLE
`);
  process.exit(0);
}

if (args.list) {
  console.log(JSON.stringify(loadTargets(), null, 2));
  process.exit(0);
}

if (!args.target) {
  console.error("Missing --target. Try --list or --help.");
  process.exit(2);
}

const report = await runConformance(args.target);
if (args.json) {
  const { _written_path, ...rest } = report;
  console.log(JSON.stringify(rest, null, 2));
} else {
  console.log(humanView(report));
  if (report._written_path) console.log(`\nWrote ${report._written_path}`);
}
process.exit(report.summary.overall === "CONFORMANT" ? 0 : 1);
