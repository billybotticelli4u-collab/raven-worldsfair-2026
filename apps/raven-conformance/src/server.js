/**
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
          mixed_execution_and_behavioral: adapted.display.mixed_execution_and_behavioral,
          execution_error_vector_ids: adapted.display.execution_error_vector_ids,
          behavioral_divergence_vector_ids: adapted.display.behavioral_divergence_vector_ids,
          skipped_vector_ids: adapted.display.skipped_vector_ids,
          presentation_banner: adapted.display.presentation_banner,
          isolation: adapted.display.isolation,
          results: adapted.display.results,
        }
      : { error: adapted.reason },
    source: "live_run",
  };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${HOST}`);

    if (req.method === "GET" && url.pathname === "/api/build-info") {
      return sendJson(res, 200, readBuildInfo());
    }
    if (req.method === "GET" && url.pathname === "/api/health") {
      return sendJson(res, 200, {
        ok: true,
        engine: "raven-conformance-runner",
        active_run: activeRun ? { target: activeRun.target, started_at: activeRun.startedAt } : null,
      });
    }
    if (req.method === "GET" && url.pathname === "/api/targets") {
      return sendJson(res, 200, { targets: loadDemoTargets() });
    }
    if (req.method === "GET" && url.pathname === "/api/probes") {
      return sendJson(res, 200, { targets: loadProbeTargets() });
    }
    if (req.method === "GET" && url.pathname === "/api/contract") {
      const contractPath = path.join(APP_ROOT, "interface", "raven-conformance-ui-contract-v1.json");
      return sendJson(res, 200, JSON.parse(readFileSync(contractPath, "utf8")));
    }
    if (req.method === "GET" && url.pathname === "/api/meta") {
      const profile = loadProfile();
      const corpus = loadCorpus();
      return sendJson(res, 200, {
        profile: {
          name: profile.data.name,
          version: profile.data.version,
          sha256: profile.digest,
          rules: profile.data.rules || [],
          claimed_conformance_meaning: profile.data.claimed_conformance_meaning || null,
          description: profile.data.description || null,
        },
        corpus: {
          id: corpus.data.id,
          version: corpus.data.version,
          sha256: corpus.digest,
          vector_count: corpus.data.vectors.length,
          scope_note:
            "Raven-owned Fair demo corpus only — self-contained fixtures, not private production corpora.",
        },
        ui_contract: "raven-conformance-ui-contract/1",
      });
    }
    if (req.method === "GET" && url.pathname === "/api/recorded") {
      const files = existsSync(EXAMPLES)
        ? readdirSync(EXAMPLES).filter((f) => f.startsWith("sample-report-") && f.endsWith(".json"))
        : [];
      return sendJson(res, 200, {
        note: "Recorded reports are immutable demo-day fallbacks — not newly executed runs.",
        recordings: files.map((f) => ({
          id: f.replace(/^sample-report-/, "").replace(/\.json$/, ""),
          file: f,
        })),
      });
    }
    if (req.method === "GET" && url.pathname.startsWith("/api/recorded/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/recorded/".length));
      const fileName = `sample-report-${id}.json`;
      const filePath = path.join(EXAMPLES, fileName);
      if (!filePath.startsWith(EXAMPLES) || !existsSync(filePath)) {
        return sendJson(res, 404, { error: "recorded_not_found", id });
      }
      const report = JSON.parse(readFileSync(filePath, "utf8"));
      const adapted = adaptReport(report, loadProfile().data);
      return sendJson(res, 200, {
        source: "recorded_report",
        recorded_label: "RECORDED DEMO REPORT — not a newly executed live run",
        immutable_identity: {
          file: fileName,
          run_id: report.run_id || null,
          report_content_digest_sha256: report.report_content_digest_sha256 || null,
          target_id: report.target?.id || id,
        },
        replay_command:
          report.reproduction?.one_liner ||
          `cd apps/raven-conformance && npm run conform -- --target ${report.target?.id || id}`,
        report,
        ui: adapted.ok
          ? {
              counts: adapted.display.counts,
              first_issue: adapted.display.first_issue,
              empty: adapted.display.empty,
              all_error: adapted.display.all_error,
              mixed_execution_and_behavioral: adapted.display.mixed_execution_and_behavioral,
              execution_error_vector_ids: adapted.display.execution_error_vector_ids,
              behavioral_divergence_vector_ids: adapted.display.behavioral_divergence_vector_ids,
              skipped_vector_ids: adapted.display.skipped_vector_ids,
              presentation_banner: adapted.display.presentation_banner,
              results: adapted.display.results,
            }
          : { error: adapted.reason },
      });
    }
    if (req.method === "GET" && url.pathname.startsWith("/api/report/")) {
      const runId = decodeURIComponent(url.pathname.slice("/api/report/".length));
      if (!/^run_[a-zA-Z0-9]+$/.test(runId)) return sendJson(res, 400, { error: "invalid_run_id" });
      const filePath = path.join(REPORTS_DIR, `${runId}.json`);
      if (!filePath.startsWith(REPORTS_DIR) || !existsSync(filePath)) {
        return sendJson(res, 404, { error: "report_not_found", run_id: runId });
      }
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${runId}.json"`,
        "cache-control": "no-store",
      });
      return res.end(readFileSync(filePath));
    }
    if (req.method === "GET" && url.pathname === "/api/run-stream") {
      const targetId = url.searchParams.get("target");
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        connection: "keep-alive",
      });
      const send = (event, data) => {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };
      if (!targetId) {
        send("error", { error: "missing_target", message: "Query param target is required." });
        return res.end();
      }
      const demos = loadDemoTargets().map((t) => t.id);
      if (!demos.includes(targetId)) {
        send("error", { error: "unknown_target", message: `Unknown or non-demo target: ${targetId}`, target: targetId });
        return res.end();
      }
      if (activeRun) {
        send("error", {
          error: "run_in_progress",
          message: "Another conformance run is already in progress. Wait or retry.",
          active: { target: activeRun.target, started_at: activeRun.startedAt },
        });
        return res.end();
      }
      activeRun = { target: targetId, startedAt: new Date().toISOString() };
      send("status", { phase: "started", type: "run_started", target: targetId, at: activeRun.startedAt });
      try {
        const report = await runConformance(targetId, {
          onProgress: (p) => {
            send("progress", {
              type: "vector_finished",
              index: p.index,
              total: p.total,
              vector_id: p.vector_id || p.result?.vector_id,
              status: p.status || p.result?.status,
              display: classifyResult(p.result || { status: p.status }),
            });
          },
        });
        send("complete", publicize(report));
      } catch (err) {
        send("error", { error: "run_failed", message: err instanceof Error ? err.message : String(err) });
      } finally {
        activeRun = null;
        res.end();
      }
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/run") {
      let body;
      try { body = await readBody(req); } catch { return sendJson(res, 400, { error: "invalid_json" }); }
      const targetId = body.target;
      if (!targetId) return sendJson(res, 400, { error: "missing_target" });
      const demos = loadDemoTargets().map((t) => t.id);
      if (!demos.includes(targetId)) {
        return sendJson(res, 400, {
          error: "unknown_target",
          message: "Only allowlisted demo targets via /api/run. Use /api/run-probes for probes. No arbitrary upload.",
        });
      }
      if (activeRun) {
        return sendJson(res, 409, {
          error: "run_in_progress",
          message: "Another conformance run is already in progress.",
          active: { target: activeRun.target, started_at: activeRun.startedAt },
        });
      }
      activeRun = { target: targetId, startedAt: new Date().toISOString() };
      try {
        const report = await runConformance(targetId, { timeoutMs: body.timeout_ms, runId: body.run_id });
        return sendJson(res, 200, publicize(report));
      } finally {
        activeRun = null;
      }
    }
    if (req.method === "POST" && url.pathname === "/api/run-probes") {
      const reports = await runAllProbes({ write: true });
      return sendJson(res, 200, {
        probes: reports.map(({ _written_path, ...r }) => ({ ...r, written_path: _written_path || null })),
      });
    }
    if (req.method === "POST" && url.pathname === "/api/replay") {
      let body;
      try { body = await readBody(req); } catch { return sendJson(res, 400, { error: "invalid_json" }); }
      if (!body.report_path) return sendJson(res, 400, { error: "missing_report_path" });
      const result = await replayReport(body.report_path, { write: false });
      return sendJson(res, result.ok ? 200 : 409, result);
    }
    if (req.method === "GET" || req.method === "HEAD") return serveStatic(req, res);
    res.writeHead(405).end("Method not allowed");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!res.headersSent) {
      const code = message.startsWith("unknown_target") ? 400 : 500;
      sendJson(res, code, { error: code === 400 ? "unknown_target" : "server_error", message });
    } else {
      try { res.end(); } catch { /* ignore */ }
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log(`raven-conformance listening on http://${HOST}:${PORT}`);
  console.log("Fair build:", readBuildInfo().fairBuildCommit);
});
