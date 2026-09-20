// Receipt bridge regressions (CODEX B1–B5, review 79bbdda9 on 2032e0ae).
// Every test here FAILS on 2032e0ae and passes only after the central repair.
// Offline: ephemeral Ed25519 key in a temp dir, mocked RPC connections, no funds.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { cpSync, mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  KIND, NETWORK, KEY_ENV, HTTP_ISSUE_ENV, DEVNET_GENESIS_HASH, MAINNET_GENESIS_HASH, MEMO_PROGRAM_ID,
  validateReportForReceipt, loadKeypair, buildBody, signBody, verifyReceipt, verifyAnchor,
  receiptHttpIssueAllowed, expectedMemoFor, ReceiptValidationError,
  admitReportForIssuance, authenticateReportDerivation, receiptSignerBase58, keyMatchesReceiptSigner, base58Encode,
} from '../src/lib/conformanceReceipt.js';
import { runConformance, computeDeterministicDigest } from '../src/lib/runner.js';
import { sha256Hex } from '../src/lib/digest.js';

const app = fileURLToPath(new URL('..', import.meta.url));
// A GENUINE report produced by this checkout's runner (replays clean). The shipped
// examples/ samples are historical and do not replay against the current target.
let GOOD_REPORT_PATH;
const goodReport = () => JSON.parse(readFileSync(GOOD_REPORT_PATH, 'utf8'));
let tmp, keyPath, key;

before(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'raven-receipt-'));
  const produced = await runConformance('CONFORMANT_REFERENCE', { write: true });
  GOOD_REPORT_PATH = path.join(tmp, 'genuine-report.json');
  cpSync(produced._written_path, GOOD_REPORT_PATH);
  rmSync(produced._written_path, { force: true });
  // Ephemeral Ed25519 seed as a 64-byte Solana-style JSON array (seed||pub).
  const kp = crypto.generateKeyPairSync('ed25519');
  const seed = Buffer.from(kp.privateKey.export({ format: 'jwk' }).d, 'base64url');
  const pub = Buffer.from(kp.publicKey.export({ format: 'jwk' }).x, 'base64url');
  keyPath = path.join(tmp, 'ephemeral-devnet-test-key.json');
  writeFileSync(keyPath, JSON.stringify([...Buffer.concat([seed, pub])]));
  key = loadKeypair(keyPath);
});
after(() => rmSync(tmp, { recursive: true, force: true }));

/** F1 probe: forge every observation, then recompute BOTH self-hashes so static validation passes. */
function selfConsistentForgery() {
  const r = goodReport();
  for (const row of r.results) {
    row.status = 'PASS';
    if (row.observed) { row.observed.decision = row.expected?.decision ?? row.observed.decision; row.observed.reason = 'forged_without_execution'; }
  }
  r.summary = { ...r.summary, overall: 'CONFORMANT', pass: r.results.length, divergence: 0 };
  delete r._written_path;
  const det = computeDeterministicDigest(r);
  r.deterministic_report_sha256 = det;
  r.binding.deterministic_report_sha256 = det;
  const { report_content_digest_sha256, deterministic_report_sha256, ...body } = r;
  r.report_content_digest_sha256 = sha256Hex(JSON.stringify(body, null, 2) + '\n');
  return r;
}

const fabricated = () => ({
  schema: 'raven-conformance-report/1', run_id: 'run_fabricated', summary: { pass: 12, total: 12 },
  results: [{ vector_id: 'V01_x', status: 'PASS' }],
  deterministic_report_sha256: '0'.repeat(64),
  binding: { deterministic_report_sha256: '0'.repeat(64) },
});

