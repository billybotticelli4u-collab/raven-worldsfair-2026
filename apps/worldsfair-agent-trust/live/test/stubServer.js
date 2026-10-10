// TEST-ONLY local stub of POST /receipt/v1. Binds 127.0.0.1 on an ephemeral
// port and replays bytes it is given (the genuinely signed fixture, or
// test-only receipts built in testOnlySigner.js). It holds no signing key.
// Shape follows Billy 2's dropped hostedReceiptStub helper (1e7a51f).
import http from "node:http";

/**
 * @param {import("node:test").TestContext} t
 * @param {(index: number, req: object) => ({status?: number, body?: string|Buffer,
 *   headers?: Record<string,string>, hang?: boolean})} respond
 */
export async function startStub(t, respond) {
  const requests = [];
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const record = {
        method: req.method,
        url: req.url,
        apiKeyHeader: req.headers["x-api-key"] ?? null,
        contentType: req.headers["content-type"] ?? null,
        headerNames: Object.keys(req.headers),
        body: Buffer.concat(chunks).toString("utf8"),
      };
      requests.push(record);
      const plan = respond(requests.length - 1, record) ?? {};
      if (plan.hang) return; // never answer: exercises the client timeout
      res.writeHead(plan.status ?? 200, { "content-type": "application/json", ...(plan.headers ?? {}) });
      res.end(plan.body ?? "");
    });
  });
  server.on("connection", (s) => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  let closed = false;
  const close = () => new Promise((resolve) => {
    if (closed) return resolve();
    closed = true;
    for (const s of sockets) s.destroy();
    server.close(() => resolve());
  });
  t.after(close);
  return { base: `http://127.0.0.1:${port}`, requests, close, server };
}
