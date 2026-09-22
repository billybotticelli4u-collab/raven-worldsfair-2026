#!/usr/bin/env node
/**
 * Fail-closed resolver for verify-judge-url.
 *
 * Outputs (GitHub Actions): skip=false, base, expected, mode=preview|production, credentialed=true|false
 *
 * Preview path (PR / workflow_dispatch / preview deployment_status):
 * - Deployment must belong to configured Vercel project/team
 * - Commit SHA must match exactly
 * - API metadata must establish preview (target null|"preview"; never production/staging)
 * - URL must be HTTPS, no userinfo/query/fragment
 * - Event URL (if any) must equal the resolved deployment URL
 * - credentialed=true (Deployment Protection bypass allowed for that bound origin only)
 *
 * Production path (push / production deployment_status):
 * - Separate resolveProductionForCommit — NOT a fallback inside the preview resolver
 * - READY + target==="production" only; project ownership; newest match
 * - Discover aliases via GET /v2/deployments/{uid}/aliases (real list shape:
 *   alias/created/redirect/uid — no invented list-entry deploymentId)
 * - For each public candidate (host ≠ unique deployment.url; skip redirect aliases):
 *   GET /v4/aliases/{idOrAlias} and require detail.deploymentId == uid and
 *   detail.projectId == VERCEL_PROJECT_ID
 * - Emit https://{publicAlias} only; refuse unique deployment.url as uncredentialed base
 * - credentialed=false (public application check; no cookie/bypass)
 *
 * Never skip-as-pass. Unrelated / stale / failed / foreign URLs refuse.
 *
 * Env:
 *   EVENT_NAME, DEPLOY_STATE, DEPLOY_URL, DEPLOY_SHA,
 *   INPUT_URL, INPUT_COMMIT, PR_HEAD_SHA, PUSH_SHA, SECRET_URL,
 *   VERCEL_TOKEN, VERCEL_PROJECT_ID, VERCEL_TEAM_ID (optional),
 *   VERCEL_API_BASE (test override)
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

function isProductionTarget(deployment) {
  if (!Object.prototype.hasOwnProperty.call(deployment, "target")) return false;
  return deployment.target === "production";
}

function deploymentState(d) {
  return String(d.readyState || d.state || "").toUpperCase();
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

function urlMatchesDeployment(wantUrl, deployment) {
  const raw = deploymentHttpsUrl(deployment);
  if (!raw) return false;
  const depUrl = normalizeOriginUrl(raw);
  if (wantUrl === depUrl) return true;
  const hostOnly = new URL(wantUrl).host;
  const depHost = String(deployment.url || "").replace(/^https?:\/\//, "");
  return hostOnly === depHost;
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

/** List Vercel deployments for exact commit in configured project (shared lookup). */
async function listDeploymentsForCommit(commit) {
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
  return Array.isArray(data.deployments) ? data.deployments : [];
}

function pickNewest(matched) {
  matched.sort((a, b) => (b.createdAt || b.created || 0) - (a.createdAt || a.created || 0));
  return matched[0];
}

/** Project ownership for every path that emits a verify base. */
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

function uniqueDeploymentHost(d) {
  return String(d.url || "")
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "")
    .toLowerCase();
}

/**
 * Fetch aliases for a deployment uid (list shape only).
 * Live GET /v2/deployments/{uid}/aliases returns {alias, created, redirect, uid}
 * — no deploymentId on list entries. Honors VERCEL_TEAM_ID when set.
 */
