#!/usr/bin/env node
/**
 * Owner / CI verification harness against a base URL.
 *
 * Usage: node scripts/verify-judge-url.mjs <base-url>
 *
 * Env:
 *   VERIFY_JUDGE_COOKIE  optional Cookie for SSO-walled previews (same-origin only)
 *   EXPECTED_COMMIT      required for CI/owner gate PASS — 40-hex must match fairBuildCommit
 *                        (LOCAL-UNBOUND only on loopback + identity UNKNOWN/null + null commit;
 *                         non-loopback with EXPECTED_COMMIT unset → FAIL)
 *   FETCH_TIMEOUT_MS     default 15000
 */
import http from "node:http";
import https from "node:https";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyIdentityChecks } from "./lib/judge-url-identity.mjs";

const REPO = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const base = (process.argv[2] || "").replace(/\/$/, "");
if (!base) {
  console.error("usage: node scripts/verify-judge-url.mjs <base-url>");
  process.exit(2);
}

const cookie = process.env.VERIFY_JUDGE_COOKIE || "";
const expectedCommit = (process.env.EXPECTED_COMMIT || "").trim().toLowerCase();
const timeoutMs = Number(process.env.FETCH_TIMEOUT_MS || 15000);
const headers = cookie ? { cookie } : {};

const ALLOWED_IDENTITY = new Set(["UNVERIFIED_ASSERTION"]);
const DIVERGE = new Set(["FAIL", "DIVERGE", "DIVERGENCE", "BEHAVIORAL_DIVERGENCE"]);

const rows = [];
function record(name, ok, detail, klass) {
  const unbound = klass === "LOCAL-UNBOUND";
  const status = unbound ? "LOCAL-UNBOUND" : ok ? "PASS" : "FAIL";
  // LOCAL-UNBOUND is expected on an unbound local server; it does not fail the gate.
  rows.push({
    name,
    ok: unbound ? true : !!ok,
    unbound,
    detail: detail == null ? "" : String(detail).slice(0, 240),
  });
  console.log(`${status}  ${name}${detail != null ? "  — " + String(detail).slice(0, 160) : ""}`);
}

