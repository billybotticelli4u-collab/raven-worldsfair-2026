#!/usr/bin/env node
/**
 * Fail-closed resolver for verify-judge-url.
 *
 * Outputs (GitHub Actions): base, expected, skip=false
 *
 * Before any credential-bearing verify target is emitted:
 * - Deployment must belong to configured Vercel project/team
 * - Commit SHA must match exactly
 * - API metadata must establish preview / non-production (target !== production)
 * - URL must be HTTPS, no userinfo/query/fragment
 * - Event URL (if any) must equal the resolved deployment URL
 *
 * Never falls back to production. Never skip-as-pass.
 *
 * Env:
 *   EVENT_NAME, DEPLOY_STATE, DEPLOY_URL, DEPLOY_SHA,
 *   INPUT_URL, INPUT_COMMIT, PR_HEAD_SHA, PUSH_SHA, SECRET_URL,
 *   VERCEL_TOKEN, VERCEL_PROJECT_ID, VERCEL_TEAM_ID (optional),
 *   VERCEL_API_BASE (test override), FETCH_IMPL unused — tests inject via VERCEL_API_BASE + mock server
 */
import { appendFileSync } from "node:fs";

function fail(msg) {
  console.error(`::error::${msg}`);
  process.exit(1);
}

function out(k, v) {
  const line = `${k}=${v}\n`;
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, line);
  console.log(line.trim());
}

function isHex40(s) {
  return /^[0-9a-f]{40}$/i.test(s || "");
}

/** Reject URLs that must never carry automation credentials. */
export function assertSafeVerifyUrl(url, label = "url") {
  let u;
  try {
    u = new URL(url);
  } catch {
    fail(`${label} is not a valid URL`);
  }
  if (u.protocol !== "https:") {
    fail(`${label} must be HTTPS (got ${u.protocol})`);
  }
  if (u.username || u.password) {
    fail(`${label} must not contain credentials`);
  }
  if (u.search) {
    fail(`${label} must not contain a query string`);
  }
  if (u.hash) {
    fail(`${label} must not contain a fragment`);
  }
  return u;
}

function normalizeOriginUrl(url) {
  const u = assertSafeVerifyUrl(url);
  // Canonical form: https://host[/path] without trailing slash (except root)
  let href = u.origin + (u.pathname === "/" ? "" : u.pathname.replace(/\/$/, ""));
  return href;
}

function isPreviewTarget(deployment) {
  // Documented Vercel deployment target: optional/nullable enum production|staging.
  // Official deployment-detail docs: target === null means preview.
  // Distinguish explicit null (preview) from missing/undefined (unknown — refuse).
  // Also accept literal "preview" if an API variant emits it; never treat missing as preview.
  if (!Object.prototype.hasOwnProperty.call(deployment, "target")) return false;
  const target = deployment.target;
  if (target === null) return true;
  if (target === "preview") return true;
  return false; // production, staging, other strings, or unexpected types
}

function deploymentCommit(d) {
  const meta = d.meta || {};
  return String(meta.githubCommitSha || "").toLowerCase();
}

function deploymentHttpsUrl(d) {
  if (!d.url) return "";
  // d.url is hostname without scheme
  return `https://${String(d.url).replace(/^https?:\/\//, "")}`;
}