// ---------- B1: issuance signs only an integrity-verified report ----------
test('B1 validator: genuine example report accepted; digest equals declared', () => {
  const r = goodReport();
  const { digest } = validateReportForReceipt(r);
  assert.equal(digest, r.deterministic_report_sha256.toLowerCase());
});
test('B1 validator: fabricated all-zero digest rejected before key use', () => {
  assert.throws(() => validateReportForReceipt(fabricated()), (e) =>
    e instanceof ReceiptValidationError && e.code === 'INVALID_REPORT' && e.reasons.some((x) => x.startsWith('integrity:')));
});
test('B1 validator: tampered result body with untouched declared digest rejected', () => {
  const r = goodReport();
  r.results[0].status = r.results[0].status === 'PASS' ? 'BEHAVIORAL_DIVERGENCE' : 'PASS';
  assert.throws(() => validateReportForReceipt(r), /integrity:deterministic_report_sha256/);
});
test('B1 validator: top-level vs binding digest disagreement rejected', () => {
  const r = goodReport();
  r.binding.deterministic_report_sha256 = 'f'.repeat(64);
  assert.throws(() => validateReportForReceipt(r), /deterministic_digest_binding_mismatch/);
});
test('B1 validator: wrong schema / non-object rejected', () => {
  assert.throws(() => validateReportForReceipt({ ...goodReport(), schema: 'other/9' }), /report_schema_mismatch/);
  assert.throws(() => validateReportForReceipt('nope'), /report must be a JSON object/);
  assert.throws(() => validateReportForReceipt([1]), /report must be a JSON object/);
});
test('B1 CLI receipt:issue: fabricated report → exit 1, no receipt written, key untouched', () => {
  const bad = path.join(tmp, 'fabricated.json');
  writeFileSync(bad, JSON.stringify(fabricated()));
  const outDir = path.join(tmp, 'out-bad');
  const r = spawnSync(process.execPath, ['src/bin/receipt-issue.js', '--report', bad, '--out-dir', outDir],
    { cwd: app, env: { ...process.env, [KEY_ENV]: '/nonexistent/key-must-not-be-read.json' }, encoding: 'utf8' });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /invalid_report/);
  assert.equal(existsSync(path.join(outDir, 'fabricated.conformance-receipt.json')), false);
});
test('positive offline path: CLI issue + verify green on the genuine report', () => {
  const outDir = path.join(tmp, 'out-good');
  const r = spawnSync(process.execPath, ['src/bin/receipt-issue.js', '--report', GOOD_REPORT_PATH, '--out-dir', outDir],
    { cwd: app, env: { ...process.env, [KEY_ENV]: keyPath }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const receiptPath = path.join(outDir, 'genuine-report.conformance-receipt.json');
  assert.ok(existsSync(receiptPath));
  assert.equal(JSON.parse(r.stdout).derivation.replayed, true);
  const v = spawnSync(process.execPath, ['src/bin/receipt-verify.js', '--report', GOOD_REPORT_PATH, '--receipt', receiptPath],
    { cwd: app, encoding: 'utf8' });
  assert.equal(v.status, 0, v.stdout + v.stderr);
  assert.equal(JSON.parse(v.stdout).ok, true);
});
test('missing key still refused (exit 2) even for a valid report', () => {
  const env = { ...process.env }; delete env[KEY_ENV];
  const r = spawnSync(process.execPath, ['src/bin/receipt-issue.js', '--report', GOOD_REPORT_PATH, '--out-dir', path.join(tmp, 'out-nokey')],
    { cwd: app, env, encoding: 'utf8' });
  assert.equal(r.status, 2);
});
test('wrong receipt/report binding rejected by verifier', () => {
  const receipt = signBody(buildBody(validateReportForReceipt(goodReport())), key);
  const other = path.join(app, 'examples', 'sample-report-BROKEN_SUBTLE-challenge1.json');
  const v = verifyReceipt(receipt, other);
  assert.equal(v.ok, false);
  assert.ok(v.reasons.includes('report_digest_mismatch'));
});
test('verifier rejects a receipt whose report file is itself fabricated', () => {
  const receipt = signBody(buildBody({ digest: '0'.repeat(64), report: fabricated() }), key);
  const bad = path.join(tmp, 'fabricated-v.json');
  writeFileSync(bad, JSON.stringify(fabricated()));
  const v = verifyReceipt(receipt, bad);
  assert.equal(v.ok, false);
  assert.ok(v.reasons.some((r) => r.startsWith('report_invalid:')));
});

// ---------- B2: HTTP issuance guard ----------
test('B2 guard: default off; production refused; non-loopback bind/peer refused; local allowed', () => {
  const base = { boundHost: '127.0.0.1', remoteAddress: '127.0.0.1' };
  assert.equal(receiptHttpIssueAllowed({ env: {}, ...base }).reason, 'http_issue_disabled');
  assert.equal(receiptHttpIssueAllowed({ env: { [HTTP_ISSUE_ENV]: 'local', VERCEL: '1' }, ...base }).reason, 'http_issue_refused_in_production');
  assert.equal(receiptHttpIssueAllowed({ env: { [HTTP_ISSUE_ENV]: 'local', NODE_ENV: 'production' }, ...base }).reason, 'http_issue_refused_in_production');
  assert.equal(receiptHttpIssueAllowed({ env: { [HTTP_ISSUE_ENV]: 'local' }, boundHost: '0.0.0.0', remoteAddress: '127.0.0.1' }).reason, 'http_issue_requires_loopback_bind');
  assert.equal(receiptHttpIssueAllowed({ env: { [HTTP_ISSUE_ENV]: 'local' }, boundHost: '127.0.0.1', remoteAddress: '203.0.113.9' }).reason, 'http_issue_requires_loopback_peer');
  assert.equal(receiptHttpIssueAllowed({ env: { [HTTP_ISSUE_ENV]: 'local' }, boundHost: '127.0.0.1', remoteAddress: '::ffff:127.0.0.1' }).allowed, true);
  assert.equal(receiptHttpIssueAllowed({ env: { [HTTP_ISSUE_ENV]: 'true' }, ...base }).allowed, false, 'only the literal value "local" enables');
});

async function startServer(extraEnv) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'raven-receipt-http-'));
  for (const name of ['src', 'targets', 'profiles', 'corpus', 'examples', 'public', 'interface', 'package.json']) {
    cpSync(path.join(app, name), path.join(dir, name), { recursive: true });
  }
  mkdirSync(path.join(dir, 'reports'));
  const reservation = net.createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = reservation.address().port; await new Promise((r) => reservation.close(r));
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: dir, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', [KEY_ENV]: keyPath, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stderr.on('data', (d) => { output += d; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start: ${output}`)), 8000);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited ${code}: ${output}`)); });
    child.stdout.on('data', (d) => { output += d; if (/listening|http:\/\//i.test(output)) { clearTimeout(timer); resolve(); } });
  });
  const post = (body) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/api/receipt/issue', method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => {
      let data = ''; res.on('data', (c) => (data += c)); res.on('end', () => resolve({ status: res.statusCode, json: data ? JSON.parse(data) : null }));
    });
    req.on('error', reject); req.end(JSON.stringify(body));
  });
  const stop = async () => { child.kill('SIGTERM'); await once(child, 'exit').catch(() => {}); rmSync(dir, { recursive: true, force: true }); };
  return { post, stop };
}