function withTimeout(promise, label) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout ${timeoutMs}ms on ${label}`)), timeoutMs);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

async function req(route, init = {}) {
  const r = await withTimeout(
    fetch(base + route, { ...init, headers: { ...headers, ...(init.headers || {}) } }),
    route,
  );
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* */ }
  return { status: r.status, text, json };
}

function rawPost(route, hdrs, body) {
  return withTimeout(
    new Promise((resolve, reject) => {
      const u = new URL(base + route);
      const lib = u.protocol === "https:" ? https : http;
      const request = lib.request(
        {
          protocol: u.protocol,
          hostname: u.hostname,
          port: u.port || (u.protocol === "https:" ? 443 : 80),
          path: u.pathname + u.search,
          method: "POST",
          headers: { ...headers, ...hdrs },
          timeout: timeoutMs,
        },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () =>
            resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString("utf8") }),
          );
        },
      );
      request.on("error", reject);
      request.on("timeout", () => {
        request.destroy();
        reject(new Error("socket timeout"));
      });
      request.write(body);
      request.end();
    }),
    "rawPost " + route,
  );
}

function parseCompletePayload(text) {
  const blocks = text.split(/\n\n+/);
  for (const block of blocks) {
    if (!/^event:\s*complete/m.test(block)) continue;
    const m = block.match(/^data:\s*(.+)$/m);
    if (!m) continue;
    try { return JSON.parse(m[1]); } catch { /* */ }
  }
  return null;
}

function rowVectorId(x) {
  if (!x || typeof x !== "object") return "";
  return String(x.vector_id || x.id || "");
}

/** Match raven-conformance-report/1 rows: vector_id "V07_…" / "V08_…" (legacy bare id also accepted). */
function outcomeOf(results, prefix) {
  const row = (results || []).find((x) => {
    const id = rowVectorId(x);
    return id === prefix || id.startsWith(prefix + "_");
  });
  if (!row) return null;
  return String(row.status || row.outcome || row.result || "").toUpperCase();
}

function isExpectedSubtleId(id) {
  return id === "V07" || id === "V08" || id.startsWith("V07_") || id.startsWith("V08_");
}

let deployedCommit = null;

try {
  {
    const r = await req("/");
    const titleOk = r.status === 200 && /Raven Conformance/i.test(r.text) && /<title>/i.test(r.text);
    record("GET / 200 + Judge UI title", titleOk, `status=${r.status}`);
  }

  {
    const r = await req("/api/health");
    record("GET /api/health ok", r.status === 200 && r.json?.ok === true, r.text.slice(0, 120));
  }

  {
    const r = await req("/api/build-info");
    const j = r.json || {};
    deployedCommit = j.fairBuildCommit || j.commit || j.gitCommit || null;
    if (typeof deployedCommit === "string") deployedCommit = deployedCommit.toLowerCase();
    const files = j.publicFingerprint?.files || j.public_fingerprint?.files || [];
    const idOk = ALLOWED_IDENTITY.has(j.identityStatus);
    const commitShape = typeof deployedCommit === "string" && /^[0-9a-f]{40}$/.test(deployedCommit);
    const shapeOk =
      r.status === 200 &&
      j.product === "raven-conformance" &&
      files.length === 3;
    // Test hook: VERIFY_JUDGE_HOSTNAME_FOR_GATE overrides loopback detection only (D6 red tests).
    const gateBase =
      process.env.VERIFY_JUDGE_HOSTNAME_FOR_GATE
        ? `http://${process.env.VERIFY_JUDGE_HOSTNAME_FOR_GATE}/`
        : base;
    const classified = classifyIdentityChecks({
      baseUrl: gateBase,
      expectedCommit,
      identityStatus: j.identityStatus ?? null,
      deployedCommit,
      shapeOk,
      allowlistedIdentity: idOk,
      commitShapeOk: commitShape,
    });
    record(
      "GET /api/build-info shape + allowlisted identity + commit",
      classified.buildInfo.ok,
      classified.buildInfo.detail,
      classified.buildInfo.klass,
    );
    record(
      classified.expectedCommit.name,
      classified.expectedCommit.ok,
      classified.expectedCommit.detail,
      classified.expectedCommit.klass,
    );
  }

  {
    const script = path.join(REPO, "scripts", "verify-public-build.mjs");
    const out = await new Promise((resolve) => {
      const child = spawn(process.execPath, [script, base], {
        env: { ...process.env, VERIFY_JUDGE_COOKIE: cookie },
      });
      let stdout = "", stderr = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("close", (code) => resolve({ code, stdout, stderr }));
    });
    const ok = out.code === 0 && /PUBLIC_FILES_MATCH/.test(out.stdout + out.stderr);
    record("scripts/verify-public-build.mjs PUBLIC_FILES_MATCH", ok, (out.stdout + out.stderr).slice(0, 160));
  }

  {
    const r = await req("/api/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: "CONFORMANT_REFERENCE" }),
    });
    const report = r.json?.report || r.json || {};
    const summary = report.summary || {};
    const pass = summary.pass ?? summary.passed ?? summary.counts?.pass;
    const total = summary.test_count ?? summary.total ?? summary.counts?.total;
    const isolation =
      report.isolation?.mode ||
      report.display?.isolation ||
      report.isolation_mode ||
      r.json?.isolation?.mode;
    const ok = r.status === 200 && Number(pass) === 12 && Number(total) === 12 && isolation != null;
    record("POST /api/run CONFORMANT_REFERENCE 12/12 + isolation", ok, `pass=${pass} total=${total} isolation=${isolation}`);
  }

  {
    const r = await req("/api/run-stream?target=BROKEN_SUBTLE");
    const text = r.text;
    const completes = [...text.matchAll(/event:\s*complete/g)];
    const payload = parseCompletePayload(text);
    const results = payload?.results || payload?.report?.results || [];
    const v07 = outcomeOf(results, "V07");
    const v08 = outcomeOf(results, "V08");
    const v07ok = DIVERGE.has(v07);
    const v08ok = DIVERGE.has(v08);
    const extraDiv = (results || []).filter((x) => {
      const id = rowVectorId(x);
      const st = String(x?.status || x?.outcome || "").toUpperCase();
      return id && !isExpectedSubtleId(id) && DIVERGE.has(st);
    });
    const ok =
      r.status === 200 &&
      completes.length === 1 &&
      payload != null &&
      v07ok &&
      v08ok &&
      extraDiv.length === 0;
    record(
      "BROKEN_SUBTLE complete: V07+V08 diverge, no extra divergences",
      ok,
      `completes=${completes.length} V07=${v07} V08=${v08} extraDiv=${extraDiv.length}`,
    );
  }

  {
    const r = await req("/api/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    const err = r.json?.error || "";
    record("POST /api/run malformed JSON → 400 invalid_json", r.status === 400 && err === "invalid_json", `status=${r.status} error=${err}`);
  }

  {
    const r = await rawPost("/api/run", { "content-type": "application/json", "content-length": "70000" }, "{");
    record("POST /api/run 70000 content-length → 413", r.status === 413 && /request_too_large|too_large/i.test(r.text), `status=${r.status}`);
  }
} catch (err) {
  record("harness execution", false, String(err && err.message ? err.message : err));
}

const failed = rows.filter((r) => !r.ok);
const unbound = rows.filter((r) => r.unbound);
const passed = rows.filter((r) => r.ok && !r.unbound);
console.log("---");
console.log(`deployed_commit=${deployedCommit || "unknown"}`);
console.log(`expected_commit=${expectedCommit || "(unset)"}`);
console.log(`summary: ${passed.length} PASS / ${unbound.length} LOCAL-UNBOUND / ${failed.length} FAIL`);
process.exit(failed.length ? 1 : 0);
