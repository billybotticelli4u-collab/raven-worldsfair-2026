#!/usr/bin/env node
/**
 * Standalone harness — raven-solana-demo.
 *
 * Mirrors the MVP interface (apps/raven-conformance): spawn per vector with a
 * restricted env and timeout, compare observed vs corpus-expected. Extends the
 * comparison to decision AND version (the MVP compares decision labels only).
 * Dependency-free. Does not import Billy's engine.
 *
 *   node harness/run.js --target SOL_CONFORMANT_REFERENCE
 *   node harness/run.js --all --json
 */
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const TIMEOUT_MS = 3000;

const profilePath = path.join(ROOT, "profiles", "raven-solana-txversion-experimental-0.json");
const corpusPath = path.join(ROOT, "corpus", "raven-solana-txversion-demo-corpus-1.json");
const manifestsPath = path.join(ROOT, "targets", "manifests.json");

const sha256Hex = (s) => createHash("sha256").update(s).digest("hex");
const fileSha = (p) => sha256Hex(readFileSync(p));

const profile = { data: JSON.parse(readFileSync(profilePath, "utf8")), sha256: fileSha(profilePath) };
const corpusRaw = readFileSync(corpusPath, "utf8");
const corpusData = JSON.parse(corpusRaw);
const corpusDigest = sha256Hex(
  JSON.stringify(
    {
      id: corpusData.id,
      version: corpusData.version,
      profile: corpusData.profile,
      description: corpusData.description,
      vectors: corpusData.vectors,
    },
    null,
    2
  ) + "\n"
);
const corpusDigestMatchesDeclared = corpusDigest === corpusData.content_digest_sha256;

function restrictedEnv() {
  const keep = ["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "USER", "LOGNAME"];
  const env = {};
  for (const k of keep) if (process.env[k]) env[k] = process.env[k];
  env.HTTP_PROXY = env.HTTPS_PROXY = env.http_proxy = env.https_proxy = env.ALL_PROXY = env.all_proxy = "";
  env.NO_PROXY = "*";
  env.NODE_OPTIONS = "";
  env.RAVEN_API_KEY = env.RAVEN_TOKEN = env.AWS_SECRET_ACCESS_KEY = env.AWS_ACCESS_KEY_ID = env.GITHUB_TOKEN = "";
  return env;
}

function runVector(entryAbs, inputObj) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [entryAbs], {
      cwd: path.dirname(entryAbs),
      env: restrictedEnv(),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
    }, TIMEOUT_MS);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ timedOut: false, observed: null, parseError: "spawn_error", stderr: stderr + String(err), durationMs: Date.now() - started });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      let observed = null;
      let parseError = null;
      const line = stdout.trim().split(/\r?\n/).filter(Boolean).pop() || "";
      try {
        observed = JSON.parse(line);
        if (!observed || typeof observed.decision !== "string") {
          parseError = "missing_decision";
          observed = null;
        }
      } catch {
        parseError = "unparseable_stdout";
      }
      resolve({ ok: !killed && code === 0 && !parseError, timedOut: killed, exitCode: code, stdout, stderr, durationMs: Date.now() - started, observed, parseError });
    });
    child.stdin.write(JSON.stringify(inputObj));
    child.stdin.end();
  });
}