test('B2 HTTP: route is 404 by default even with a key configured and a valid report', async () => {
  const s = await startServer({});
  try {
    const r = await s.post({ report: goodReport() });
    assert.equal(r.status, 404);
    assert.equal(r.json.reason, 'http_issue_disabled');
  } finally { await s.stop(); }
});
test('B2 HTTP: route is 404 under VERCEL even when local mode is requested', async () => {
  const s = await startServer({ [HTTP_ISSUE_ENV]: 'local', VERCEL: '1' });
  try {
    const r = await s.post({ report: goodReport() });
    // Under VERCEL the pre-existing identity gate refuses the whole server (503
    // identity_unavailable) before the route; if a future change let the request
    // through, the receipt guard must still answer 404. Either way: no receipt.
    assert.ok([404, 503].includes(r.status), String(r.status));
    if (r.status === 404) assert.equal(r.json.reason, 'http_issue_refused_in_production');
    assert.equal(r.json.receipt, undefined);
  } finally { await s.stop(); }
});
test('B1+B2 HTTP local mode: fabricated report → 400 invalid_report; genuine report → 200 signed', async () => {
  const s = await startServer({ [HTTP_ISSUE_ENV]: 'local' });
  try {
    const bad = await s.post({ report: fabricated() });
    assert.equal(bad.status, 400);
    assert.equal(bad.json.error, 'invalid_report');
    const good = await s.post({ report: goodReport() });
    assert.equal(good.status, 200, JSON.stringify(good.json));
    assert.equal(good.json.receipt.kind, KIND);
    assert.equal(good.json.receipt.reportDigest, goodReport().deterministic_report_sha256);
    assert.equal(verifyReceipt(good.json.receipt, GOOD_REPORT_PATH).ok, true);
  } finally { await s.stop(); }
});

