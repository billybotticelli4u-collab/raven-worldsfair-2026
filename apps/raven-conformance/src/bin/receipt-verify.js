#!/usr/bin/env node
import fs from 'node:fs';
import { verifyReceipt, verifyAnchor, NETWORK } from '../lib/conformanceReceipt.js';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const reportPath = arg('--report');
const receiptPath = arg('--receipt');
const anchorPath = arg('--anchor');
if (!reportPath || !receiptPath) {
  console.error('usage: receipt:verify --report <report.json> --receipt <receipt.json> [--anchor <anchor.json>]');
  process.exit(2);
}

const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
const result = verifyReceipt(receipt, reportPath);
const out = {
  ok: result.ok,
  reasons: result.reasons,
  reportDigest: result.digest,
  receiptId: receipt.receiptId,
  network: receipt.network,
  labeled: receipt.network === NETWORK ? 'DEVNET' : receipt.network,
};

if (anchorPath) {
  // Fail closed: any RPC error, missing/failed transaction, wrong cluster, wrong
  // program, or inexact memo bytes makes the whole verification fail (CODEX B3/B4).
  let anchor;
  try {
    anchor = JSON.parse(fs.readFileSync(anchorPath, 'utf8'));
  } catch (e) {
    out.ok = false;
    out.reasons.push(`anchor_unreadable:${e.message}`);
    anchor = null;
  }
  if (anchor) {
    out.anchor = { present: true, signature: anchor.signature, explorerUrl: anchor.explorerUrl };
    const rpc = process.env.RAVEN_CONFORMANCE_DEVNET_RPC || 'https://api.devnet.solana.com';
    let result;
    try {
      const { Connection } = await import('@solana/web3.js');
      const connection = new Connection(rpc, 'confirmed');
      result = await verifyAnchor(receipt, anchor, { connection, rpcUrl: rpc });
    } catch (e) {
      result = { ok: false, reasons: [`anchor_rpc_error:${e.message || e}`], detail: null };
    }
    out.anchor.rpc = rpc;
    out.anchor.verified = result.ok;
    out.anchor.detail = result.detail;
    if (!result.ok) {
      out.ok = false;
      out.reasons.push(...result.reasons);
    }
  }
}

console.log(JSON.stringify(out, null, 2));
process.exit(out.ok ? 0 : 1);
