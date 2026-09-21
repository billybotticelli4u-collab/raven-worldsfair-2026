#!/usr/bin/env node
/**
 * Clean-clone reproduction CLI.
 * Usage: node src/cli.js --target CONFORMANT_REFERENCE
 *        npm run conform -- --target BROKEN_SUBTLE
 */
import { runConformance, humanView, listProfiles, loadDemoTargets, loadTargets } from "./lib/runner.js";

function parseArgs(argv) {
  const out = {
    target: null,
    profile: "raven-canonical-envelope/1",
    runId: null,
    json: false,
    list: false,
    listAll: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--target" || a === "-t") out.target = argv[++i];
    else if (a === "--profile" || a === "-p") out.profile = argv[++i];
    else if (a === "--run-id") out.runId = argv[++i];
    else if (a === "--json") out.json = true;
    else if (a === "--list") out.list = true;
    else if (a === "--list-all") out.listAll = true;
    else if (a === "--profiles") out.profiles = true;
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

const args = parseArgs(process.argv);
if (args.help) {
  console.log(`raven-conformance CLI

Usage:
  npm run conform -- --profile <NAME> --target <ID>
  npm run conform -- --profile <NAME> --target <ID> --run-id <ID>
  npm run conform -- --profile <NAME> --list
  npm run conform -- --list-all
  npm run conform -- --profiles
  npm run conform -- --profile <NAME> --target <ID> --json
  npm run demo
  npm run replay -- --report <path>
  npm run probes

Demo targets: CONFORMANT_REFERENCE | BROKEN_OBVIOUS | BROKEN_SUBTLE
Solana targets: SOL_CONFORMANT_REFERENCE | SOL_BROKEN_OBVIOUS | SOL_BROKEN_SUBTLE
Probe targets: use npm run probes (not counted as conformance demos)
`);
  process.exit(0);
}

if (args.profiles) {
  console.log(JSON.stringify(listProfiles(), null, 2));
  process.exit(0);
}

if (args.list || args.listAll) {
  const t = args.listAll ? loadTargets(args.profile) : loadDemoTargets(args.profile);
  console.log(JSON.stringify(t, null, 2));
  process.exit(0);
}

if (!args.target) {
  console.error("Missing --target. Try --list or --help.");
  process.exit(2);
}

const report = await runConformance(args.target, { profile: args.profile, runId: args.runId });
if (args.json) {
  const { _written_path, ...rest } = report;
  console.log(JSON.stringify(rest, null, 2));
} else {
  console.log(humanView(report));
  if (report._written_path) console.log(`\nWrote ${report._written_path}`);
}
process.exit(report.summary.overall === "CONFORMANT" ? 0 : 1);