async function runTarget(targetId, runId) {
  const targets = JSON.parse(readFileSync(manifestsPath, "utf8")).targets;
  const target = targets.find((t) => t.id === targetId);
  if (!target) throw new Error(`unknown_target:${targetId}`);
  const targetsDir = path.join(ROOT, "targets");
  const entryAbs = path.resolve(targetsDir, target.entry);
  if (!entryAbs.startsWith(targetsDir + path.sep))
    throw new Error(`target_entry_escapes_targets_dir:${target.entry}`);
  if (!existsSync(entryAbs)) throw new Error(`missing_target_entry:${entryAbs}`);

  const results = [];
  for (const vector of corpusData.vectors) {
    const exec = await runVector(entryAbs, vector.input);
    const expDecision = vector.expected.decision;
    const expVersion = vector.expected.version ?? null;
    const obsDecision = exec.observed?.decision ?? null;
    const obsVersion = exec.observed?.version ?? null;
    let status;
    if (exec.timedOut || exec.parseError) status = "DIVERGENCE";
    else status = obsDecision === expDecision && obsVersion === expVersion ? "PASS" : "DIVERGENCE";
    results.push({
      vector_id: vector.id,
      requirement: vector.requirement,
      expected: { decision: expDecision, version: expVersion },
      observed: exec.observed
        ? { decision: obsDecision, version: obsVersion, reason: exec.observed.reason ?? null }
        : { decision: null, version: null, parseError: exec.parseError, timedOut: exec.timedOut },
      status,
      evidence: { exitCode: exec.exitCode, durationMs: exec.durationMs, stderr: exec.stderr || undefined },
    });
  }
  const pass = results.filter((r) => r.status === "PASS").length;
  const divergence = results.length - pass;
  return {
    schema: "raven-solana-demo-report/1",
    run_id: runId,
    started_at: new Date().toISOString(),
    product: "raven-solana-demo",
    experimental: true,
    target: { id: target.id, entry: target.entry, entry_sha256: fileSha(entryAbs), claimed_conformance_profile: target.claimed_conformance_profile },
    claimed_profile: { name: profile.data.name, version: profile.data.version, sha256: profile.sha256 },
    corpus: {
      id: corpusData.id,
      version: corpusData.version,
      sha256: corpusDigest,
      declared_content_digest_sha256: corpusData.content_digest_sha256,
      digest_matches_declared: corpusDigestMatchesDeclared,
      vector_count: corpusData.vectors.length,
    },
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      os: `${os.type()} ${os.release()}`,
      isolation: "local_node_child_process_restricted_env_timeout_mvp_style_not_a_sandbox",
      network_policy: "no_network_enforcement: proxy env vars unset only; target process retains raw socket, filesystem, and child-process access (measured 2026-09-16: loopback TCP connect and local file reads succeed under this env)",
    },
    summary: { test_count: results.length, pass, divergence, overall: divergence === 0 ? "CONFORMANT" : "DIVERGENT" },
    results,
    divergence_definition:
      "DIVERGENCE = observed decision or version ≠ frozen corpus expectation. Expectations frozen by oracle/oracle.mjs before targets ran; kit 8.3.0 decoder cross-checked all byte vectors. Not a security score.",
    limitations: [
      "EXPERIMENTAL demo profile — not an accepted Raven protocol, not a certification.",
      "Envelope-level byte-structure admission only: no Ed25519 signature verification, no account/blockhash/chain-state checks, no simulation or execution.",
      "Fixtures are locally generated with @solana/kit 8.3.0 using synthetic throwaway keys and a synthetic blockhash, or derived from them by documented surgery. No live-mainnet claim is made from them.",
      "MVP-style isolation: restricted env + timeout, not a container.",
    ],
  };
}

const args = process.argv.slice(2);
const all = args.includes("--all");
const json = args.includes("--json");
const tIdx = args.indexOf("--target");
const targetId = tIdx >= 0 ? args[tIdx + 1] : null;
if (!all && !targetId) {
  console.error("Usage: node harness/run.js --target <ID> [--json] | --all [--json]");
  process.exit(2);
}
const targets = JSON.parse(readFileSync(manifestsPath, "utf8")).targets;
const ids = all ? targets.map((t) => t.id) : [targetId];
const runId = `run_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
const reports = [];
for (const id of ids) reports.push(await runTarget(id, runId));

mkdirSync(path.join(ROOT, "results"), { recursive: true });
const outPath = path.join(ROOT, "results", `${runId}.json`);
writeFileSync(outPath, JSON.stringify({ run_id: runId, reports }, null, 2) + "\n");

if (json) {
  console.log(JSON.stringify({ run_id: runId, reports }, null, 2));
} else {
  for (const r of reports) {
    console.log(`\n=== ${r.target.id} — ${r.summary.overall} (${r.summary.pass} PASS / ${r.summary.divergence} DIVERGENCE of ${r.summary.test_count}) ===`);
    for (const v of r.results) {
      const obs = v.observed.decision ?? `null(${v.observed.parseError || "timeout"})`;
      console.log(`[${v.status}] ${v.vector_id}  expected=${v.expected.decision}/${v.expected.version}  observed=${obs}/${v.observed.version ?? "-"}`);
      if (v.status === "DIVERGENCE") console.log(`    reason=${v.observed.reason ?? "n/a"}  requirement=${v.requirement}`);
    }
  }
  console.log(`\nWrote ${outPath}`);
}
process.exit(reports.every((r) => r.summary.overall === "CONFORMANT") ? 0 : 1);