// ---------- B3/B4: anchor verification fails closed with exact proof ----------
const SIG = '5'.repeat(88);
function mkReceipt() { return signBody(buildBody(validateReportForReceipt(goodReport())), key); }
const signerB58 = () => receiptSignerBase58(mkReceipt());
function mkAnchor(receipt, over = {}) {
  return { labeled: 'DEVNET', network: NETWORK, genesisHash: DEVNET_GENESIS_HASH, reportDigest: receipt.reportDigest,
    memo: expectedMemoFor(receipt.reportDigest), signature: SIG, payer: receiptSignerBase58(receipt), ...over };
}
const OTHER_KEY = 'J8w7EcfAgQw3xz2tsbSJdU8iSV6qfMnY6UGESzzKJJSY';
function mkTx(memoBytes, { program = MEMO_PROGRAM_ID, err = null, meta = true, signer = signerB58(), numRequired = 1, memoAccounts = [0] } = {}) {
  return {
    meta: meta ? { err, logMessages: ['Program log: irrelevant'] } : null,
    transaction: { message: {
      header: { numRequiredSignatures: numRequired, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 1 },
      staticAccountKeys: [signer, program],
      compiledInstructions: [{ programIdIndex: 1, accountKeyIndexes: memoAccounts, data: Buffer.from(memoBytes, 'utf8') }],
    } },
  };
}
const conn = ({ genesis = DEVNET_GENESIS_HASH, tx, genesisThrows, txThrows } = {}) => ({
  async getGenesisHash() { if (genesisThrows) throw new Error('fetch failed'); return genesis; },
  async getTransaction() { if (txThrows) throw new Error('fetch failed'); return tx; },
});

