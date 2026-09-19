#!/usr/bin/env node
/**
 * Local smoke test for api/index.js (the Vercel entry for apps/raven-conformance).
 *
 * Emulates what the Vercel Node.js runtime does on import — it captures the
 * http.Server that the reviewed src/server.js creates via listen() — then binds
 * that server on 127.0.0.1 and exercises the judge-facing HTTP surface end to
 * end, including the reviewed public-file fingerprint verifier
 * (scripts/verify-public-build.mjs). Local only: no network egress, and the
 * source tree is never written to (reports land under the relocated runtime
 * root, not under apps/raven-conformance/reports).
 *
 * Usage:  node scripts/vercel-adapter-smoke.mjs        (exit 0 = all checks pass)
 */
import http from "node:http";
import assert from "node:assert/strict";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, readdirSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const APP_ROOT = path.join(REPO_ROOT, "apps", "raven-conformance");
const RUNTIME_ROOT = mkdtempSync(path.join(os.tmpdir(), "raven-conformance-smoke-"));
process.env.RAVEN_CONFORMANCE_RUNTIME_ROOT = RUNTIME_ROOT;

const WATCHDOG_MS = 240_000;
const results = [];
const finish = (code, note) => {
  const failed = results.filter((r) => !r.ok);
  console.log(JSON.stringify({
    node: process.version,
    platform: process.platform,
    runtime_root: RUNTIME_ROOT,
    passed: results.length - failed.length,
    failed: failed.length,
    note: note || null,
    results,
  }, null, 2));
  process.exit(code);
};
setTimeout(() => finish(2, `watchdog: checks did not finish within ${WATCHDOG_MS} ms`), WATCHDOG_MS).unref();

const listReports = () => readdirSync(path.join(APP_ROOT, "reports")).sort();
const sourceReportsBefore = listReports();

// Emulate @vercel/node server capture: the first listen() call is intercepted.
let captured = null;
const originalListen = http.Server.prototype.listen;
http.Server.prototype.listen = function () {
  captured = this;
  http.Server.prototype.listen = originalListen;
  return this;
};
try {
  await import(new URL("../api/index.js", import.meta.url).href);
} finally {
  http.Server.prototype.listen = originalListen;
}
assert.ok(captured instanceof http.Server, "api/index.js did not create an http.Server via listen()");
await new Promise((resolve) => captured.listen(0, "127.0.0.1", resolve));
const port = captured.address().port;
const base = `http://127.0.0.1:${port}`;

const short = (s, n = 160) => (typeof s === "string" ? s.slice(0, n) : s);
const call = async (route, init) => {
  const response = await fetch(base + route, init);
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: response.status, headers: response.headers, text, json };
};
const postJson = (route, body) =>
  call(route, { method: "POST", headers: { "content-type": "application/json" }, body });
// Raw client: send headers (and a first chunk) and read the status even when the
// server rejects early and closes the socket, as the reviewed boundary does on 413.
const rawPost = (route, headers, firstChunk) => new Promise((resolve, reject) => {
  const req = http.request({ host: "127.0.0.1", port, path: route, method: "POST", headers }, (res) => {
    const chunks = [];
    res.on("data", (c) => chunks.push(c));
    res.on("end", () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString("utf8") }));
    res.on("error", reject);
  });
  req.on("error", reject);
  req.write(firstChunk);
});

// One step = one recorded line; a throwing step is recorded as a failure, never aborts the run.
const state = {};
const step = async (name, fn) => {
  try {
    const out = await fn();
    results.push({ name, ok: Boolean(out?.ok), detail: out?.detail === undefined ? null : out.detail });
    if (!out?.ok) console.error("FAIL", name, out?.detail);
  } catch (err) {
    results.push({ name, ok: false, detail: `threw: ${err?.message || err}` });
    console.error("FAIL", name, err?.message || err);
  }
};

