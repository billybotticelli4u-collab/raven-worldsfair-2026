#!/usr/bin/env node
/**
 * Synthetic example parser v1 — demonstrates extension without modifying Raven engine.
 * Not a customer integration or SDK vulnerability claim.
 */
function readAll() {
  return new Promise((resolve) => {
    const c = [];
    process.stdin.on('data', (d) => c.push(d));
    process.stdin.on('end', () => resolve(Buffer.concat(c).toString('utf8')));
  });
}
const raw = await readAll();
let req;
try { req = JSON.parse(raw.trim()); } catch { console.error('bad json'); process.exit(2); }
if (!req || req.schema !== 'raven-replay-adapter-stdin/1' || typeof req.input_base64 !== 'string') {
  console.error('bad schema'); process.exit(2);
}
let bytes;
try {
  bytes = Buffer.from(req.input_base64, 'base64');
  if (bytes.toString('base64') !== req.input_base64) throw new Error();
} catch {
  process.stdout.write(JSON.stringify({ decision: 'REJECT', version: null, reason: 'invalid_input_base64', decoded: null }) + '\n');
  process.exit(0);
}
if (bytes.length < 2) {
  process.stdout.write(JSON.stringify({ decision: 'REJECT', version: null, reason: 'truncated:example_min_length', decoded: null }) + '\n');
  process.exit(0);
}
const version = bytes[0] === 0x80 ? 0 : 'legacy';
process.stdout.write(JSON.stringify({
  decision: 'ACCEPT',
  version,
  reason: 'ok:example-parser-v1',
  decoded: {
    example_parser: 'v1',
    byte_length: bytes.length,
    first_byte: bytes[0],
    label: 'baseline',
  },
}) + '\n');
