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

function mkDeploy({
  sha = SHA,
  target = null,
  readyState = "READY",
  url = "proj-git-abc-team.vercel.app",
  projectId = "prj_test",
  uid = "dpl_1",
  createdAt = Date.now(),
} = {}) {
  return {
    uid,
    id: uid,
    url,
    target,
    readyState,
    projectId,
    createdAt,
    meta: { githubCommitSha: sha },
  };
}

function apiWith(deployments, aliasMap = {}) {
  return listen((req, res) => {
    const u = new URL(req.url, "http://127.0.0.1");
    const m = u.pathname.match(/^\/v2\/deployments\/([^/]+)\/aliases$/);
    if (m) {
      const id = decodeURIComponent(m[1]);
      const aliases = Object.prototype.hasOwnProperty.call(aliasMap, id)
        ? aliasMap[id]
        : [];
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ aliases: Array.isArray(aliases) ? aliases : [] }));
      return;
    }
    // Default list endpoint unchanged
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ deployments }));
  });
}

/** Public alias ≠ unique deployment host, bound to uid via deploymentId. */
function publicAliasEntry(uid, publicHost, extra = {}) {
  return { alias: publicHost, deploymentId: uid, uid: `alias_${uid}`, ...extra };
}

const baseEnv = {
  VERCEL_TOKEN: "t",
  VERCEL_PROJECT_ID: "prj_test",
};

// --- Existing preview refusal / acceptance (must stay green) ---

test("R1: READY production target with unique *.vercel.app URL is refused", async () => {
  const api = await apiWith([mkDeploy({ target: "production", url: "unique-immortal-dpl-xyz.vercel.app" })]);
  const r = await run({
    EVENT_NAME: "pull_request",
    PR_HEAD_SHA: SHA,
    ...baseEnv,
    VERCEL_API_BASE: api.base,
  });
  await api.close();
  assert.notEqual(r.code, 0);
  assert.match(r.err + r.out, /production/i);
});

test('R1/C1: documented target=null (preview) accepted', async () => {
  const api = await apiWith([mkDeploy({ target: null, url: "null-preview.vercel.app" })]);
  const r = await run({
    EVENT_NAME: "pull_request",
    PR_HEAD_SHA: SHA,
    ...baseEnv,
    VERCEL_API_BASE: api.base,
  });
  await api.close();
  assert.equal(r.code, 0);
  assert.match(r.out, /base=https:\/\/null-preview\.vercel\.app/);
  assert.match(r.out, /mode=preview/);
  assert.match(r.out, /credentialed=true/);
});

test("R1/C1: missing target property refused (not guessed as preview)", async () => {
  const d = mkDeploy({ url: "mystery.vercel.app" });
  delete d.target;
  const api = await apiWith([d]);
  const r = await run({
    EVENT_NAME: "pull_request",
    PR_HEAD_SHA: SHA,
    ...baseEnv,
    VERCEL_API_BASE: api.base,
  });
  await api.close();
  assert.notEqual(r.code, 0);
});

test('R1 positive: Ready target="preview" string still accepted', async () => {
  const api = await apiWith([mkDeploy({ target: "preview", url: "preview-abc.vercel.app" })]);
  const r = await run({
    EVENT_NAME: "pull_request",
    PR_HEAD_SHA: SHA,
    ...baseEnv,
    VERCEL_API_BASE: api.base,
  });
  await api.close();
  assert.equal(r.code, 0);
  assert.match(r.out, /base=https:\/\/preview-abc\.vercel\.app/);
  assert.match(r.out, new RegExp(`expected=${SHA}`));
  assert.match(r.out, /mode=preview/);
  assert.match(r.out, /credentialed=true/);
});

test("R2: deployment_status foreign URL refused even if success+hex SHA", async () => {
  const api = await apiWith([mkDeploy({ url: "real-preview.vercel.app" })]);
  const r = await run({
    EVENT_NAME: "deployment_status",
    DEPLOY_STATE: "success",
    DEPLOY_URL: "https://unrelated.invalid",
    DEPLOY_SHA: SHA,
    ...baseEnv,
    VERCEL_API_BASE: api.base,
  });
  await api.close();
  assert.notEqual(r.code, 0);
  assert.match(r.err + r.out, /does not match|foreign|refusing/i);
});