try {
  // Static UI (served by Vercel from outputDirectory; here by the reviewed serveStatic).
  await step("GET / (index.html)", async () => { const r = await call("/"); return { ok: r.status === 200 && r.text.includes("Raven Conformance"), detail: r.status }; });
  await step("GET /app.js", async () => ({ ok: (await call("/app.js")).status === 200 }));
  await step("GET /styles.css", async () => ({ ok: (await call("/styles.css")).status === 200 }));

  // Read-only JSON routes.
  await step("GET /api/health", async () => { const r = await call("/api/health"); return { ok: r.status === 200 && r.json?.ok === true, detail: short(r.text) }; });
  await step("GET /api/targets lists CONFORMANT_REFERENCE", async () => { const r = await call("/api/targets"); return { ok: r.status === 200 && r.json?.targets?.some((t) => t.id === "CONFORMANT_REFERENCE"), detail: short(r.text) }; });
  await step("GET /api/meta carries profile digest", async () => { const r = await call("/api/meta"); return { ok: r.status === 200 && r.json?.profile?.sha256?.length === 64, detail: short(r.text) }; });
  await step("GET /api/contract", async () => ({ ok: (await call("/api/contract")).status === 200 }));
  await step("GET /api/probes", async () => { const r = await call("/api/probes"); return { ok: r.status === 200 && Array.isArray(r.json?.targets), detail: short(r.text) }; });
  await step("GET /api/recorded/BROKEN_SUBTLE", async () => { const r = await call("/api/recorded/BROKEN_SUBTLE"); return { ok: r.status === 200 && r.json?.source === "recorded_report", detail: short(r.text) }; });

  // Build identity + public-file fingerprint (reviewed verifier, over HTTP).
  await step("GET /api/build-info shape", async () => {
    const r = await call("/api/build-info"); state.info = r.json;
    return { ok: r.status === 200 && r.json?.product === "raven-conformance" && r.json?.publicFingerprint?.files?.length === 3, detail: short(r.text, 240) };
  });
  await step("build-info identityStatus is not CONFLICT", async () => ({ ok: state.info?.identityStatus !== "CONFLICT", detail: `${state.info?.identityStatus} / ${state.info?.commitSource}` }));
  await step("scripts/verify-public-build.mjs -> PUBLIC_FILES_MATCH", async () => {
    // Async so the captured server (in this same process) keeps serving the verifier's requests.
    const { stdout } = await promisify(execFileCb)(process.execPath, [path.join(REPO_ROOT, "scripts", "verify-public-build.mjs"), base], { encoding: "utf8" });
    return { ok: stdout.includes("PUBLIC_FILES_MATCH"), detail: short(stdout.trim()) };
  });

  // Reviewed HTTP boundary must be reachable unchanged through the wrapper.
  await step("POST /api/run invalid JSON -> 400 invalid_json", async () => { const r = await postJson("/api/run", "{not json"); return { ok: r.status === 400 && r.json?.error === "invalid_json", detail: short(r.text) }; });
  await step("POST /api/run content-length 70000 -> 413 request_too_large", async () => {
    const r = await rawPost("/api/run", { "content-type": "application/json", "content-length": "70000" }, "{");
    return { ok: r.status === 413 && /request_too_large/.test(r.text), detail: `${r.status} ${short(r.text)}` };
  });
  await step("POST /api/run unknown target -> 400", async () => { const r = await postJson("/api/run", JSON.stringify({ target: "NOPE" })); return { ok: r.status === 400, detail: short(r.text) }; });

  // Live run over POST: the raw body must reach the reviewed handler intact.
  await step("POST /api/run CONFORMANT_REFERENCE -> 200 + report", async () => {
    const r = await postJson("/api/run", JSON.stringify({ target: "CONFORMANT_REFERENCE" })); state.run = r.json; state.report = r.json?.report;
    return { ok: r.status === 200 && typeof state.report?.run_id === "string", detail: short(r.text, 240) };
  });
  await step("CONFORMANT_REFERENCE: pass === test_count === 12", async () => ({ ok: state.report?.summary?.pass === 12 && state.report?.summary?.test_count === 12, detail: JSON.stringify(state.report?.summary?.counts) }));
  await step("report written under the relocated runtime root", async () => {
    // The ESM loader realpaths module URLs (macOS: /var -> /private/var), so compare realpaths.
    const wrote = typeof state.run?.written_path === "string" ? realpathSync(state.run.written_path) : "";
    return { ok: wrote.startsWith(realpathSync(RUNTIME_ROOT) + path.sep), detail: state.run?.written_path };
  });
  await step("isolation disclosed", async () => ({ ok: typeof state.report?.isolation?.mode === "string", detail: state.report?.isolation?.mode }));
  await step("GET /api/report/<run_id> -> 200 attachment", async () => {
    const r = await call("/api/report/" + encodeURIComponent(state.report?.run_id));
    return { ok: r.status === 200 && /attachment/.test(r.headers.get("content-disposition") || ""), detail: r.status };
  });
  await step("POST /api/replay of the live report -> 200 ok", async () => {
    const r = await postJson("/api/replay", JSON.stringify({ report_path: `reports/${state.report?.run_id}.json` }));
    return { ok: r.status === 200 && r.json?.ok === true, detail: short(r.text) };
  });

  // Judge UI path: SSE stream.
  await step("GET /api/run-stream -> text/event-stream with complete event", async () => {
    const r = await call("/api/run-stream?target=BROKEN_SUBTLE"); state.sse = r;
    return { ok: r.status === 200 && /text\/event-stream/.test(r.headers.get("content-type") || "") && r.text.includes("event: complete"), detail: r.headers.get("content-type") };
  });
  await step("BROKEN_SUBTLE divergence is exactly V07/V08", async () => {
    const lines = (state.sse?.text || "").split("\n");
    const i = lines.indexOf("event: complete");
    const complete = i >= 0 && lines[i + 1]?.startsWith("data: ") ? JSON.parse(lines[i + 1].slice(6)) : null;
    const divergent = complete?.report?.summary?.behavioral_divergence_vector_ids;
    const prefixes = Array.isArray(divergent) ? divergent.map((id) => String(id).slice(0, 3)) : null;
    return { ok: JSON.stringify(prefixes) === JSON.stringify(["V07", "V08"]), detail: JSON.stringify(divergent) };
  });

  await step("source tree apps/raven-conformance/reports untouched", async () => ({ ok: JSON.stringify(listReports()) === JSON.stringify(sourceReportsBefore), detail: listReports().join(",") }));
} finally {
  captured.closeAllConnections?.();
  captured.close();
}

finish(results.some((r) => !r.ok) ? 1 : 0);
