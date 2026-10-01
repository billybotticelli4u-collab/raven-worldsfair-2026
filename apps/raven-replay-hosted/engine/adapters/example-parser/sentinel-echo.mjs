#!/usr/bin/env node
/**
 * Control adapter: ACCEPT with a synthetic sentinel in decoded output.
 * Used to prove default reports do not echo raw payloads/sentinels.
 */
const SENTINEL = 'RAW_SENTINEL_DO_NOT_ECHO_IN_DEFAULT_REPORT_7f3a9c';
const chunks = [];
for await (const c of process.stdin) chunks.push(c);
let req;
try { req = JSON.parse(Buffer.concat(chunks).toString('utf8').trim()); } catch { process.exit(2); }
if (!req || req.schema !== 'raven-replay-adapter-stdin/1') process.exit(2);
process.stdout.write(JSON.stringify({
  decision: 'ACCEPT',
  version: null,
  reason: 'ok:sentinel-echo-control',
  decoded: {
    label: 'sentinel-echo',
    wire: { messageBytes: { $type: 'bytes', encoding: 'base64', data: Buffer.from(SENTINEL).toString('base64') }, signatures: {} },
    echo: SENTINEL,
  },
}) + '\n');
