#!/usr/bin/env node
/**
 * Replay CLI: npm run replay -- --report <path>
 */
import { replayReport } from "../lib/replay.js";

function parseArgs(argv) {
  const out = { report: null, json: true };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--report" || a === "-r") out.report = argv[++i];
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

const args = parseArgs(process.argv);
if (args.help || !args.report) {
  console.log(`Usage: npm run replay -- --report <path-to-report.json>`);
  process.exit(args.help ? 0 : 2);
}

const result = await replayReport(args.report, { write: false });
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
