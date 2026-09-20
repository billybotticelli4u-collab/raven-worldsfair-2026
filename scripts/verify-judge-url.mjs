#!/usr/bin/env node
/**
 * Owner verification harness — MIGRATION-PLAN §C step 5 against any base URL.
 *
 * Usage:
 *   node scripts/verify-judge-url.mjs <base-url>
 *
 * Optional env:
 *   VERIFY_JUDGE_COOKIE   Cookie header value for SSO-walled previews
 *                         (e.g. VERIFY_JUDGE_COOKIE='_vercel_jwt=...').
 *                         Documented for Owner use; not required for local adapter.
 *
 * Exits non-zero on any failed check. Prints PASS/FAIL table + deployed commit.
 */
import http from "node:http";
import https from "node:https";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const base = (process.argv[2] || "").replace(/\/$/, "");
if (!base) {
  console.error("usage: node scripts/verify-judge-url.mjs <base-url>");
  process.exit(2);
}

const cookie = process.env.VERIFY_JUDGE_COOKIE || "";
const headers = cookie ? { cookie } : {};

const rows = [];
const record = (name, ok, detail) => {
  rows.push({ name, ok: !!ok, detail: detail == null ? "" : String(detail).slice(0, 240) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail != null ? "  — " + String(detail).slice(0, 160) : ""}`);
};

async function req(route, init = {}) {
  const r = await fetch(base + route, {
    ...init,
    headers: { ...headers, ...(init.headers || {}) },
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* */ }
  return { status: r.status, text, json, headers: r.headers };
}

function rawPost(route, hdrs, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(base + route);
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || (u.protocol === "https:" ? 443 : 80),
      path: u.pathname + u.search,
      method: "POST",
      headers: { ...headers, ...hdrs },
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

let deployedCommit = null;

// 1. GET /
{
  const r = await req("/");
  const titleOk = r.status === 200 && /Raven Conformance/i.test(r.text) && /<title>/i.test(r.text);
  record("GET / 200 + Judge UI title", titleOk, `status=${r.status}`);
}

// 2. health
{
  const r = await req("/api/health");
  record("GET /api/health ok", r.status === 200 && r.json?.ok === true, r.text.slice(0, 120));
}

// 3. build-info
{
  const r = await req("/api/build-info");
  const j = r.json || {};
  deployedCommit = j.fairBuildCommit || j.commit || j.gitCommit || null;
  const files = j.publicFingerprint?.files || j.public_fingerprint?.files || [];
  const ok =
    r.status === 200 &&
    j.product === "raven-conformance" &&
    files.length === 3 &&
    (j.identityStatus === "UNVERIFIED_ASSERTION" || j.identityStatus === "UNKNOWN" || typeof j.identityStatus === "string");
  record("GET /api/build-info shape", ok, `product=${j.product} identityStatus=${j.identityStatus} files=${files.length} commit=${deployedCommit}`);
}

// 4. public files match via verify-public-build.mjs
{
  const script = path.join(REPO, "scripts", "verify-public-build.mjs");
  const out = await new Promise((resolve) => {
    const child = spawn(process.execPath, [script, base], { env: { ...process.env, VERIFY_JUDGE_COOKIE: cookie } });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
  const ok = out.code === 0 && /PUBLIC_FILES_MATCH/.test(out.stdout + out.stderr);
  record("scripts/verify-public-build.mjs PUBLIC_FILES_MATCH", ok, (out.stdout + out.stderr).slice(0, 160));
}

// 5. POST /api/run CONFORMANT_REFERENCE
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
  const isolation = report.isolation?.mode || report.display?.isolation || report.isolation_mode || r.json?.isolation?.mode;
  const ok = r.status === 200 && Number(pass) === 12 && Number(total) === 12 && isolation != null;
  record("POST /api/run CONFORMANT_REFERENCE 12/12 + isolation", ok, `pass=${pass} total=${total} isolation=${isolation}`);
}

// 6. run-stream BROKEN_SUBTLE — exactly one complete + V07/V08
{
  const r = await req("/api/run-stream?target=BROKEN_SUBTLE");
  const text = r.text;
  const completes = [...text.matchAll(/event:\s*complete/g)];
  const hasV07 = /V07/.test(text);
  const hasV08 = /V08/.test(text);
  const ok = r.status === 200 && completes.length === 1 && hasV07 && hasV08;
  record("GET /api/run-stream?target=BROKEN_SUBTLE one complete + V07/V08", ok, `completes=${completes.length} V07=${hasV07} V08=${hasV08}`);
}

// 7. malformed JSON → 400 invalid_json
{
  const r = await req("/api/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{not json",
  });
  const err = r.json?.error || "";
  record("POST /api/run malformed JSON → 400 invalid_json", r.status === 400 && err === "invalid_json", `status=${r.status} error=${err}`);
}

// 8. ~70000 body → 413
{
  const r = await rawPost("/api/run", { "content-type": "application/json", "content-length": "70000" }, "{");
  record("POST /api/run 70000 content-length → 413", r.status === 413 && /request_too_large|too_large/i.test(r.text), `status=${r.status}`);
}

const failed = rows.filter((r) => !r.ok);
console.log("---");
console.log(`deployed_commit=${deployedCommit || "unknown"}`);
console.log(`summary: ${rows.length - failed.length} PASS / ${failed.length} FAIL`);
process.exit(failed.length ? 1 : 0);
