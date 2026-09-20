#!/usr/bin/env node
/**
 * Ugly-first Solana DEVNET memo anchor for a conformance receipt digest.
 * Requires: RAVEN_CONFORMANCE_RECEIPT_KEYPAIR, network access to devnet RPC.
 * Refuses non-devnet RPCs. Never mainnet.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  KEY_ENV,
  loadKeypair,
  assertDevnetRpc,
  assertDevnetCluster,
  DEVNET_GENESIS_HASH,
  NETWORK,
} from '../lib/conformanceReceipt.js';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const receiptPath = arg('--receipt');
if (!receiptPath) {
  console.error('usage: receipt:anchor --receipt <receipt.json> [--rpc URL]');
  process.exit(2);
}
const rpc = arg('--rpc', process.env.RAVEN_CONFORMANCE_DEVNET_RPC || 'https://api.devnet.solana.com');

try {
  assertDevnetRpc(rpc); // URL pre-check only
  const key = loadKeypair();
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  if (receipt.network !== NETWORK) {
    throw new Error(`receipt.network must be ${NETWORK}`);
  }
  const digest = receipt.reportDigest;
  if (!digest) throw new Error('receipt missing reportDigest');

  const { Connection, Keypair, Transaction, TransactionInstruction, PublicKey, sendAndConfirmTransaction } =
    await import('@solana/web3.js');

  const payer = Keypair.fromSecretKey(Uint8Array.from(key.secretKey64));
  const connection = new Connection(rpc, 'confirmed');
  // Hard gate: cluster identity via genesis hash (not URL string).
  const genesisHash = await assertDevnetCluster(connection, { rpcUrl: rpc });
  const bal = await connection.getBalance(payer.publicKey);
  if (bal < 5000) {
    console.error(`DEVNET balance too low (${bal} lamports). Request airdrop then retry.`);
    console.error(`pubkey: ${payer.publicKey.toBase58()}`);
    process.exit(3);
  }

  // SPL Memo program
  const MEMO = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
  const memo = `raven-conformance-receipt/1:${digest}`;
  const ix = new TransactionInstruction({
    keys: [{ pubkey: payer.publicKey, isSigner: true, isWritable: false }],
    programId: MEMO,
    data: Buffer.from(memo, 'utf8'),
  });
  const tx = new Transaction().add(ix);
  const sig = await sendAndConfirmTransaction(connection, tx, [payer], {
    commitment: 'confirmed',
  });
  const explorerUrl = `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
  const out = {
    labeled: 'DEVNET',
    network: NETWORK,
    genesisHash,
    expectedGenesisHash: DEVNET_GENESIS_HASH,
    rpc,
    reportDigest: digest,
    memo,
    signature: sig,
    explorerUrl,
    payer: payer.publicKey.toBase58(),
    anchoredAt: new Date().toISOString(),
  };
  const stem = path.basename(receiptPath, '.conformance-receipt.json');
  const outPath = path.join(path.dirname(receiptPath), `${stem}.anchor.json`);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');
  console.log(JSON.stringify({ ok: true, ...out, path: outPath }, null, 2));
} catch (e) {
  if (e.code === 'MISSING_KEY') {
    console.error(e.message);
    process.exit(2);
  }
  console.error(e.stack || e.message || e);
  process.exit(1);
}
