import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const resolver = path.join(root, "scripts/ci/resolve-judge-verify-target.mjs");

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        server,
        base: `http://127.0.0.1:${port}`,
        close: () => new Promise((res, rej) => server.close((e) => (e ? rej(e) : res()))),
      });
    });
  });
}

function run(env) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [resolver], {
      env: { ...process.env, ...env, GITHUB_OUTPUT: "" },
      cwd: root,
    });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => resolve({ code, out, err }));
  });
}

const SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function mkDeploy({ sha = SHA, target = null, readyState = "READY", url = "proj-git-abc-team.vercel.app", projectId = "prj_test", uid = "dpl_1" } = {}) {
  return {
    uid,
    id: uid,
    url,
    target,
    readyState,
    projectId,
    createdAt: Date.now(),
    meta: { githubCommitSha: sha },
  };
}

test("R1: READY production target with unique *.vercel.app URL is refused", async () => {
  const api = await listen((req, res) => {
    const body = {
      deployments: [mkDeploy({ target: "production", url: "unique-immortal-dpl-xyz.vercel.app" })],
    };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  });
  const r = await run({
    EVENT_NAME: "pull_request",
    PR_HEAD_SHA: SHA,
    VERCEL_TOKEN: "t",
    VERCEL_PROJECT_ID: "prj_test",
    VERCEL_API_BASE: api.base,
  });
  await api.close();
  assert.notEqual(r.code, 0);
  assert.match(r.err + r.out, /production/i);
});

test("R1/C1: documented target=null (preview) accepted", async () => {
  const api = await listen((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ deployments: [mkDeploy({ target: null, url: "null-preview.vercel.app" })] }));
  });
  const r = await run({
    EVENT_NAME: "pull_request",
    PR_HEAD_SHA: SHA,
    VERCEL_TOKEN: "t",
    VERCEL_PROJECT_ID: "prj_test",
    VERCEL_API_BASE: api.base,
  });
  await api.close();
  assert.equal(r.code, 0);
  assert.match(r.out, /base=https:\/\/null-preview\.vercel\.app/);
});

test("R1/C1: missing target property refused (not guessed as preview)", async () => {
  const api = await listen((req, res) => {
    const d = mkDeploy({ url: "mystery.vercel.app" });
    delete d.target;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ deployments: [d] }));
  });
  const r = await run({
    EVENT_NAME: "pull_request",
    PR_HEAD_SHA: SHA,
    VERCEL_TOKEN: "t",
    VERCEL_PROJECT_ID: "prj_test",
    VERCEL_API_BASE: api.base,
  });
  await api.close();
  assert.notEqual(r.code, 0);
});

test("R1 positive: Ready target=\"preview\" string still accepted", async () => {
  const api = await listen((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ deployments: [mkDeploy({ target: "preview", url: "preview-abc.vercel.app" })] }));
  });
  const r = await run({
    EVENT_NAME: "pull_request",
    PR_HEAD_SHA: SHA,
    VERCEL_TOKEN: "t",
    VERCEL_PROJECT_ID: "prj_test",
    VERCEL_API_BASE: api.base,
  });
  await api.close();
  assert.equal(r.code, 0);
  assert.match(r.out, /base=https:\/\/preview-abc\.vercel\.app/);
  assert.match(r.out, new RegExp(`expected=${SHA}`));
});

test("R2: deployment_status foreign URL refused even if success+hex SHA", async () => {
  const api = await listen((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ deployments: [mkDeploy({ url: "real-preview.vercel.app" })] }));
  });
  const r = await run({
    EVENT_NAME: "deployment_status",
    DEPLOY_STATE: "success",
    DEPLOY_URL: "https://unrelated.invalid",
    DEPLOY_SHA: SHA,
    VERCEL_TOKEN: "t",
    VERCEL_PROJECT_ID: "prj_test",
    VERCEL_API_BASE: api.base,
  });
  await api.close();
  assert.notEqual(r.code, 0);
  assert.match(r.err + r.out, /does not match|foreign|refusing/i);
});

test("R2: deployment_status http URL refused", async () => {
  const api = await listen((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ deployments: [mkDeploy({ url: "unrelated.invalid" })] }));
  });
  const r = await run({
    EVENT_NAME: "deployment_status",
    DEPLOY_STATE: "success",
    DEPLOY_URL: "http://unrelated.invalid",
    DEPLOY_SHA: SHA,
    VERCEL_TOKEN: "t",
    VERCEL_PROJECT_ID: "prj_test",
    VERCEL_API_BASE: api.base,
  });
  await api.close();
  assert.notEqual(r.code, 0);
  assert.match(r.err + r.out, /HTTPS/i);
});

test("R2: deployment_status wrong SHA refused", async () => {
  const api = await listen((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ deployments: [mkDeploy({ sha: SHA, url: "preview-abc.vercel.app" })] }));
  });
  const r = await run({
    EVENT_NAME: "deployment_status",
    DEPLOY_STATE: "success",
    DEPLOY_URL: "https://preview-abc.vercel.app",
    DEPLOY_SHA: OTHER,
    VERCEL_TOKEN: "t",
    VERCEL_PROJECT_ID: "prj_test",
    VERCEL_API_BASE: api.base,
  });
  await api.close();
  assert.notEqual(r.code, 0);
});