test("R2: deployment_status http URL refused", async () => {
  const api = await apiWith([mkDeploy({ url: "unrelated.invalid" })]);
  const r = await run({
    EVENT_NAME: "deployment_status",
    DEPLOY_STATE: "success",
    DEPLOY_URL: "http://unrelated.invalid",
    DEPLOY_SHA: SHA,
    ...baseEnv,
    VERCEL_API_BASE: api.base,
  });
  await api.close();
  assert.notEqual(r.code, 0);
  assert.match(r.err + r.out, /HTTPS/i);
});

test("R2: deployment_status wrong SHA refused", async () => {
  const api = await apiWith([mkDeploy({ sha: SHA, url: "preview-abc.vercel.app" })]);
  const r = await run({
    EVENT_NAME: "deployment_status",
    DEPLOY_STATE: "success",
    DEPLOY_URL: "https://preview-abc.vercel.app",
    DEPLOY_SHA: OTHER,
    ...baseEnv,
    VERCEL_API_BASE: api.base,
  });
  await api.close();
  assert.notEqual(r.code, 0);
});

test("R2: deployment_status exact preview URL+SHA bound accepted", async () => {
  const api = await apiWith([mkDeploy({ url: "exact-preview.vercel.app" })]);
  const r = await run({
    EVENT_NAME: "deployment_status",
    DEPLOY_STATE: "success",
    DEPLOY_URL: "https://exact-preview.vercel.app",
    DEPLOY_SHA: SHA,
    ...baseEnv,
    VERCEL_API_BASE: api.base,
  });
  await api.close();
  assert.equal(r.code, 0);
  assert.match(r.out, /base=https:\/\/exact-preview\.vercel\.app/);
  assert.match(r.out, /mode=preview/);
  assert.match(r.out, /credentialed=true/);
});

test("R2: workflow_dispatch typed URL alone not enough — must match project preview", async () => {
  const api = await apiWith([mkDeploy({ url: "real-preview.vercel.app" })]);
  const r = await run({
    EVENT_NAME: "workflow_dispatch",
    INPUT_URL: "https://foreign.example",
    INPUT_COMMIT: SHA,
    ...baseEnv,
    VERCEL_API_BASE: api.base,
  });
  await api.close();
  assert.notEqual(r.code, 0);
});

