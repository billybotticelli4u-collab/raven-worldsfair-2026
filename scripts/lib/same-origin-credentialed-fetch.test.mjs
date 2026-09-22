import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  fetchSameOriginCredentialed,
  originsEqual,
  buildCredentialHeaders,
} from "./same-origin-credentialed-fetch.mjs";

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}
function close(server) {
  return new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
}

test("originsEqual distinguishes ports", () => {
  assert.equal(originsEqual(new URL("http://127.0.0.1:1/"), new URL("http://127.0.0.1:2/")), false);
  assert.equal(originsEqual(new URL("http://127.0.0.1:9/a"), new URL("http://127.0.0.1:9/b")), true);
});

test("cross-origin redirect does not forward credentials or hit sink with them", async () => {
  const sinkHits = [];
  const sink = http.createServer((req, res) => {
    sinkHits.push({
      url: req.url,
      bypass: req.headers["x-vercel-protection-bypass"] || null,
      cookie: req.headers["cookie"] || null,
    });
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("sink");
  });
  const sinkPort = await listen(sink);

  const origin = http.createServer((req, res) => {
    res.writeHead(302, { Location: `http://127.0.0.1:${sinkPort}/stolen` });
    res.end();
  });
  const originPort = await listen(origin);
  const intended = new URL(`http://127.0.0.1:${originPort}/`);
  const creds = buildCredentialHeaders({
    cookie: "session=canary",
    bypass: "CANARY_BYPASS_NOT_REAL",
  });

  await assert.rejects(
    () =>
      fetchSameOriginCredentialed(new URL("/start", intended), {
        intendedOrigin: intended,
        credentialHeaders: creds,
        headers: { "x-vercel-skip-toolbar": "1" },
      }),
    /cross-origin redirect/,
  );

  // Give the event loop a tick; sink must remain untouched.
  await new Promise((r) => setTimeout(r, 25));
  assert.deepEqual(sinkHits, []);

  await close(origin);
  await close(sink);
});

test("same-origin redirect keeps credentials on intended origin only", async () => {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({
      url: req.url,
      bypass: req.headers["x-vercel-protection-bypass"] || null,
    });
    if (req.url === "/a") {
      res.writeHead(302, { Location: "/b" });
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok-b");
  });
  const port = await listen(server);
  const intended = new URL(`http://127.0.0.1:${port}/`);
  const res = await fetchSameOriginCredentialed(new URL("/a", intended), {
    intendedOrigin: intended,
    credentialHeaders: buildCredentialHeaders({ bypass: "CANARY_BYPASS_NOT_REAL" }),
  });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "ok-b");
  assert.equal(seen.length, 2);
  assert.equal(seen[0].bypass, "CANARY_BYPASS_NOT_REAL");
  assert.equal(seen[1].bypass, "CANARY_BYPASS_NOT_REAL");
  await close(server);
});

test("refuses initial URL outside intended origin before any request", async () => {
  let hits = 0;
  const server = http.createServer((_req, res) => {
    hits += 1;
    res.end("x");
  });
  const port = await listen(server);
  const intended = new URL("http://127.0.0.1:9/");
  await assert.rejects(
    () =>
      fetchSameOriginCredentialed(`http://127.0.0.1:${port}/`, {
        intendedOrigin: intended,
        credentialHeaders: buildCredentialHeaders({ bypass: "CANARY" }),
      }),
    /refusing credentialed request|url origin/,
  );
  await new Promise((r) => setTimeout(r, 25));
  assert.equal(hits, 0);
  await close(server);
});
