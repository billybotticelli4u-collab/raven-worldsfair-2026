#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  KEY_ENV,
  loadReport,
  loadKeypair,
  buildBody,
  signBody,
} from '../lib/conformanceReceipt.js';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const reportPath = arg('--report');
if (!reportPath) {
  console.error('usage: receipt:issue --report <report.json> [--out-dir receipts]');
  process.exit(2);
}
const outDir = arg('--out-dir', 'receipts');
fs.mkdirSync(outDir, { recursive: true });

try {
  const { report, digest } = loadReport(reportPath); // validate BEFORE any key use
  const key = loadKeypair();
  const body = buildBody({ digest, report });
  const receipt = signBody(body, key);
  const stem = path.basename(reportPath, path.extname(reportPath));
  const out = path.join(outDir, `${stem}.conformance-receipt.json`);
  fs.writeFileSync(out, JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify({
    ok: true,
    kind: receipt.kind,
    network: receipt.network,
    reportDigest: digest,
    receiptId: receipt.receiptId,
    path: out,
    note: 'DEVNET-capable receipt issued offline; not yet anchored. Digests only — no report body on chain.',
  }, null, 2));
} catch (e) {
  if (e.code === 'MISSING_KEY') {
    console.error(e.message);
    process.exit(2);
  }
  if (e.code === 'INVALID_REPORT') {
    console.error(JSON.stringify({ ok: false, error: 'invalid_report', reasons: e.reasons }));
    process.exit(1);
  }
  console.error(e.message || e);
  process.exit(1);
}
