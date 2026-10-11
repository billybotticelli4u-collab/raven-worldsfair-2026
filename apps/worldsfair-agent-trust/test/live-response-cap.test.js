// Regression for CODEX review 755269e4 (d223799f) F-1: the 64 KiB loopback
// response cap must be enforced while streaming, not after buffering.
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import test from "node:test";

import { MAX_BODY_BYTES } from "../src/live/constants.js";
import { loopbackJson, readResponseCapped } from "../src/live/http.js";

const TOTAL = 32 * 1024 * 1024;          // what the hostile peer tries to send
const CHUNK = 16 * 1024;                  // server write size
const READ_SLACK = 64 * 1024;             // one fetch chunk past the limit, at most
// Server-side writes include what the kernel/socket buffers absorbed, not what the
// client read (that is bounded by READ_SLACK, test 3); a quarter of TOTAL is generous.
const SENT_BOUND = 8 * 1024 * 1024;

async function hostilePeer(t, { declareLength }) {
  const state = { sent: 0, closedEarly: false, finished: false };
  const server = http.createServer(async (_req, res) => {
    res.on("close", () => { if (!res.writableFinished) state.closedEarly = true; });
    const headers = { "content-type": "application/json" };
    if (declareLength) headers["content-length"] = String(TOTAL + 10);
    res.writeHead(200, headers);
    res.write('{"pad":"');
    const chunk = Buffer.alloc(CHUNK, 0x61);
    try {
      while (state.sent < TOTAL && !res.destroyed) {
        const ok = res.write(chunk);
        state.sent += chunk.length;
        if (!ok) await Promise.race([once(res, "drain"), once(res, "close")]);
      }
      if (!res.destroyed) { res.end('"}'); state.finished = true; }
    } catch { state.closedEarly = true; }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); }));
  return { url: `http://127.0.0.1:${server.address().port}/big`, state };
}

async function settle(state) {
  for (let i = 0; i < 100 && !state.closedEarly && !state.finished; i++) await new Promise((r) => setTimeout(r, 20));
}

for (const declareLength of [false, true]) {
  const label = declareLength ? "declared Content-Length" : "chunked, no Content-Length";
  test(`loopbackJson cuts off a 32 MiB peer near the cap (${label})`, async (t) => {
    const peer = await hostilePeer(t, { declareLength });
    const started = Date.now();
    await assert.rejects(loopbackJson(peer.url, { timeoutMs: 10_000 }), /response_too_large/);
    assert.ok(Date.now() - started < 5_000, "refusal must not wait for the whole body");
    await settle(peer.state);
    assert.equal(peer.state.finished, false, "peer must not get to finish its 32 MiB body");
    assert.equal(peer.state.closedEarly, true, "connection must be closed by the client");
    t.diagnostic(`peer write()s accepted: ${peer.state.sent} bytes of ${TOTAL}`);
    assert.ok(peer.state.sent < SENT_BOUND, `peer could push ${peer.state.sent} bytes (bound ${SENT_BOUND})`);
  });
}

test("readResponseCapped reads at most limit + one chunk of a chunked stream", async (t) => {
  const peer = await hostilePeer(t, { declareLength: false });
  const res = await fetch(peer.url);
  const text = await readResponseCapped(res, MAX_BODY_BYTES);
  const n = Buffer.byteLength(text);
  t.diagnostic(`client read ${n} bytes (limit ${MAX_BODY_BYTES})`);
  assert.ok(n > MAX_BODY_BYTES, "over-limit read is returned so the caller refuses it");
  assert.ok(n <= MAX_BODY_BYTES + READ_SLACK, `read ${n} bytes; must be <= limit + ${READ_SLACK}`);
});

test("readResponseCapped refuses a declared oversize Content-Length before reading the body", async (t) => {
  const peer = await hostilePeer(t, { declareLength: true });
  const res = await fetch(peer.url);
  await assert.rejects(readResponseCapped(res, MAX_BODY_BYTES), (e) => e.message === "response_too_large" && e.bytesRead === 0);
});

test("a normal small response still parses", async (t) => {
  const server = http.createServer((_req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end('{"ok":true}'); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => server.close(() => r())));
  const r = await loopbackJson(`http://127.0.0.1:${server.address().port}/`);
  assert.deepEqual(r, { status: 200, json: { ok: true } });
});
