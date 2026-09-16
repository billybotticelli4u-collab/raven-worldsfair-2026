/**
 * Judge UX — simple HTTP server + static UI (pattern like worldsfair-agent-trust).
 * Local demo only. Do not treat as public production deploy.
 * No arbitrary public code upload — allowlisted manifest targets only.
 */
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  runConformance,
  runAllProbes,
  loadDemoTargets,
  loadProbeTargets,
  loadCorpus,
  loadProfile,
  humanView,
} from "./lib/runner.js";
import { replayReport } from "./lib/replay.js";
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

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8") || "{}";
  return JSON.parse(raw);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${HOST}`);

    if (req.method === "GET" && url.pathname === "/api/build-info") {
      return sendJson(res, 200, readBuildInfo());
    }

    if (req.method === "GET" && url.pathname === "/api/targets") {
      return sendJson(res, 200, { targets: loadDemoTargets() });
    }

    if (req.method === "GET" && url.pathname === "/api/probes") {
      return sendJson(res, 200, { targets: loadProbeTargets() });
    }

    if (req.method === "GET" && url.pathname === "/api/contract") {
      const contractPath = path.join(__dirname, "..", "interface", "raven-conformance-ui-contract-v1.json");
      return sendJson(res, 200, JSON.parse(readFileSync(contractPath, "utf8")));
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
        ui_contract: "raven-conformance-ui-contract/1",
      });
    }

    if (req.method === "POST" && url.pathname === "/api/run") {
      let body;
      try {
        body = await readBody(req);
      } catch {
        return sendJson(res, 400, { error: "invalid_json" });
      }
      const targetId = body.target || "CONFORMANT_REFERENCE";
      const demos = loadDemoTargets().map((t) => t.id);
      if (!demos.includes(targetId)) {
        return sendJson(res, 400, {
          error: "unknown_target",
          message: "Only allowlisted demo targets via /api/run. Use /api/run-probes for probes. No arbitrary upload.",
        });
      }
      const report = await runConformance(targetId, { timeoutMs: body.timeout_ms, runId: body.run_id });
      const { _written_path, ...publicReport } = report;
      return sendJson(res, 200, {
        report: publicReport,
        human: humanView(report),
        written_path: _written_path || null,
      });
    }

    if (req.method === "POST" && url.pathname === "/api/run-probes") {
      const reports = await runAllProbes({ write: true });
      return sendJson(res, 200, {
        probes: reports.map(({ _written_path, ...r }) => ({ ...r, written_path: _written_path || null })),
      });
    }

    if (req.method === "POST" && url.pathname === "/api/replay") {
      let body;
      try {
        body = await readBody(req);
      } catch {
        return sendJson(res, 400, { error: "invalid_json" });
      }
      if (!body.report_path) return sendJson(res, 400, { error: "missing_report_path" });
      const result = await replayReport(body.report_path, { write: false });
      return sendJson(res, result.ok ? 200 : 409, result);
    }

    if (req.method === "GET" || req.method === "HEAD") {
      return serveStatic(req, res);
    }

    res.writeHead(405).end("Method not allowed");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = message.startsWith("unknown_target") ? 400 : 500;
    sendJson(res, code, { error: code === 400 ? "unknown_target" : "server_error", message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`raven-conformance listening on http://${HOST}:${PORT}`);
  console.log("Fair build:", readBuildInfo().fairBuildCommit);
});
