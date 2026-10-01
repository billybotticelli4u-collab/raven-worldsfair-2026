import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";
import { createApi, securityHeaders } from "./api.mjs";
import { runIsolated } from "./sandbox.mjs";

export function startServer({
  port = 8797,
  credentials = {},
  snapshotId = process.env.RAVEN_REPLAY_SNAPSHOT_ID,
  enginePinSha256 = process.env.RAVEN_REPLAY_ENGINE_PIN_SHA256,
} = {}) {
  const origin = "http://127.0.0.1:" + port;
  let minute = 0,
    count = 0,
    inflight = 0;
  const handler = createApi({
    origin,
    runIsolatedFn: async (body) => {
      if (inflight >= 2)
        throw Object.assign(Error(), { code: "EXECUTION_BROKEN" });
      inflight++;
      try {
        return await runIsolated(body, {
          credentials,
          snapshotId,
          enginePinSha256,
        });
      } finally {
        inflight--;
      }
    },
    acquirePermit: async () => {
      const now = Math.floor(Date.now() / 60000);
      if (now !== minute) {
        minute = now;
        count = 0;
      }
      return ++count <= 20;
    },
  });
  const assets = new Map([
    ["/", ["index.html", "text/html; charset=utf-8"]],
    ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
    ["/style.css", ["style.css", "text/css; charset=utf-8"]],
    ["/raven-logo.svg", ["raven-logo.svg", "image/svg+xml"]],
    ["/example.json", ["example.json", "application/json"]],
  ]);
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, origin);
      if (url.pathname.startsWith("/api/")) {
        const request = new Request(url, {
          method: req.method,
          headers: req.headers,
          ...(!["GET", "HEAD"].includes(req.method)
            ? { body: Readable.toWeb(req), duplex: "half" }
            : {}),
        });
        const response = await handler(request);
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(Buffer.from(await response.arrayBuffer()));
        return;
      }
      const asset = assets.get(url.pathname);
      if (!asset || req.method !== "GET") {
        res.writeHead(404, securityHeaders);
        res.end("Not found");
        return;
      }
      const data = readFileSync(
        new URL("../public/" + asset[0], import.meta.url),
      );
      res.writeHead(200, {
        ...securityHeaders,
        "content-type": asset[1],
        "content-security-policy":
          "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
      });
      res.end(data);
    } catch {
      res.writeHead(500, securityHeaders);
      res.end("Service unavailable");
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  server.listen(port, "127.0.0.1");
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  startServer();
