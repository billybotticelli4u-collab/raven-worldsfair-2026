import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { assertRuntimeRootWritable, resolveRuntimeRoot } from "../api/runtime-root-guard.mjs";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const SOURCE_ROOT = path.join(REPO_ROOT, "apps", "raven-conformance");
const API = path.join(REPO_ROOT, "api", "index.js");

function refuse(raw, extraEnv = {}) {
  try {
    resolveRuntimeRoot({
      env: { RAVEN_CONFORMANCE_RUNTIME_ROOT: raw, ...extraEnv },
      sourceRoot: SOURCE_ROOT,
      repoRoot: REPO_ROOT,
      tmpdir: os.tmpdir(),
    });
    return null;
  } catch (e) {
    return String(e.message || e);
  }
}

test("refuse relative RAVEN_CONFORMANCE_RUNTIME_ROOT", () => {
  const msg = refuse("relative-runtime");
  assert.ok(msg && msg.includes("relative"), msg);
  assert.ok(msg.includes("relative-runtime"), msg);
});

test("refuse runtime root equal to repository root", () => {
  const msg = refuse(REPO_ROOT);
  assert.ok(msg && msg.includes("inside repository root"), msg);
  assert.ok(msg.includes(REPO_ROOT), msg);
});

test("refuse runtime root inside repository (descendant)", () => {
  const child = path.join(SOURCE_ROOT, "corpus");
  const msg = refuse(child);
  assert.ok(msg && msg.includes("inside repository root"), msg);
  assert.ok(msg.includes("corpus"), msg);
});

test("refuse runtime root outside os.tmpdir() without allow", () => {
  const outside = fs.mkdtempSync(path.join(os.homedir(), "raven-a1-outside-"));
  try {
    const msg = refuse(outside);
    assert.ok(msg && msg.includes("outside os.tmpdir"), msg);
    assert.ok(msg.includes(outside), msg);
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test("default relocation under tmpdir is accepted by guard", () => {
  const resolved = resolveRuntimeRoot({
    env: {},
    sourceRoot: SOURCE_ROOT,
    repoRoot: REPO_ROOT,
    tmpdir: os.tmpdir(),
  });
  const tmp = fs.realpathSync(os.tmpdir());
  const rel = path.relative(tmp, fs.existsSync(resolved) ? fs.realpathSync(resolved) : path.resolve(resolved));
  assert.ok(rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel)), `${resolved} not under ${tmp}`);
});

test("outside tmpdir allowed when RAVEN_CONFORMANCE_ALLOW_EXTERNAL_ROOT=1", () => {
  const outside = fs.mkdtempSync(path.join(os.homedir(), "raven-a1-allow-"));
  try {
    const resolved = resolveRuntimeRoot({
      env: {
        RAVEN_CONFORMANCE_RUNTIME_ROOT: outside,
        RAVEN_CONFORMANCE_ALLOW_EXTERNAL_ROOT: "1",
      },
      sourceRoot: SOURCE_ROOT,
      repoRoot: REPO_ROOT,
      tmpdir: os.tmpdir(),
    });
    assert.equal(path.resolve(resolved), path.resolve(outside));
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

async function captureListenImport(moduleUrl) {
  let captured = null;
  const orig = http.Server.prototype.listen;
  http.Server.prototype.listen = function () {
    captured = this;
    http.Server.prototype.listen = orig;
    return this;
  };
  try {
    await import(moduleUrl);
  } finally {
    http.Server.prototype.listen = orig;
  }
  assert.ok(captured instanceof http.Server, "listen() not captured");
  await new Promise((r) => captured.listen(0, "127.0.0.1", r));
  const port = captured.address().port;
  return { server: captured, base: `http://127.0.0.1:${port}` };
}

function digestOf(report) {
  return (
    report?.deterministic_report_sha256 ||
    report?.binding?.deterministic_report_sha256 ||
    report?.report_content_digest_sha256 ||
    report?.content_digest_sha256 ||
    null
  );
}

test("adapter relocates, serves report, digest matches second adapter run", async (t) => {
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "raven-a1-rt-"));
  process.env.RAVEN_CONFORMANCE_RUNTIME_ROOT = runtime;
  const { server, base } = await captureListenImport(pathToFileURL(API).href + `?a=${Date.now()}`);
  t.after(async () => {
    await new Promise((r) => server.close(r));
    delete process.env.RAVEN_CONFORMANCE_RUNTIME_ROOT;
  });

  const health = await fetch(`${base}/api/health`).then((r) => r.json());
  assert.equal(health.ok, true);

  const run1 = await fetch(`${base}/api/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ target: "CONFORMANT_REFERENCE" }),
  });
  const text1 = await run1.text();
  assert.equal(run1.status, 200, text1.slice(0, 400));
  const body1 = JSON.parse(text1);
  const report1 = body1.report || body1;
  const d1 = digestOf(report1) || report1.deterministic_report_sha256 || report1.report_content_digest_sha256;
  assert.ok(d1 && /^[0-9a-f]{64}$/.test(d1), `digest missing keys=${Object.keys(report1)} sample=${text1.slice(0,300)}`);

  const reportsDir = path.join(runtime, "reports");
  assert.ok(fs.existsSync(reportsDir), "relocated reports/ missing");
  const files = fs.readdirSync(reportsDir).filter((f) => f.endsWith(".json"));
  assert.ok(files.length >= 1, "no report files in relocated root");
  const runId = files[0].replace(/\.json$/, "");
  const got = await fetch(`${base}/api/report/${runId}`);
  assert.equal(got.status, 200);

  // Second run on same adapter — digest must be stable
  const run2 = await fetch(`${base}/api/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ target: "CONFORMANT_REFERENCE" }),
  }).then((r) => r.json());
  const d2 = digestOf(run2.report || run2);
  assert.equal(d1, d2, "adapter digests not stable across runs");
});

test("read-only source: cpSync from chmod a-w mirror or skip named", (t) => {
  const mirror = fs.mkdtempSync(path.join(os.tmpdir(), "raven-a1-ro-src-"));
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "raven-a1-ro-dst-"));
  t.after(() => {
    try { fs.chmodSync(mirror, 0o755); } catch {}
    fs.rmSync(mirror, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(mirror, "marker.txt"), "x");
  try {
    fs.chmodSync(mirror, 0o555);
  } catch (e) {
    t.skip(`chmod a-w unavailable: ${e.message}`);
    return;
  }
  assertRuntimeRootWritable(dest);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(mirror, dest, { recursive: true });
  assert.equal(fs.readFileSync(path.join(dest, "marker.txt"), "utf8"), "x");
});