test('B3: unreachable RPC (genesis probe throws) → ok:false with reason, never fail-open', async () => {
  const receipt = mkReceipt();
  const r = await verifyAnchor(receipt, mkAnchor(receipt), { connection: conn({ genesisThrows: true }), rpcUrl: 'http://127.0.0.1:1/devnet' });
  assert.equal(r.ok, false); assert.match(r.reasons[0], /^anchor_rpc_error:/);
});
test('B3: unreachable RPC on getTransaction → reject', async () => {
  const receipt = mkReceipt();
  const r = await verifyAnchor(receipt, mkAnchor(receipt), { connection: conn({ txThrows: true }) });
  assert.equal(r.ok, false); assert.match(r.reasons[0], /^anchor_rpc_error:/);
});
test('B3: fake signature string rejected before any RPC', async () => {
  const receipt = mkReceipt();
  let called = false;
  const c = { async getGenesisHash() { called = true; return DEVNET_GENESIS_HASH; }, async getTransaction() { called = true; return null; } };
  const r = await verifyAnchor(receipt, mkAnchor(receipt, { signature: 'not-a-real-signature' }), { connection: c });
  assert.equal(r.ok, false); assert.ok(r.reasons.includes('anchor_signature_malformed')); assert.equal(called, false);
});
test('B3: mainnet genesis rejected; unknown genesis rejected', async () => {
  const receipt = mkReceipt(); const memo = expectedMemoFor(receipt.reportDigest);
  const m = await verifyAnchor(receipt, mkAnchor(receipt), { connection: conn({ genesis: MAINNET_GENESIS_HASH, tx: mkTx(memo) }) });
  assert.deepEqual(m.reasons, ['cluster_is_mainnet']);
  const u = await verifyAnchor(receipt, mkAnchor(receipt), { connection: conn({ genesis: 'Unknown1111111111111111111111111111111111111', tx: mkTx(memo) }) });
  assert.deepEqual(u.reasons, ['cluster_genesis_not_devnet']);
});
test('B3: anchor record claiming a non-devnet genesis rejected offline', async () => {
  const receipt = mkReceipt();
  const r = await verifyAnchor(receipt, mkAnchor(receipt, { genesisHash: MAINNET_GENESIS_HASH }), { connection: conn() });
  assert.equal(r.ok, false); assert.ok(r.reasons.includes('anchor_genesis_not_devnet'));
});
test('B3: mainnet-looking RPC URL refused', async () => {
  const receipt = mkReceipt();
  const r = await verifyAnchor(receipt, mkAnchor(receipt), { connection: conn({ tx: mkTx(expectedMemoFor(receipt.reportDigest)) }), rpcUrl: 'https://api.mainnet-beta.solana.com' });
  assert.equal(r.ok, false); assert.match(r.reasons[0], /mainnet/);
});
test('B4: missing transaction rejected', async () => {
  const receipt = mkReceipt();
  const r = await verifyAnchor(receipt, mkAnchor(receipt), { connection: conn({ tx: null }) });
  assert.deepEqual(r.reasons, ['anchor_tx_not_found']);
});
test('B4: failed transaction (meta.err set) and missing meta rejected', async () => {
  const receipt = mkReceipt(); const memo = expectedMemoFor(receipt.reportDigest);
  const f = await verifyAnchor(receipt, mkAnchor(receipt), { connection: conn({ tx: mkTx(memo, { err: { InstructionError: [0, 'Custom'] } }) }) });
  assert.deepEqual(f.reasons, ['anchor_tx_failed_or_meta_missing']);
  const n = await verifyAnchor(receipt, mkAnchor(receipt), { connection: conn({ tx: mkTx(memo, { meta: false }) }) });
  assert.deepEqual(n.reasons, ['anchor_tx_failed_or_meta_missing']);
});
test('B4: wrong program rejected even when bytes match', async () => {
  const receipt = mkReceipt();
  const r = await verifyAnchor(receipt, mkAnchor(receipt), { connection: conn({ tx: mkTx(expectedMemoFor(receipt.reportDigest), { program: '11111111111111111111111111111111' }) }) });
  assert.deepEqual(r.reasons, ['anchor_no_memo_program_instruction']);
});
test('B4: memo bytes must be exact — digest-only memo, prefix-only memo, trailing byte all rejected (was inconclusive_logs)', async () => {
  const receipt = mkReceipt(); const memo = expectedMemoFor(receipt.reportDigest);
  for (const bytes of [receipt.reportDigest, `${KIND}:`, memo + '\n', memo.toUpperCase()]) {
    const r = await verifyAnchor(receipt, mkAnchor(receipt), { connection: conn({ tx: mkTx(bytes) }) });
    assert.deepEqual(r.reasons, ['anchor_memo_bytes_mismatch'], bytes);
  }
});
test('B4: program resolved through an address-lookup table (index beyond static keys) is rejected', async () => {
  const receipt = mkReceipt(); const tx = mkTx(expectedMemoFor(receipt.reportDigest));
  tx.transaction.message.compiledInstructions[0].programIdIndex = 7;
  const r = await verifyAnchor(receipt, mkAnchor(receipt), { connection: conn({ tx }) });
  assert.deepEqual(r.reasons, ['anchor_no_memo_program_instruction']);
});
test('B4: anchor digest / label / memo disagreement rejected offline', async () => {
  const receipt = mkReceipt();
  const d = await verifyAnchor(receipt, mkAnchor(receipt, { reportDigest: 'a'.repeat(64) }), { connection: conn() });
  assert.ok(d.reasons.includes('anchor_digest_mismatch'));
  const l = await verifyAnchor(receipt, mkAnchor(receipt, { labeled: 'MAINNET' }), { connection: conn() });
  assert.ok(l.reasons.includes('anchor_not_labeled_devnet'));
  const m = await verifyAnchor(receipt, mkAnchor(receipt, { memo: 'raven-conformance-receipt/1:' + 'b'.repeat(64) }), { connection: conn() });
  assert.ok(m.reasons.includes('anchor_memo_mismatch'));
});
test('B4 positive: exact DEVNET successful Memo transaction accepted (legacy-shaped and v0-shaped messages)', async () => {
  const receipt = mkReceipt(); const memo = expectedMemoFor(receipt.reportDigest);
  const legacy = await verifyAnchor(receipt, mkAnchor(receipt), { connection: conn({ tx: mkTx(memo) }), rpcUrl: 'https://api.devnet.solana.com' });
  assert.deepEqual(legacy, { ok: true, reasons: [], detail: { genesisHash: DEVNET_GENESIS_HASH, txFound: true, txSucceeded: true, signerBound: true, memoProgram: true, memoExact: true } });
  // v0-shaped: PublicKey-like objects with toBase58 and Uint8Array data
  const v0 = mkTx(memo);
  v0.transaction.message.staticAccountKeys = v0.transaction.message.staticAccountKeys.map((k) => ({ toBase58: () => k }));
  v0.transaction.message.compiledInstructions[0].data = new Uint8Array(Buffer.from(memo, 'utf8'));
  const r = await verifyAnchor(receipt, mkAnchor(receipt), { connection: conn({ tx: v0 }) });
  assert.equal(r.ok, true);
});
test('B3 CLI receipt:verify --anchor: unreachable devnet-looking RPC → exit 1 with rpc reason (was exit 0)', () => {
  const receipt = mkReceipt();
  const receiptPath = path.join(tmp, 'cli.receipt.json'); writeFileSync(receiptPath, JSON.stringify(receipt));
  const anchorPath = path.join(tmp, 'cli.anchor.json'); writeFileSync(anchorPath, JSON.stringify(mkAnchor(receipt)));
  const r = spawnSync(process.execPath, ['src/bin/receipt-verify.js', '--report', GOOD_REPORT_PATH, '--receipt', receiptPath, '--anchor', anchorPath],
    { cwd: app, env: { ...process.env, RAVEN_CONFORMANCE_DEVNET_RPC: 'http://127.0.0.1:1/devnet' }, encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
  assert.ok(out.reasons.some((x) => x.startsWith('anchor_rpc_error:')), JSON.stringify(out.reasons));
  assert.equal(out.anchor.verified, false);
});

// ---------- F1: authenticated derivation (replay before signature) ----------
test('F1: self-consistent forgery passes static validation but is REFUSED at issuance (derivation replay)', async () => {
  const forged = selfConsistentForgery();
  assert.equal(validateReportForReceipt(forged).digest, forged.deterministic_report_sha256, 'static validator alone is fooled (documented)');
  const p = path.join(tmp, 'forged-self-consistent.json'); writeFileSync(p, JSON.stringify(forged));
  await assert.rejects(admitReportForIssuance(p), (e) => e.code === 'INVALID_REPORT' && e.reasons.includes('derivation_semantic_mismatch'));
});
test('F1 CLI: self-consistent forgery → exit 1, no receipt, key untouched', () => {
  const p = path.join(tmp, 'forged-cli.json'); writeFileSync(p, JSON.stringify(selfConsistentForgery()));
  const outDir = path.join(tmp, 'out-forged');
  const r = spawnSync(process.execPath, ['src/bin/receipt-issue.js', '--report', p, '--out-dir', outDir],
    { cwd: app, env: { ...process.env, [KEY_ENV]: '/nonexistent/key-must-not-be-read.json' }, encoding: 'utf8', timeout: 120000 });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /derivation_semantic_mismatch/);
  assert.equal(existsSync(path.join(outDir, 'forged-cli.conformance-receipt.json')), false);
});
test('F1: genuine report replays clean and is admitted', async () => {
  const d = await authenticateReportDerivation(GOOD_REPORT_PATH);
  assert.equal(d.replayed, true);
  assert.equal(d.replay_deterministic_sha256, goodReport().deterministic_report_sha256);
});
test('F1: historical example report (bundle ok, semantic drift) is refused, not signed', async () => {
  await assert.rejects(admitReportForIssuance(path.join(app, 'examples', 'sample-report-CONFORMANT_REFERENCE-challenge1.json')),
    (e) => e.code === 'INVALID_REPORT');
});
test('F1 HTTP local mode: self-consistent forgery → 400 with derivation reason; genuine → 200 with derivation.replayed', async () => {
  const s = await startServer({ [HTTP_ISSUE_ENV]: 'local' });
  try {
    const bad = await s.post({ report: selfConsistentForgery() });
    assert.equal(bad.status, 400); assert.ok(bad.json.reasons.includes('derivation_semantic_mismatch'), JSON.stringify(bad.json));
    const good = await s.post({ report: goodReport() });
    assert.equal(good.status, 200, JSON.stringify(good.json)); assert.equal(good.json.derivation.replayed, true);
  } finally { await s.stop(); }
});

// ---------- F2: signer binding ----------
test('F2: receipt signer base58 derives from SPKI; local key matches its own receipt; foreign key does not', () => {
  const receipt = mkReceipt();
  assert.equal(receiptSignerBase58(receipt), base58Encode(key.publicKey32));
  assert.equal(keyMatchesReceiptSigner(key, receipt), true);
  const other = crypto.generateKeyPairSync('ed25519');
  const seed = Buffer.from(other.privateKey.export({ format: 'jwk' }).d, 'base64url');
  const pub = Buffer.from(other.publicKey.export({ format: 'jwk' }).x, 'base64url');
  const otherPath = path.join(tmp, 'other-key.json'); writeFileSync(otherPath, JSON.stringify([...Buffer.concat([seed, pub])]));
  assert.equal(keyMatchesReceiptSigner(loadKeypair(otherPath), receipt), false);
});
test('F2: anchor payer unrelated to receipt signer rejected offline (no RPC)', async () => {
  const receipt = mkReceipt(); let called = false;
  const c = { async getGenesisHash() { called = true; return DEVNET_GENESIS_HASH; }, async getTransaction() { called = true; return mkTx(expectedMemoFor(receipt.reportDigest)); } };
  const r = await verifyAnchor(receipt, mkAnchor(receipt, { payer: OTHER_KEY }), { connection: c });
  assert.deepEqual(r.reasons, ['anchor_payer_not_receipt_signer']); assert.equal(called, false);
});
test('F2: transaction signed by an unrelated key (payer label correct) rejected', async () => {
  const receipt = mkReceipt();
  const r = await verifyAnchor(receipt, mkAnchor(receipt), { connection: conn({ tx: mkTx(expectedMemoFor(receipt.reportDigest), { signer: OTHER_KEY }) }) });
  assert.deepEqual(r.reasons, ['anchor_tx_not_signed_by_receipt_signer']);
});
test('F2: receipt signer present but not a REQUIRED signer (index beyond numRequiredSignatures) rejected', async () => {
  const receipt = mkReceipt(); const tx = mkTx(expectedMemoFor(receipt.reportDigest));
  tx.transaction.message.staticAccountKeys = [OTHER_KEY, MEMO_PROGRAM_ID, signerB58()];
  tx.transaction.message.compiledInstructions[0].accountKeyIndexes = [2];
  const r = await verifyAnchor(receipt, mkAnchor(receipt), { connection: conn({ tx }) });
  assert.deepEqual(r.reasons, ['anchor_tx_not_signed_by_receipt_signer']);
});
test('F2: exact memo in an instruction whose accounts exclude the signer rejected', async () => {
  const receipt = mkReceipt();
  const r = await verifyAnchor(receipt, mkAnchor(receipt), { connection: conn({ tx: mkTx(expectedMemoFor(receipt.reportDigest), { memoAccounts: [] }) }) });
  assert.deepEqual(r.reasons, ['anchor_memo_account_not_receipt_signer']);
});
test('F2: missing transaction header rejected', async () => {
  const receipt = mkReceipt(); const tx = mkTx(expectedMemoFor(receipt.reportDigest)); delete tx.transaction.message.header;
  const r = await verifyAnchor(receipt, mkAnchor(receipt), { connection: conn({ tx }) });
  assert.deepEqual(r.reasons, ['anchor_tx_header_unreadable']);
});
test('F2 CLI receipt:anchor: invalid receipt → exit 1 before key/RPC; unrelated local key → signer_mismatch before RPC', () => {
  const receipt = mkReceipt();
  const rp = path.join(tmp, 'anchor-cli.receipt.json');
  const tampered = { ...receipt, reportDigest: 'a'.repeat(64) }; writeFileSync(rp, JSON.stringify(tampered));
  const bad = spawnSync(process.execPath, ['src/bin/receipt-anchor.js', '--receipt', rp, '--report', GOOD_REPORT_PATH, '--rpc', 'http://127.0.0.1:1/devnet'],
    { cwd: app, env: { ...process.env, [KEY_ENV]: '/nonexistent/never-read.json' }, encoding: 'utf8', timeout: 60000 });
  assert.equal(bad.status, 1, bad.stderr); assert.match(bad.stderr, /invalid_receipt/);
  writeFileSync(rp, JSON.stringify(receipt));
  const other = crypto.generateKeyPairSync('ed25519');
  const seed = Buffer.from(other.privateKey.export({ format: 'jwk' }).d, 'base64url');
  const pub = Buffer.from(other.publicKey.export({ format: 'jwk' }).x, 'base64url');
  const otherPath = path.join(tmp, 'other-anchor-key.json'); writeFileSync(otherPath, JSON.stringify([...Buffer.concat([seed, pub])]));
  const mis = spawnSync(process.execPath, ['src/bin/receipt-anchor.js', '--receipt', rp, '--report', GOOD_REPORT_PATH, '--rpc', 'http://127.0.0.1:1/devnet'],
    { cwd: app, env: { ...process.env, [KEY_ENV]: otherPath }, encoding: 'utf8', timeout: 60000 });
  assert.equal(mis.status, 1, mis.stderr); assert.match(mis.stderr, /signer_mismatch/); assert.doesNotMatch(mis.stderr, /fetch failed|ECONNREFUSED/);
  const usage = spawnSync(process.execPath, ['src/bin/receipt-anchor.js', '--receipt', rp], { cwd: app, encoding: 'utf8' });
  assert.equal(usage.status, 2, '--report is now required');
});
