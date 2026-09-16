export const p0 = `/**
 * Judge UX — HTTP server + static UI.
 * Challenge 2 Judge UI endpoints + Challenge 1 engine routes (probes/replay/contract).
 * Local demo only. No arbitrary public code upload.
 */
import http from "node:http";
import { readFileSync, existsSync, readdirSync } from "node:fs";
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
import { adaptReport, classifyResult } from "./lib/displayAdapter.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const APP_ROOT = path.join(__dirname, "..");
const PUBLIC = path.join(APP_ROOT, "public");
const EXAMPLES = path.join(APP_ROOT, "examples");
const REPORTS_DIR = path.join(APP_ROOT, "reports");
const PORT = Number(process.env.PORT || 8791);
const HOST = process.env.HOST || "127.0.0.1";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
};

let activeRun = null;

function sendJson(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(payload);
}

function serveStatic(req, res) {
  let urlPath = new URL(req.url || "/", \`http://\${HOST}\`).pathname;
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

function publicize(report) {
  const { _written_path, ...publicReport } = report;
  const adapted = adaptReport(publicReport, loadProfile().data);
  return {
    report: publicReport,
    human: humanView(report),
    written_path: _written_path || null,
    ui: adapted.ok
      ? {
          counts: adapted.display.counts,
          engine_counts: adapted.display.engine_counts,
          first_issue: adapted.display.first_issue,
          empty: adapted.display.empty,
          all_error: adapted.display.all_error,
          isolation: adapted.display.isolation,
          results: adapted.display.results,
        }
      : { error: adapted.reason },
    source: "live_run",
  };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", \`http://\${HOST}\`);

    if (r`;