async function fetchDeploymentAliases(uid) {
  if (!uid) fail("Deployment uid required to fetch aliases");
  const teamId = process.env.VERCEL_TEAM_ID || "";
  const qs = new URLSearchParams();
  if (teamId) qs.set("teamId", teamId);
  const q = qs.toString() ? `?${qs}` : "";
  const res = await vercelFetch(`/v2/deployments/${encodeURIComponent(uid)}/aliases${q}`);
  if (!res.ok) fail(`Vercel deployment aliases lookup failed: HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data.aliases) ? data.aliases : [];
}

/**
 * Fetch alias DETAIL via GET /v4/aliases/{idOrAlias}.
 * Detail carries deploymentId + projectId used for binding verification.
 * Honors VERCEL_TEAM_ID when set. Returns null on 404; fails on other errors.
 */
async function fetchAliasDetail(idOrAlias) {
  if (!idOrAlias) fail("Alias idOrAlias required for detail lookup");
  const teamId = process.env.VERCEL_TEAM_ID || "";
  const qs = new URLSearchParams();
  if (teamId) qs.set("teamId", teamId);
  const q = qs.toString() ? `?${qs}` : "";
  const res = await vercelFetch(`/v4/aliases/${encodeURIComponent(idOrAlias)}${q}`);
  if (res.status === 404) return null;
  if (!res.ok) fail(`Vercel alias detail lookup failed: HTTP ${res.status}`);
  return await res.json();
}

function aliasListHost(entry) {
  return String(entry.alias || "")
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "")
    .toLowerCase();
}

function aliasIsRedirect(entry) {
  // Live list/detail may set redirect to a target host when the alias redirects.
  return entry.redirect != null && String(entry.redirect).trim() !== "";
}

/**
 * Bind public production address for a Ready production deployment.
 * Discovers candidates from deployment-scoped list (real shape; no invented
 * list-entry deploymentId). Verifies each candidate via GET /v4/aliases/{idOrAlias}
 * requiring detail.deploymentId == uid and detail.projectId == VERCEL_PROJECT_ID.
 * Refuses unique deployment.url as the uncredentialed verify base.
 * Prefers shortest / stable project alias among verified public hosts.
 */
async function bindPublicProductionAlias(deployment) {
  const uid = String(deployment.uid || deployment.id || "");
  if (!uid) {
    fail("Production deployment missing uid; cannot bind public alias.");
  }
  const uniqueHost = uniqueDeploymentHost(deployment);
  if (!uniqueHost) {
    fail("Production deployment has no unique URL host; refusing.");
  }
  const wantProject = process.env.VERCEL_PROJECT_ID || "";
  if (!wantProject) fail("VERCEL_PROJECT_ID required");

  const aliases = await fetchDeploymentAliases(uid);
  if (aliases.length === 0) {
    fail(
      `No aliases for production deployment ${uid}; refusing unique deployment.url as uncredentialed verify base.`,
    );
  }

  // Candidates from list shape only: {alias, created, redirect, uid}
  // Do not invent or require deploymentId on list entries.
  const candidates = [];
  let sawRedirectOnly = false;
  for (const a of aliases) {
    if (aliasIsRedirect(a)) {
      sawRedirectOnly = true;
      continue; // refuse redirecting aliases as verify base
    }
    const host = aliasListHost(a);
    if (!host) continue;
    if (host === uniqueHost) continue; // never use unique deployment host
    const idOrAlias = a.uid || a.alias || host;
    candidates.push({ host, idOrAlias, listEntry: a });
  }

  if (candidates.length === 0) {
    // Distinguish: only unique host vs only redirects vs empty usable
    const nonRedirectHosts = [];
    for (const a of aliases) {
      if (aliasIsRedirect(a)) continue;
      const host = aliasListHost(a);
      if (host) nonRedirectHosts.push(host);
    }
    if (nonRedirectHosts.length > 0 && nonRedirectHosts.every((h) => h === uniqueHost)) {
      fail(
        `Only unique deployment host found among aliases for ${uid}; refusing deployment.url as uncredentialed verify base.`,
      );
    }
    if (sawRedirectOnly) {
      fail(
        `Only redirecting aliases for production deployment ${uid}; refusing redirect aliases as uncredentialed verify base.`,
      );
    }
    fail(
      `No public (non-unique, non-redirect) aliases for production deployment ${uid}; refusing.`,
    );
  }

  // Prefer shortest / stable among candidates, then verify via detail
  candidates.sort((a, b) => a.host.length - b.host.length || a.host.localeCompare(b.host));

  const verified = [];
  let sawMissingDetail = false;
  let sawMissingFields = false;
  let sawWrongDeploymentId = false;
  let sawWrongProjectId = false;

  for (const c of candidates) {
    const detail = await fetchAliasDetail(c.idOrAlias);
    if (detail == null) {
      sawMissingDetail = true;
      continue;
    }
    // Also refuse if detail itself is a redirect
    if (aliasIsRedirect(detail)) {
      sawRedirectOnly = true;
      continue;
    }
    const detailDepId =
      detail.deploymentId != null && detail.deploymentId !== ""
        ? String(detail.deploymentId)
        : detail.deployment && detail.deployment.id != null && detail.deployment.id !== ""
          ? String(detail.deployment.id)
          : "";
    const detailProjectId =
      detail.projectId != null && detail.projectId !== "" ? String(detail.projectId) : "";

    if (!detailDepId || !detailProjectId) {
      sawMissingFields = true;
      continue;
    }
    if (detailDepId !== uid) {
      sawWrongDeploymentId = true;
      continue;
    }
    if (detailProjectId !== String(wantProject)) {
      sawWrongProjectId = true;
      continue;
    }
    verified.push(c.host);
  }

  if (verified.length === 0) {
    if (sawWrongDeploymentId) {
      fail(
        `Alias rebound: detail deploymentId does not match production deployment ${uid}; refusing.`,
      );
    }
    if (sawWrongProjectId) {
      fail(
        `Alias detail projectId mismatch (foreign project); refusing.`,
      );
    }
    if (sawMissingFields) {
      fail(
        `Alias detail missing deploymentId or projectId for production deployment ${uid}; refusing.`,
      );
    }
    if (sawMissingDetail) {
      fail(
        `Alias detail missing (404) for candidates of production deployment ${uid}; refusing.`,
      );
    }
    fail(
      `No verified public alias (detail deploymentId+projectId) for production deployment ${uid}; refusing.`,
    );
  }

  const publicAlias = verified[0]; // already sorted by candidate preference
  const url = `https://${publicAlias}`;
  assertSafeVerifyUrl(url, "bound public production alias");
  return normalizeOriginUrl(url);
}

/**
 * Resolve Ready preview deployment for exact commit in configured project.
 * Fail-closed: refuses production/staging; no production fallback.
 */
async function resolvePreviewForCommit(commit) {
  const list = await listDeploymentsForCommit(commit);

  const matched = list.filter((d) => {
    const shaOk = deploymentCommit(d) === commit.toLowerCase();
    const ready = deploymentState(d) === "READY";
    const preview = isPreviewTarget(d);
    return shaOk && ready && preview;
  });

  if (matched.length === 0) {
    // Distinguish production-only hit for clearer errors
    const prodHit = list.some(
      (d) =>
        deploymentCommit(d) === commit.toLowerCase() &&
        deploymentState(d) === "READY" &&
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

  const d = pickNewest(matched);
  assertProjectOwnership(d);
  const url = deploymentHttpsUrl(d);
  if (!url) fail(`Preview deployment for ${commit} has no URL`);
  assertSafeVerifyUrl(url, "resolved preview");
  return { url: normalizeOriginUrl(url), deployment: d, uid: d.uid || d.id || "" };
}

/**
 * Resolve Ready production deployment for exact commit in configured project.
 * Separate from preview resolver — never used as preview fallback.
 * READY + target==="production" only; project ownership; newest match;
 * then bind public alias via list + /v4/aliases/{idOrAlias} detail (refuse unique host).
 */
async function resolveProductionForCommit(commit) {
  const list = await listDeploymentsForCommit(commit);

  const matched = list.filter((d) => {
    const shaOk = deploymentCommit(d) === commit.toLowerCase();
    const ready = deploymentState(d) === "READY";
    const production = isProductionTarget(d);
    return shaOk && ready && production;
  });

  if (matched.length === 0) {
    const previewOnly = list.some(
      (d) =>
        deploymentCommit(d) === commit.toLowerCase() &&
        deploymentState(d) === "READY" &&
        isPreviewTarget(d),
    );
    if (previewOnly) {
      fail(
        `Only preview deployment(s) found for commit ${commit}; push/production path requires Ready production (no preview fallback).`,
      );
    }
    const stagingHit = list.some(
      (d) =>
        deploymentCommit(d) === commit.toLowerCase() &&
        deploymentState(d) === "READY" &&
        d.target === "staging",
    );
    if (stagingHit) {
      fail(`Staging deployment found for commit ${commit}; refusing (production target required).`);
    }
    const errorHit = list.some(
      (d) =>
        deploymentCommit(d) === commit.toLowerCase() &&
        isProductionTarget(d) &&
        deploymentState(d) !== "READY",
    );
    if (errorHit) {
      fail(
        `Production deployment for commit ${commit} is not READY; refusing (failed/stale deployment must not PASS).`,
      );
    }
    fail(
      `No Ready production deployment found for commit ${commit} in project; fail-closed (no skip-as-pass).`,
    );
  }

  const d = pickNewest(matched);
  assertProjectOwnership(d);
  // C1: bind public production alias — never emit unique deployment.url as uncredentialed base
  const url = await bindPublicProductionAlias(d);
  return { url, deployment: d, uid: d.uid || d.id || "" };
}

/**
 * Verify an event-provided URL is the project's Ready preview for commit.
 */
async function bindEventUrlToPreview(eventUrl, commit) {
  const want = normalizeOriginUrl(eventUrl);
  const { url, deployment } = await resolvePreviewForCommit(commit);
  if (want !== url) {
    const hostOnly = new URL(want).host;
    const depHost = String(deployment.url || "").replace(/^https?:\/\//, "");
    if (hostOnly !== depHost) {
      fail(
        `Event URL ${want} does not match project preview for commit ${commit} (${url}); refusing foreign/unbound origin.`,
      );
    }
  }
  return url;
}

/**
 * Classify deployment_status URL against Ready production vs preview for commit.
 * Foreign / staging / non-READY / wrong project / wrong SHA → refuse.
 */
async function classifyDeploymentStatusUrl(eventUrl, commit) {
  const want = normalizeOriginUrl(eventUrl);
  const list = await listDeploymentsForCommit(commit);
  const sha = commit.toLowerCase();

  const sameCommit = list.filter((d) => deploymentCommit(d) === sha);

  // Prefer exact Ready production match
  const prodReady = sameCommit.filter(
    (d) => deploymentState(d) === "READY" && isProductionTarget(d) && urlMatchesDeployment(want, d),
  );
  if (prodReady.length > 0) {
    const d = pickNewest(prodReady);
    assertProjectOwnership(d);
    // Event may carry unique deployment URL; emit bound public alias as base
    const url = await bindPublicProductionAlias(d);
    return { url, mode: "production", credentialed: false, deployment: d };
  }

  // Ready preview match
  const previewReady = sameCommit.filter(
    (d) => deploymentState(d) === "READY" && isPreviewTarget(d) && urlMatchesDeployment(want, d),
  );
  if (previewReady.length > 0) {
    const d = pickNewest(previewReady);
    assertProjectOwnership(d);
    const url = normalizeOriginUrl(deploymentHttpsUrl(d));
    return { url, mode: "preview", credentialed: true, deployment: d };
  }

  // Explicit mismatch diagnostics (still refuse)
  const urlAny = sameCommit.filter((d) => urlMatchesDeployment(want, d));
  if (urlAny.length > 0) {
    const d = urlAny[0];
    assertProjectOwnership(d); // foreign project still refused if ownership fails first
    if (d.target === "staging") {
      fail(`Event URL matches staging deployment for ${commit}; refusing (preview or production Ready required).`);
    }
    const st = deploymentState(d);
    if (st !== "READY") {
      fail(
        `Event URL matches deployment in state ${st} for ${commit}; refusing (READY required; failed deployment must not PASS).`,
      );
    }
    fail(`Event URL matched a non-preview/non-production deployment for ${commit}; refusing.`);
  }

  // URL might match a deployment with wrong SHA in the list (API meta filter should prevent),
  // or a completely foreign URL.
  fail(
    `Event URL ${want} does not match Ready production or preview for commit ${commit}; refusing foreign/unbound origin.`,
  );
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
let mode = "";
let credentialed = true;

if (event === "workflow_dispatch") {
  if (!inputUrl) fail("workflow_dispatch requires base_url");
  if (!isHex40(inputCommit)) fail("workflow_dispatch requires expected_commit (40-hex)");
  // Typed URL alone is not enough — bind to project preview for that commit.
  expected = inputCommit;
  base = await bindEventUrlToPreview(inputUrl, expected);
  mode = "preview";
  credentialed = true;
} else if (event === "deployment_status") {
  if (deployState !== "success") {
    fail(`deployment_status=${deployState} did not execute verification; required checks must fail closed.`);
  }
  if (!deployUrl) fail("deployment_status missing environment/target URL");
  if (!isHex40(deploySha)) {
    fail("deployment_status missing deployment commit SHA; refusing github.sha fallback that could confuse merge and head.");
  }
  expected = deploySha;
  const classified = await classifyDeploymentStatusUrl(deployUrl, expected);
  base = classified.url;
  mode = classified.mode;
  credentialed = classified.credentialed;
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
  mode = "preview";
  credentialed = true;
} else if (event === "push") {
  if (!isHex40(pushSha)) fail("push missing github.sha");
  expected = pushSha;
  // Push requires Ready production for this commit (separate production path).
  const resolved = await resolveProductionForCommit(expected);
  if (secretUrl) {
    const secretNorm = normalizeOriginUrl(secretUrl);
    if (secretNorm !== resolved.url) {
      fail(`JUDGE_VERIFY_BASE_URL does not match exact production for ${expected}; refusing.`);
    }
  }
  base = resolved.url;
  mode = "production";
  credentialed = false;
} else {
  fail(`unsupported event_name=${event}`);
}

if (!base) fail("internal: empty base");
if (!isHex40(expected)) fail("internal: bad expected commit");
if (mode !== "preview" && mode !== "production") fail("internal: bad mode");
assertSafeVerifyUrl(base, "final base");
out("skip", "false");
out("base", base);
out("expected", expected);
out("mode", mode);
out("credentialed", credentialed ? "true" : "false");
console.log(`Target host (no secrets): ${new URL(base).origin} mode=${mode} credentialed=${credentialed}`);
