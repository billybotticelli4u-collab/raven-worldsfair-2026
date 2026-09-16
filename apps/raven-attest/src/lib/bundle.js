/**
 * Bundle loaders for raven-attest.
 *
 * These re-implement the digest algorithms used by apps/raven-conformance so the
 * verifier can recompute them WITHOUT importing the engine under test. Importing
 * the engine would make every "digest matches" check circular: the same code that
 * produced the number would be asked to confirm it.
 *
 * Algorithms replicated (source: apps/raven-conformance/src/lib/runner.js @ 53360df):
 *   - profile digest : sha256 over raw profile file bytes
 *   - target digest  : sha256 over raw target entry file bytes
 *   - corpus digest  : sha256 over JSON.stringify({id,version,profile,description,vectors}, null, 2) + "\n"
 *                      (NOT the raw file bytes — the declared content_digest_sha256 field is excluded)
 *   - report digest  : sha256 over JSON.stringify(report minus report_content_digest_sha256, null, 2) + "\n"
 */
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

export const PROFILE_FILE = "raven-canonical-envelope-1.json";
export const CORPUS_FILE = "raven-canonical-envelope-demo-corpus-1.json";
export const ENGINE_APP = "apps/raven-conformance";

export function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function fileSha256(p) {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

/** Resolve the engine app directory from a bundle root (repo root OR the app dir itself). */
export function resolveApp(bundleRoot) {
  const abs = path.resolve(bundleRoot);
  const asRepo = path.join(abs, ENGINE_APP);
  if (existsSync(path.join(asRepo, "targets", "manifests.json"))) return asRepo;
  if (existsSync(path.join(abs, "targets", "manifests.json"))) return abs;
  throw new Error(`no_conformance_app_under:${abs}`);
}

export function bundlePaths(appDir) {
  return {
    app: appDir,
    profile: path.join(appDir, "profiles", PROFILE_FILE),
    corpus: path.join(appDir, "corpus", CORPUS_FILE),
    targetsDir: path.join(appDir, "targets"),
    manifests: path.join(appDir, "targets", "manifests.json"),
  };
}

export function loadProfile(appDir) {
  const p = bundlePaths(appDir).profile;
  return { path: p, digest: fileSha256(p), data: JSON.parse(readFileSync(p, "utf8")) };
}

export function loadCorpus(appDir) {
  const p = bundlePaths(appDir).corpus;
  const data = JSON.parse(readFileSync(p, "utf8"));
  const forDigest = {
    id: data.id,
    version: data.version,
    profile: data.profile,
    description: data.description,
    vectors: data.vectors,
  };
  return {
    path: p,
    computedDigest: sha256Hex(JSON.stringify(forDigest, null, 2) + "\n"),
    declaredDigest: data.content_digest_sha256 || null,
    fileDigest: fileSha256(p),
    data,
  };
}

export function loadManifests(appDir) {
  const p = bundlePaths(appDir).manifests;
  return { path: p, digest: fileSha256(p), data: JSON.parse(readFileSync(p, "utf8")) };
}

/**
 * Recompute a report's self-declared content digest.
 * Relies on JSON.parse preserving insertion order for non-numeric keys, which is
 * required by ECMA-262 OrdinaryOwnPropertyKeys for string keys.
 */
export function recomputeReportDigest(report) {
  const clone = { ...report };
  delete clone.report_content_digest_sha256;
  delete clone._written_path;
  return sha256Hex(JSON.stringify(clone, null, 2) + "\n");
}
