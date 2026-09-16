/**
 * Judge UX — simple HTTP server + static UI (pattern like worldsfair-agent-trust).
 * Local demo only. Do not treat as public production deploy.
 */
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runConformance, loadTargets, loadCorpus, loadProfile, humanView } from "./lib/runner.js";
import { readBuildInfo } from "./lib/buildInfo.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC = path.join(__dirname, "..", "public");
const PORT = Number(process.env.PORT || 8791);
const HOST = process.env.HOST || "127.0.0.1";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function sendJson(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(payload);
}

function serveStatic(req, res) {
  let urlPath = new URL(req.url || "/", `http://${HOST}`).pathname;
  if (urlPath === "/") urlPath = "/index.html";
  const safe = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC, safe);
  if (!filePath.startsWith(PUBLIC) || !existsSync(filePath)) {
    res.writeHead(404).end("Not found");
    return;
  }
  const ext = path.extname(filePath);
  res.writeHead(200, { "content-type": MIME[ext] || "application/octet-stream" });
  res.end(readFileSync(filePath));
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${HOST}`);

    if (req.method === "GET" && url.pathname === "/api/build-info") {
      return sendJson(res, 200, readBuildInfo());
    }

    if (req.method === "GET" && url.pathname === "/api/targets") {
      return sendJson(res, 200, { targets: loadTargets() });
    }

    if (req.method === "GET" && url.pathname === "/api/meta") {
      const profile = loadProfile();
      const corpus = loadCorpus();
      return sendJson(res, 200, {
        profile: { name: profile.data.name, version: profile.data.version, sha256: profile.digest },
        corpus: {
          id: corpus.data.id,
          version: corpus.data.version,
          sha256: corpus.digest,
          vector_count: corpus.data.vectors.length,
        },
      });
    }

    if (req.method === "POST" && url.pathname === "/api/run") {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const raw = Buffer.concat(chunks).toString("utf8") || "{}";
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        return sendJson(res, 400, { error: "invalid_json" });
      }
      const targetId = body.target || "CONFORMANT_REFERENCE";
      const report = await runConformance(targetId);
      const { _written_path, ...publicReport } = report;
      return sendJson(res, 200, {
        report: publicReport,
        human: humanView(report),
        written_path: _written_path || null,
      });
    }

    if (req.method === "GET" || req.method === "HEAD") {
      return serveStatic(req, res);
    }

    res.writeHead(405).end("Method not allowed");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendJson(res, 500, { error: err.code || "server_error", message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`raven-conformance listening on http://${HOST}:${PORT}`);
  console.log("Fair build:", readBuildInfo().fairBuildCommit);
});
