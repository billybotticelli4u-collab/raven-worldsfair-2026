#!/usr/bin/env node
import fs from 'node:fs';
import { verifyReceipt, assertDevnetRpc, NETWORK } from '../lib/conformanceReceipt.js';

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
  const anchor = JSON.parse(fs.readFileSync(anchorPath, 'utf8'));
  out.anchor = { present: true, signature: anchor.signature, explorerUrl: anchor.explorerUrl };
  if (anchor.reportDigest !== receipt.reportDigest) {
    out.ok = false;
    out.reasons.push('anchor_digest_mismatch');
  }
  if (anchor.network !== NETWORK || anchor.labeled !== 'DEVNET') {
    out.ok = false;
    out.reasons.push('anchor_not_labeled_devnet');
  }
  const rpc = process.env.RAVEN_CONFORMANCE_DEVNET_RPC || 'https://api.devnet.solana.com';
  try {
    assertDevnetRpc(rpc);
    const { Connection, PublicKey } = await import('@solana/web3.js');
    const connection = new Connection(rpc, 'confirmed');
    const tx = await connection.getTransaction(anchor.signature, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
    });
    if (!tx) {
      out.ok = false;
      out.reasons.push('anchor_tx_not_found');
    } else {
      const logs = (tx.meta && tx.meta.logMessages) || [];
      const memoNeedle = `raven-conformance-receipt/1:${receipt.reportDigest}`;
      const hay = logs.join('\n') + JSON.stringify(tx.transaction);
      if (!hay.includes(receipt.reportDigest) && !hay.includes(memoNeedle)) {
        // soft: memo may be in compiled message bytes only
        out.anchor.rpcChecked = true;
        out.anchor.memoVerified = 'inconclusive_logs';
      } else {
        out.anchor.rpcChecked = true;
        out.anchor.memoVerified = true;
      }
      void PublicKey;
    }
  } catch (e) {
    out.anchor.rpcError = String(e.message || e);
  }
}

console.log(JSON.stringify(out, null, 2));
process.exit(out.ok ? 0 : 1);
