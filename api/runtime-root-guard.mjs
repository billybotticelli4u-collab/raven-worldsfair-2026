import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function realOrResolve(p) {
  try {
    return fs.existsSync(p) ? fs.realpathSync(p) : path.resolve(p);
  } catch {
    return path.resolve(p);
  }
}

function isInside(parent, child) {
  const P = realOrResolve(parent);
  const C = realOrResolve(child);
  if (C === P) return true;
  const rel = path.relative(P, C);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * Validate RAVEN_CONFORMANCE_RUNTIME_ROOT before any filesystem mutation.
 * @returns {string} absolute resolved runtime root
 */
export function resolveRuntimeRoot({
  env = process.env,
  sourceRoot,
  repoRoot,
  tmpdir = os.tmpdir(),
} = {}) {
  const raw = env.RAVEN_CONFORMANCE_RUNTIME_ROOT;
  const allowExternal = env.RAVEN_CONFORMANCE_ALLOW_EXTERNAL_ROOT === "1";
  const repo = path.resolve(repoRoot);
  const source = path.resolve(sourceRoot);
  const tmp = realOrResolve(tmpdir);

  let resolved;
  if (raw === undefined || raw === null || raw === "") {
    resolved = path.resolve(tmp, "raven-conformance-runtime");
  } else {
    if (typeof raw !== "string") {
      throw new Error("RAVEN_CONFORMANCE_RUNTIME_ROOT refused: non-string value");
    }
    if (!path.isAbsolute(raw)) {
      throw new Error(`RAVEN_CONFORMANCE_RUNTIME_ROOT refused (relative): ${raw}`);
    }
    resolved = path.resolve(raw);
  }

  if (isInside(repo, resolved)) {
    throw new Error(
      `RAVEN_CONFORMANCE_RUNTIME_ROOT refused (inside repository root ${repo}): ${raw ?? resolved}`,
    );
  }

  if (resolved === source || isInside(resolved, source)) {
    throw new Error(`refusing to relocate onto the source tree: ${resolved}`);
  }

  if (!isInside(tmp, resolved) && !allowExternal) {
    throw new Error(
      `RAVEN_CONFORMANCE_RUNTIME_ROOT refused (outside os.tmpdir() ${tmp}; set RAVEN_CONFORMANCE_ALLOW_EXTERNAL_ROOT=1 to override): ${raw ?? resolved}`,
    );
  }

  return resolved;
}

export function assertRuntimeRootWritable(runtimeRoot) {
  fs.mkdirSync(runtimeRoot, { recursive: true });
  const probe = path.join(runtimeRoot, `.raven-write-probe-${process.pid}`);
  try {
    fs.writeFileSync(probe, "ok");
    fs.unlinkSync(probe);
  } catch (err) {
    throw new Error(
      `RAVEN_CONFORMANCE_RUNTIME_ROOT not writable before relocate (${runtimeRoot}): ${err.message}`,
    );
  }
}