async function vercelFetch(pathAndQuery) {
  const token = process.env.VERCEL_TOKEN || "";
  const apiBase = (process.env.VERCEL_API_BASE || "https://api.vercel.com").replace(/\/$/, "");
  if (!token) fail("VERCEL_TOKEN required to authenticate deployment identity");
  const res = await fetch(`${apiBase}${pathAndQuery}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res;
}

/**
 * Resolve Ready preview deployment for exact commit in configured project.
 */
async function resolvePreviewForCommit(commit) {
  const projectId = process.env.VERCEL_PROJECT_ID || "";
  const teamId = process.env.VERCEL_TEAM_ID || "";
  if (!projectId) fail("VERCEL_PROJECT_ID required");
  if (!isHex40(commit)) fail("commit must be 40-hex");

  const qs = new URLSearchParams({
    projectId,
    "meta-githubCommitSha": commit,
    limit: "20",
  });
  if (teamId) qs.set("teamId", teamId);

  const res = await vercelFetch(`/v6/deployments?${qs}`);
  if (!res.ok) fail(`Vercel deployments lookup failed: HTTP ${res.status}`);
  const data = await res.json();
  const list = Array.isArray(data.deployments) ? data.deployments : [];

  const matched = list.filter((d) => {
    const state = String(d.readyState || d.state || "").toUpperCase();
    const shaOk = deploymentCommit(d) === commit.toLowerCase();
    const ready = state === "READY";
    const preview = isPreviewTarget(d);
    return shaOk && ready && preview;
  });

  if (matched.length === 0) {
    // Distinguish production-only hit for clearer errors
    const prodHit = list.some(
      (d) =>
        deploymentCommit(d) === commit.toLowerCase() &&
        String(d.readyState || d.state || "").toUpperCase() === "READY" &&
        (d.target === "production" || d.target === "staging"),
    );
    if (prodHit) {
      fail(
        `Only production/staging deployment(s) found for commit ${commit}; refusing (preview required, no production fallback).`,
      );
    }
    fail(
      `No Ready preview deployment found for commit ${commit} in project; fail-closed (no production fallback, no skip-as-pass).`,
    );
  }

  matched.sort((a, b) => (b.createdAt || b.created || 0) - (a.createdAt || a.created || 0));
  const d = matched[0];
  assertProjectOwnership(d);
  const url = deploymentHttpsUrl(d);
  if (!url) fail(`Preview deployment for ${commit} has no URL`);
  assertSafeVerifyUrl(url, "resolved preview");
  return { url: normalizeOriginUrl(url), deployment: d, uid: d.uid || d.id || "" };
}

/** Project ownership for every path that emits a credential-bearing base. */
function assertProjectOwnership(d) {
  const want = process.env.VERCEL_PROJECT_ID || "";
  if (!want) fail("VERCEL_PROJECT_ID required");
  if (d.projectId == null || d.projectId === "") {
    fail("Deployment missing projectId; refusing (cannot verify project ownership).");
  }
  if (String(d.projectId) !== String(want)) {
    fail("Deployment projectId mismatch; refusing foreign project.");
  }
}

/**
 * Verify an event-provided URL is the project's Ready preview for commit.
 */
async function bindEventUrlToPreview(eventUrl, commit) {
  const want = normalizeOriginUrl(eventUrl);
  const { url, deployment, uid } = await resolvePreviewForCommit(commit);
  if (want !== url) {
    // Also accept if event URL host matches deployment.url exactly
    const hostOnly = new URL(want).host;
    const depHost = String(deployment.url || "").replace(/^https?:\/\//, "");
    if (hostOnly !== depHost) {
      fail(
        `Event URL ${want} does not match project preview for commit ${commit} (${url}); refusing foreign/unbound origin.`,
      );
    }
  }
  // Project ownership already enforced inside resolvePreviewForCommit (all four events).
  return url;
}

const event = process.env.EVENT_NAME || "";
const deployState = process.env.DEPLOY_STATE || "";
const deployUrl = (process.env.DEPLOY_URL || "").replace(/\/$/, "");
const deploySha = (process.env.DEPLOY_SHA || "").toLowerCase();
const inputUrl = (process.env.INPUT_URL || "").replace(/\/$/, "");
const inputCommit = (process.env.INPUT_COMMIT || "").toLowerCase();
const prHead = (process.env.PR_HEAD_SHA || "").toLowerCase();
const pushSha = (process.env.PUSH_SHA || "").toLowerCase();
const secretUrl = (process.env.SECRET_URL || "").replace(/\/$/, "");

let base = "";
let expected = "";

if (event === "workflow_dispatch") {
  if (!inputUrl) fail("workflow_dispatch requires base_url");
  if (!isHex40(inputCommit)) fail("workflow_dispatch requires expected_commit (40-hex)");
  // Typed URL alone is not enough — bind to project preview for that commit.
  expected = inputCommit;
  base = await bindEventUrlToPreview(inputUrl, expected);
} else if (event === "deployment_status") {
  if (deployState !== "success") {
    fail(`deployment_status=${deployState} did not execute verification; required checks must fail closed.`);
  }
  if (!deployUrl) fail("deployment_status missing environment/target URL");
  if (!isHex40(deploySha)) {
    fail("deployment_status missing deployment commit SHA; refusing github.sha fallback that could confuse merge and head.");
  }
  expected = deploySha;
  base = await bindEventUrlToPreview(deployUrl, expected);
} else if (event === "pull_request") {
  if (!isHex40(prHead)) fail("pull_request missing head.sha");
  expected = prHead;
  const resolved = await resolvePreviewForCommit(expected);
  if (secretUrl) {
    const secretNorm = normalizeOriginUrl(secretUrl);
    if (secretNorm !== resolved.url) {
      fail(
        `JUDGE_VERIFY_BASE_URL (${secretNorm}) does not match exact preview for head ${expected} (${resolved.url}).`,
      );
    }
  }
  base = resolved.url;
} else if (event === "push") {
  if (!isHex40(pushSha)) fail("push missing github.sha");
  expected = pushSha;
  if (secretUrl) {
    // Must still equal resolved preview — never silent prod
    const resolved = await resolvePreviewForCommit(expected);
    const secretNorm = normalizeOriginUrl(secretUrl);
    if (secretNorm !== resolved.url) {
      fail(`JUDGE_VERIFY_BASE_URL does not match exact preview for ${expected}; refusing.`);
    }
    base = resolved.url;
  } else {
    base = (await resolvePreviewForCommit(expected)).url;
  }
} else {
  fail(`unsupported event_name=${event}`);
}

if (!base) fail("internal: empty base");
if (!isHex40(expected)) fail("internal: bad expected commit");
assertSafeVerifyUrl(base, "final base");
out("skip", "false");
out("base", base);
out("expected", expected);
console.log(`Target host (no secrets): ${new URL(base).origin}`);