test("R2: deployment_status exact preview URL+SHA bound accepted", async () => {
  const api = await listen((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ deployments: [mkDeploy({ url: "exact-preview.vercel.app" })] }));
  });
  const r = await run({
    EVENT_NAME: "deployment_status",
    DEPLOY_STATE: "success",
    DEPLOY_URL: "https://exact-preview.vercel.app",
    DEPLOY_SHA: SHA,
    VERCEL_TOKEN: "t",
    VERCEL_PROJECT_ID: "prj_test",
    VERCEL_API_BASE: api.base,
  });
  await api.close();
  assert.equal(r.code, 0);
  assert.match(r.out, /base=https:\/\/exact-preview\.vercel\.app/);
});

test("R2: workflow_dispatch typed URL alone not enough — must match project preview", async () => {
  const api = await listen((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ deployments: [mkDeploy({ url: "real-preview.vercel.app" })] }));
  });
  const r = await run({
    EVENT_NAME: "workflow_dispatch",
    INPUT_URL: "https://foreign.example",
    INPUT_COMMIT: SHA,
    VERCEL_TOKEN: "t",
    VERCEL_PROJECT_ID: "prj_test",
    VERCEL_API_BASE: api.base,
  });
  await api.close();
  assert.notEqual(r.code, 0);
});

test("R2: foreign projectId on deployment refused", async () => {
  const api = await listen((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        deployments: [mkDeploy({ projectId: "prj_other", url: "exact-preview.vercel.app" })],
      }),
    );
  });
  const r = await run({
    EVENT_NAME: "deployment_status",
    DEPLOY_STATE: "success",
    DEPLOY_URL: "https://exact-preview.vercel.app",
    DEPLOY_SHA: SHA,
    VERCEL_TOKEN: "t",
    VERCEL_PROJECT_ID: "prj_test",
    VERCEL_API_BASE: api.base,
  });
  await api.close();
  assert.notEqual(r.code, 0);
  assert.match(r.err + r.out, /project/i);
});

test("pull_request without token fails closed", async () => {
  const r = await run({
    EVENT_NAME: "pull_request",
    PR_HEAD_SHA: SHA,
    VERCEL_TOKEN: "",
    VERCEL_PROJECT_ID: "prj_test",
  });
  assert.notEqual(r.code, 0);
});

test("URL with query string refused before credentials", async () => {
  const api = await listen((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ deployments: [mkDeploy({ url: "exact-preview.vercel.app" })] }));
  });
  const r = await run({
    EVENT_NAME: "deployment_status",
    DEPLOY_STATE: "success",
    DEPLOY_URL: "https://exact-preview.vercel.app?x=1",
    DEPLOY_SHA: SHA,
    VERCEL_TOKEN: "t",
    VERCEL_PROJECT_ID: "prj_test",
    VERCEL_API_BASE: api.base,
  });
  await api.close();
  assert.notEqual(r.code, 0);
  assert.match(r.err + r.out, /query/i);
});

test("C2: pull_request foreign projectId refused (shared resolver)", async () => {
  const api = await listen((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        deployments: [mkDeploy({ projectId: "prj_foreign", url: "foreign-preview.vercel.app", target: null })],
      }),
    );
  });
  const r = await run({
    EVENT_NAME: "pull_request",
    PR_HEAD_SHA: SHA,
    VERCEL_TOKEN: "t",
    VERCEL_PROJECT_ID: "prj_expected",
    VERCEL_API_BASE: api.base,
  });
  await api.close();
  assert.notEqual(r.code, 0);
  assert.match(r.err + r.out, /project/i);
});

test("C2: push foreign projectId refused (shared resolver)", async () => {
  const api = await listen((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        deployments: [mkDeploy({ projectId: "prj_foreign", url: "foreign-preview.vercel.app", target: null })],
      }),
    );
  });
  const r = await run({
    EVENT_NAME: "push",
    PUSH_SHA: SHA,
    VERCEL_TOKEN: "t",
    VERCEL_PROJECT_ID: "prj_expected",
    VERCEL_API_BASE: api.base,
  });
  await api.close();
  assert.notEqual(r.code, 0);
  assert.match(r.err + r.out, /project/i);
});

test("C2: staging target refused", async () => {
  const api = await listen((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ deployments: [mkDeploy({ target: "staging", url: "staging.vercel.app" })] }));
  });
  const r = await run({
    EVENT_NAME: "pull_request",
    PR_HEAD_SHA: SHA,
    VERCEL_TOKEN: "t",
    VERCEL_PROJECT_ID: "prj_test",
    VERCEL_API_BASE: api.base,
  });
  await api.close();
  assert.notEqual(r.code, 0);
});
