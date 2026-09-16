/**
 * Judge UX — HTTP server + static UI.
 * Challenge 2 Judge UI endpoints + Challenge 1 engine routes (probes/replay/contract).
 * Local demo only. No arbitrary public code upload.
 */
import http from "node:http";
import { randomUUID } from "node:crypto";
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
import { REPORTS_DIR } from "./lib/paths.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const APP_ROOT = path.join(__dirname, "..");
const PUBLIC = path.join(APP_ROOT, "public");
const EXAMPLES = path.join(APP_ROOT, "examples");
const CONTRACT_JSON = path.join(APP_ROOT, "interface", "raven-conformance-ui-contract-v1.json");
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
  const filePath = path.resolve(PUBLIC, `.${urlPath}`);
  if (!(filePath === PUBLIC || filePath.startsWith(`${PUBLIC}${path.sep}`)) || !existsSync(filePath)) {
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

function runId(prefix = "run") {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

function normalizeReport(report) {
  const { _written_path, ...publicReport } = report;
  return { publicReport, writtenPath: _written_path || null };
}

function publicize(report, source = "live_run") {
  const profile = loadProfile().data;
  const { publicReport, writtenPath } = normalizeReport(report);
  const adapted = adaptReport(publicReport, profile);
  const fallbackResults = (publicReport.results || []).map((result) => ({
    ...result,
    display: classifyResult(result),
  }));
  return {
    report: publicReport,
    human: humanView(report),
    written_path: writtenPath,
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
      : {
          error: adapted.reason,
          counts: null,
          engine_counts: publicReport.summary?.counts || null,
          first_issue: null,
          empty: !(publicReport.results || []).length,
          all_error: false,
          isolation: publicReport.isolation || null,
          results: fallbackResults,
        },
    source,
  };
}

function sanitizeId(value) {
  if (typeof value !== "string") return null;
  return /^[A-Za-z0-9._-]+$/.test(value) ? value : null;
}

function readJson(absPath) {
  return JSON.parse(readFileSync(absPath, "utf8"));
}

function listRecordedReports() {
  if (!existsSync(EXAMPLES)) return [];
  return readdirSync(EXAMPLES)
    .filter((name) => name.startsWith("sample-report-") && name.endsWith(".json"))
    .map((name) => {
      const abs = path.join(EXAMPLES, name);
      const report = readJson(abs);
      if (report?.schema !== "raven-conformance-report/1") return null;
      const id = report.target?.id || name.replace(/^sample-report-/, "").replace(/\.json$/, "");
      return {
        id,
        file: name,
        run_id: report.run_id,
        target_id: report.target?.id || null,
        overall: report.summary?.overall || null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.id.localeCompare(b.id));
}

function loadRecordedReport(id) {
  const safe = sanitizeId(id);
  if (!safe) return null;
  const candidates = [
    path.join(EXAMPLES, `${safe}.json`),
    path.join(EXAMPLES, `sample-report-${safe}.json`),
    path.join(EXAMPLES, `sample-report-${safe}-challenge1.json`),
  ];
  for (const abs of candidates) {
    if (existsSync(abs)) return { path: abs, report: readJson(abs) };
  }
  for (const meta of listRecordedReports()) {
    if (meta.id === safe || meta.file.replace(/\.json$/, "") === safe || meta.run_id === safe) {
      const abs = path.join(EXAMPLES, meta.file);
      return { path: abs, report: readJson(abs) };
    }
  }
  return null;
}

function loadSavedReport(runIdValue) {
  const safe = sanitizeId(runIdValue);
  if (!safe) return null;
  const abs = path.join(REPORTS_DIR, `${safe}.json`);
  if (!existsSync(abs)) return null;
  return { path: abs, report: readJson(abs) };
}

function parseTargetId(candidate) {
  const demos = loadDemoTargets();
  const targetId = candidate || demos[0]?.id || null;
  const target = demos.find((entry) => entry.id === targetId) || null;
  return { targetId, target, demos };
}

async function executeLiveRun({ targetId, timeoutMs, suppliedRunId, signal, onProgress }) {
  const lockRunId = suppliedRunId || runId("run");
  if (activeRun) {
    const err = new Error("run_in_progress");
    err.code = "run_in_progress";
    err.status = 409;
    err.active_run_id = activeRun.runId;
    throw err;
  }
  const { target } = parseTargetId(targetId);
  if (!target) {
    const err = new Error(`unknown_target:${targetId}`);
    err.code = "unknown_target";
    err.status = 400;
    throw err;
  }

  activeRun = { runId: lockRunId, targetId: target.id, startedAt: Date.now() };
  try {
    return await runConformance(target.id, {
      runId: lockRunId,
      timeoutMs,
      signal,
      onProgress,
    });
  } finally {
    activeRun = null;
  }
}

function beginSse(res) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive",
  });
  res.write(": raven-conformance-live\n\n");
}

function sendSse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${HOST}`);

    if (req.method === "GET" && url.pathname === "/api/health") {
      return sendJson(res, 200, {
        ok: true,
        active_run: activeRun,
        demo_targets: loadDemoTargets().length,
        probe_targets: loadProbeTargets().length,
        recorded_reports: listRecordedReports().length,
      });
    }

    if (req.method === "GET" && url.pathname === "/api/build-info") {
      return sendJson(res, 200, readBuildInfo());
    }

    if (req.method === "GET" && url.pathname === "/api/targets") {
      return sendJson(res, 200, { targets: loadDemoTargets() });
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

    if (req.method === "GET" && url.pathname === "/api/contract") {
      return sendJson(res, 200, readJson(CONTRACT_JSON));
    }

    if (req.method === "GET" && url.pathname === "/api/recorded") {
      return sendJson(res, 200, { recorded: listRecordedReports() });
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/recorded/")) {
      const recordId = decodeURIComponent(url.pathname.slice("/api/recorded/".length));
      const loaded = loadRecordedReport(recordId);
      if (!loaded) return sendJson(res, 404, { error: "recorded_not_found" });
      const payload = publicize(loaded.report, "recorded_demo_report");
      const replay = url.searchParams.get("replay") === "1"
        ? await replayReport(loaded.path, { write: false })
        : null;
      return sendJson(res, 200, { ...payload, recorded_id: recordId, replay });
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/report/")) {
      const reportId = decodeURIComponent(url.pathname.slice("/api/report/".length));
      const loaded = loadSavedReport(reportId);
      if (!loaded) return sendJson(res, 404, { error: "report_not_found" });
      const payload = publicize(loaded.report, "saved_live_report");
      const replay = url.searchParams.get("replay") === "1"
        ? await replayReport(loaded.path, { write: false })
        : null;
      return sendJson(res, 200, { ...payload, replay });
    }

    if (req.method === "GET" && url.pathname === "/api/probes") {
      const reports = await runAllProbes({ write: false });
      return sendJson(res, 200, {
        targets: loadProbeTargets(),
        reports,
      });
    }

    if (req.method === "GET" && url.pathname === "/api/run-stream") {
      beginSse(res);
      const { targetId, target } = parseTargetId(url.searchParams.get("target"));
      const timeoutMs = url.searchParams.has("timeout_ms") ? Number(url.searchParams.get("timeout_ms")) : undefined;
      const suppliedRunId = sanitizeId(url.searchParams.get("run_id")) || runId("run");
      const controller = new AbortController();
      req.on("close", () => controller.abort());

      if (!target) {
        sendSse(res, { type: "error", run_id: suppliedRunId, code: "unknown_target", message: `unknown_target:${targetId}` });
        return res.end();
      }
      if (activeRun) {
        sendSse(res, {
          type: "error",
          run_id: suppliedRunId,
          code: "run_in_progress",
          message: "another run is already active",
          active_run_id: activeRun.runId,
        });
        return res.end();
      }

      sendSse(res, { type: "run_started", run_id: suppliedRunId, target: target.id });
      try {
        const report = await executeLiveRun({
          targetId: target.id,
          timeoutMs,
          suppliedRunId,
          signal: controller.signal,
          onProgress(event) {
            sendSse(res, {
              ...event,
              display: event.result ? classifyResult(event.result) : null,
            });
          },
        });
        const payload = publicize(report, "live_run");
        sendSse(res, {
          type: "run_finished",
          run_id: payload.report.run_id,
          overall: payload.report.summary?.overall || null,
          payload,
        });
      } catch (err) {
        sendSse(res, {
          type: "error",
          run_id: suppliedRunId,
          code: err?.code || "server_error",
          message: err instanceof Error ? err.message : String(err),
          status: err?.status || 500,
        });
      }
      return res.end();
    }

    if (req.method === "POST" && url.pathname === "/api/run") {
      let body;
      try {
        body = await readBody(req);
      } catch {
        return sendJson(res, 400, { error: "invalid_json" });
      }
      const { targetId, target } = parseTargetId(body.target);
      if (!target) return sendJson(res, 400, { error: "unknown_target", message: `unknown_target:${targetId}` });
      if (activeRun) {
        return sendJson(res, 409, {
          error: "run_in_progress",
          message: "another run is already active",
          active_run_id: activeRun.runId,
        });
      }
      try {
        const report = await executeLiveRun({
          targetId: target.id,
          timeoutMs: body.timeout_ms,
          suppliedRunId: sanitizeId(body.run_id) || runId("run"),
          signal: undefined,
        });
        return sendJson(res, 200, publicize(report, "live_run"));
      } catch (err) {
        return sendJson(res, err?.status || 500, {
          error: err?.code || "server_error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (req.method === "GET" || req.method === "HEAD") {
      return serveStatic(req, res);
    }

    res.writeHead(405).end("Method not allowed");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendJson(res, 500, { error: "server_error", message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`raven-conformance listening on http://${HOST}:${PORT}`);
  console.log("Fair build:", readBuildInfo().fairBuildCommit);
});