test("R2: foreign projectId on deployment refused", async () => {
  const api = await apiWith([mkDeploy({ projectId: "prj_other", url: "exact-preview.vercel.app" })]);
  const r = await run({
    EVENT_NAME: "deployment_status",
    DEPLOY_STATE: "success",
    DEPLOY_URL: "https://exact-preview.vercel.app",
    DEPLOY_SHA: SHA,
    ...baseEnv,
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
  const api = await apiWith([mkDeploy({ url: "exact-preview.vercel.app" })]);
  const r = await run({
    EVENT_NAME: "deployment_status",
    DEPLOY_STATE: "success",
    DEPLOY_URL: "https://exact-preview.vercel.app?x=1",
    DEPLOY_SHA: SHA,
    ...baseEnv,
    VERCEL_API_BASE: api.base,
  });
  await api.close();
  assert.notEqual(r.code, 0);
  assert.match(r.err + r.out, /query/i);
});

test("C2: pull_request foreign projectId refused (shared resolver)", async () => {
  const api = await apiWith([
    mkDeploy({ projectId: "prj_foreign", url: "foreign-preview.vercel.app", target: null }),
  ]);
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

test("C2: push foreign projectId refused (production path)", async () => {
  const api = await apiWith([
    mkDeploy({
      projectId: "prj_foreign",
      url: "foreign-prod.vercel.app",
      target: "production",
    }),
  ]);
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

test("C2: staging target refused on pull_request (preview path)", async () => {
  const api = await apiWith([mkDeploy({ target: "staging", url: "staging.vercel.app" })]);
  const r = await run({
    EVENT_NAME: "pull_request",
    PR_HEAD_SHA: SHA,
    ...baseEnv,
    VERCEL_API_BASE: api.base,
  });
  await api.close();
  assert.notEqual(r.code, 0);
});

// --- Routing: push requires production ---

test("routing: push resolves Ready production → mode=production credentialed=false", async () => {
  const unique = "prod-main-unique-dpl.vercel.app";
  const publicHost = "raven-worldsfair-2026.vercel.app";
  const api = await apiWith(
    [mkDeploy({ target: "production", url: unique, uid: "dpl_prod" })],
    { dpl_prod: [publicAliasEntry("dpl_prod", publicHost)] },
  );
  const r = await run({
    EVENT_NAME: "push",
    PUSH_SHA: SHA,
    ...baseEnv,
    VERCEL_API_BASE: api.base,
  });
  await api.close();
  assert.equal(r.code, 0);
  assert.match(r.out, /base=https:\/\/raven-worldsfair-2026\.vercel\.app/);
  assert.doesNotMatch(r.out, /base=https:\/\/prod-main-unique-dpl\.vercel\.app/);
  assert.match(r.out, new RegExp(`expected=${SHA}`));
  assert.match(r.out, /mode=production/);
  assert.match(r.out, /credentialed=false/);
});

test("routing: push refuses when only preview exists (no preview fallback)", async () => {
  const api = await apiWith([mkDeploy({ target: null, url: "only-preview.vercel.app" })]);
  const r = await run({
    EVENT_NAME: "push",
    PUSH_SHA: SHA,
    ...baseEnv,
    VERCEL_API_BASE: api.base,
  });
  await api.close();
  assert.notEqual(r.code, 0);
  assert.match(r.err + r.out, /preview|production/i);
});

test("routing: pull_request still refuses production deploy", async () => {
  const api = await apiWith([
    mkDeploy({ target: "production", url: "prod-for-pr.vercel.app" }),
  ]);
  const r = await run({
    EVENT_NAME: "pull_request",
    PR_HEAD_SHA: SHA,
    ...baseEnv,
    VERCEL_API_BASE: api.base,
  });
  await api.close();
  assert.notEqual(r.code, 0);
  assert.match(r.err + r.out, /production/i);
});

test("routing: workflow_dispatch stays preview-bound with credentialed=true", async () => {
  const api = await apiWith([mkDeploy({ target: null, url: "dispatch-preview.vercel.app" })]);
  const r = await run({
    EVENT_NAME: "workflow_dispatch",
    INPUT_URL: "https://dispatch-preview.vercel.app",
    INPUT_COMMIT: SHA,
    ...baseEnv,
    VERCEL_API_BASE: api.base,
  });
  await api.close();
  assert.equal(r.code, 0);
  assert.match(r.out, /mode=preview/);
  assert.match(r.out, /credentialed=true/);
});

// --- deployment_status classification ---

test("deployment_status production URL → mode=production credentialed=false", async () => {
  const unique = "app-prod.vercel.app";
  const publicHost = "raven-app-prod.vercel.app";
  const api = await apiWith(
    [mkDeploy({ target: "production", url: unique, uid: "dpl_p" })],
    { dpl_p: [publicAliasEntry("dpl_p", publicHost)] },
  );
  const r = await run({
    EVENT_NAME: "deployment_status",
    DEPLOY_STATE: "success",
    DEPLOY_URL: `https://${unique}`,
    DEPLOY_SHA: SHA,
    ...baseEnv,
    VERCEL_API_BASE: api.base,
  });
  await api.close();
  assert.equal(r.code, 0);
  assert.match(r.out, /base=https:\/\/raven-app-prod\.vercel\.app/);
  assert.doesNotMatch(r.out, /base=https:\/\/app-prod\.vercel\.app/);
  assert.match(r.out, /mode=production/);
  assert.match(r.out, /credentialed=false/);
});

test("deployment_status preview URL → mode=preview credentialed=true", async () => {
  const api = await apiWith([
    mkDeploy({ target: null, url: "pr-preview.vercel.app", uid: "dpl_prev" }),
  ]);
  const r = await run({
    EVENT_NAME: "deployment_status",
    DEPLOY_STATE: "success",
    DEPLOY_URL: "https://pr-preview.vercel.app",
    DEPLOY_SHA: SHA,
    ...baseEnv,
    VERCEL_API_BASE: api.base,
  });
  await api.close();
  assert.equal(r.code, 0);
  assert.match(r.out, /mode=preview/);
  assert.match(r.out, /credentialed=true/);
});

test("deployment_status non-success fails closed", async () => {
  const api = await apiWith([mkDeploy({ target: "production", url: "app-prod.vercel.app" })]);
  const r = await run({
    EVENT_NAME: "deployment_status",
    DEPLOY_STATE: "failure",
    DEPLOY_URL: "https://app-prod.vercel.app",
    DEPLOY_SHA: SHA,
    ...baseEnv,
    VERCEL_API_BASE: api.base,
  });
  await api.close();
  assert.notEqual(r.code, 0);
  assert.match(r.err + r.out, /fail closed|did not execute/i);
});

// --- Mismatched identities refuse ---

test("mismatch: wrong project on production deployment_status refused", async () => {
  const api = await apiWith([
    mkDeploy({
      projectId: "prj_other",
      target: "production",
      url: "wrong-proj-prod.vercel.app",
    }),
  ]);
  const r = await run({
    EVENT_NAME: "deployment_status",
    DEPLOY_STATE: "success",
    DEPLOY_URL: "https://wrong-proj-prod.vercel.app",
    DEPLOY_SHA: SHA,
    ...baseEnv,
    VERCEL_API_BASE: api.base,
  });
  await api.close();
  assert.notEqual(r.code, 0);
  assert.match(r.err + r.out, /project/i);
});

test("mismatch: wrong SHA on production push refused", async () => {
  const api = await apiWith([
    mkDeploy({ sha: SHA, target: "production", url: "prod.vercel.app" }),
  ]);
  const r = await run({
    EVENT_NAME: "push",
    PUSH_SHA: OTHER,
    ...baseEnv,
    VERCEL_API_BASE: api.base,
  });
  await api.close();
  assert.notEqual(r.code, 0);
});

test("mismatch: staging deployment_status refused", async () => {
  const api = await apiWith([
    mkDeploy({ target: "staging", url: "staging-app.vercel.app" }),
  ]);
  const r = await run({
    EVENT_NAME: "deployment_status",
    DEPLOY_STATE: "success",
    DEPLOY_URL: "https://staging-app.vercel.app",
    DEPLOY_SHA: SHA,
    ...baseEnv,
    VERCEL_API_BASE: api.base,
  });
  await api.close();
  assert.notEqual(r.code, 0);
  assert.match(r.err + r.out, /staging|refusing|does not match/i);
});

test("mismatch: ERROR-state production deployment refused on push", async () => {
  const api = await apiWith([
    mkDeploy({
      target: "production",
      readyState: "ERROR",
      url: "broken-prod.vercel.app",
    }),
  ]);
  const r = await run({
    EVENT_NAME: "push",
    PUSH_SHA: SHA,
    ...baseEnv,
    VERCEL_API_BASE: api.base,
  });
  await api.close();
  assert.notEqual(r.code, 0);
  assert.match(r.err + r.out, /READY|not READY|ERROR|failed/i);
});

test("mismatch: ERROR-state production URL on deployment_status refused", async () => {
  const api = await apiWith([
    mkDeploy({
      target: "production",
      readyState: "ERROR",
      url: "broken-prod.vercel.app",
    }),
  ]);
  const r = await run({
    EVENT_NAME: "deployment_status",
    DEPLOY_STATE: "success",
    DEPLOY_URL: "https://broken-prod.vercel.app",
    DEPLOY_SHA: SHA,
    ...baseEnv,
    VERCEL_API_BASE: api.base,
  });
  await api.close();
  assert.notEqual(r.code, 0);
  assert.match(r.err + r.out, /ERROR|READY|refusing|state/i);
});

test("mismatch: foreign production URL on deployment_status refused", async () => {
  const api = await apiWith([
    mkDeploy({ target: "production", url: "real-prod.vercel.app" }),
  ]);
  const r = await run({
    EVENT_NAME: "deployment_status",
    DEPLOY_STATE: "success",
    DEPLOY_URL: "https://evil.example",
    DEPLOY_SHA: SHA,
    ...baseEnv,
    VERCEL_API_BASE: api.base,
  });
  await api.close();
  assert.notEqual(r.code, 0);
  assert.match(r.err + r.out, /foreign|does not match|refusing/i);
});

test("production path picks newest Ready production among matches", async () => {
  const older = mkDeploy({
    target: "production",
    url: "old-prod-unique.vercel.app",
    uid: "dpl_old",
    createdAt: 1000,
  });
  const newer = mkDeploy({
    target: "production",
    url: "new-prod-unique.vercel.app",
    uid: "dpl_new",
    createdAt: 9000,
  });
  const api = await apiWith([older, newer], {
    dpl_old: [publicAliasEntry("dpl_old", "old-public.vercel.app")],
    dpl_new: [publicAliasEntry("dpl_new", "new-public.vercel.app")],
  });
  const r = await run({
    EVENT_NAME: "push",
    PUSH_SHA: SHA,
    ...baseEnv,
    VERCEL_API_BASE: api.base,
  });
  await api.close();
  assert.equal(r.code, 0);
  assert.match(r.out, /base=https:\/\/new-public\.vercel\.app/);
  assert.doesNotMatch(r.out, /base=https:\/\/new-prod-unique\.vercel\.app/);
  assert.match(r.out, /mode=production/);
  assert.match(r.out, /credentialed=false/);
});


// --- C1: public production alias binding (uncredentialed base) ---

test("C1: positive public-alias bind on push (prefer shortest ≠ unique)", async () => {
  const unique = "raven-worldsfair-2026-abc123xyz.vercel.app";
  const longAlias = "raven-worldsfair-2026-git-main-team.vercel.app";
  const shortAlias = "raven-worldsfair-2026.vercel.app";
  const api = await apiWith(
    [mkDeploy({ target: "production", url: unique, uid: "dpl_c1" })],
    {
      dpl_c1: [
        publicAliasEntry("dpl_c1", unique), // unique also listed — must not be chosen
        publicAliasEntry("dpl_c1", longAlias),
        publicAliasEntry("dpl_c1", shortAlias),
      ],
    },
  );
  const r = await run({
    EVENT_NAME: "push",
    PUSH_SHA: SHA,
    ...baseEnv,
    VERCEL_API_BASE: api.base,
  });
  await api.close();
  assert.equal(r.code, 0);
  assert.match(r.out, /base=https:\/\/raven-worldsfair-2026\.vercel\.app/);
  assert.doesNotMatch(r.out, new RegExp(`base=https://${unique.replace(/\\./g, "\\\\.")}`));
  assert.match(r.out, /mode=production/);
  assert.match(r.out, /credentialed=false/);
});

test("C1: empty aliases → refuse (no unique-host fallback)", async () => {
  const unique = "only-unique.vercel.app";
  const api = await apiWith(
    [mkDeploy({ target: "production", url: unique, uid: "dpl_empty" })],
    { dpl_empty: [] },
  );
  const r = await run({
    EVENT_NAME: "push",
    PUSH_SHA: SHA,
    ...baseEnv,
    VERCEL_API_BASE: api.base,
  });
  await api.close();
  assert.notEqual(r.code, 0);
  assert.match(r.err + r.out, /alias|unique|refusing/i);
});

test("C1: only unique host among aliases → refuse", async () => {
  const unique = "only-unique-host.vercel.app";
  const api = await apiWith(
    [mkDeploy({ target: "production", url: unique, uid: "dpl_uniq" })],
    { dpl_uniq: [publicAliasEntry("dpl_uniq", unique)] },
  );
  const r = await run({
    EVENT_NAME: "push",
    PUSH_SHA: SHA,
    ...baseEnv,
    VERCEL_API_BASE: api.base,
  });
  await api.close();
  assert.notEqual(r.code, 0);
  assert.match(r.err + r.out, /unique|refusing|deployment\\.url/i);
});

test("C1: rebound alias (wrong deploymentId) → refuse", async () => {
  const unique = "rebound-unique.vercel.app";
  const api = await apiWith(
    [mkDeploy({ target: "production", url: unique, uid: "dpl_rebound" })],
    {
      dpl_rebound: [
        {
          alias: "raven-worldsfair-2026.vercel.app",
          deploymentId: "dpl_other",
          uid: "alias_wrong",
        },
      ],
    },
  );
  const r = await run({
    EVENT_NAME: "push",
    PUSH_SHA: SHA,
    ...baseEnv,
    VERCEL_API_BASE: api.base,
  });
  await api.close();
  assert.notEqual(r.code, 0);
  assert.match(r.err + r.out, /rebound|deploymentId|refusing/i);
});

test("C1: deployment_status unique URL → resolves to public alias base", async () => {
  const unique = "dpl-unique-status.vercel.app";
  const publicHost = "raven-worldsfair-2026.vercel.app";
  const api = await apiWith(
    [mkDeploy({ target: "production", url: unique, uid: "dpl_status" })],
    { dpl_status: [publicAliasEntry("dpl_status", publicHost)] },
  );
  const r = await run({
    EVENT_NAME: "deployment_status",
    DEPLOY_STATE: "success",
    DEPLOY_URL: `https://${unique}`,
    DEPLOY_SHA: SHA,
    ...baseEnv,
    VERCEL_API_BASE: api.base,
  });
  await api.close();
  assert.equal(r.code, 0);
  assert.match(r.out, /base=https:\/\/raven-worldsfair-2026\.vercel\.app/);
  assert.doesNotMatch(r.out, /base=https:\/\/dpl-unique-status\.vercel\.app/);
  assert.match(r.out, /mode=production/);
  assert.match(r.out, /credentialed=false/);
});

test("C1: pull_request still refuses production (preview path unchanged)", async () => {
  const unique = "prod-unique-for-pr.vercel.app";
  const api = await apiWith(
    [mkDeploy({ target: "production", url: unique, uid: "dpl_pr_prod" })],
    {
      dpl_pr_prod: [publicAliasEntry("dpl_pr_prod", "raven-worldsfair-2026.vercel.app")],
    },
  );
  const r = await run({
    EVENT_NAME: "pull_request",
    PR_HEAD_SHA: SHA,
    ...baseEnv,
    VERCEL_API_BASE: api.base,
  });
  await api.close();
  assert.notEqual(r.code, 0);
  assert.match(r.err + r.out, /production/i);
});

test("C1: push SECRET_URL must match public bound base (not unique host)", async () => {
  const unique = "secret-unique.vercel.app";
  const publicHost = "raven-worldsfair-2026.vercel.app";
  const api = await apiWith(
    [mkDeploy({ target: "production", url: unique, uid: "dpl_sec" })],
    { dpl_sec: [publicAliasEntry("dpl_sec", publicHost)] },
  );
  const bad = await run({
    EVENT_NAME: "push",
    PUSH_SHA: SHA,
    SECRET_URL: `https://${unique}`,
    ...baseEnv,
    VERCEL_API_BASE: api.base,
  });
  assert.notEqual(bad.code, 0);
  assert.match(bad.err + bad.out, /JUDGE_VERIFY_BASE_URL|does not match|refusing/i);

  const good = await run({
    EVENT_NAME: "push",
    PUSH_SHA: SHA,
    SECRET_URL: `https://${publicHost}`,
    ...baseEnv,
    VERCEL_API_BASE: api.base,
  });
  await api.close();
  assert.equal(good.code, 0);
  assert.match(good.out, /base=https:\/\/raven-worldsfair-2026\.vercel\.app/);
});


test("fixture-only: no live Vercel — mock HTTP only (this suite)", async () => {
  // Guard: every passing case above used VERCEL_API_BASE mock server.
  // Local fixture results are not a hosted workflow PASS claim.
  assert.equal(typeof listen, "function");
  assert.ok(true, "fixture-only suite; do not claim hosted PASS from local runs");
});
