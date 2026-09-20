import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Realpath deepest existing ancestor, then append remaining segments (G-2). */
export function realpathExistingAncestor(p) {
  const abs = path.resolve(p);
  let cur = abs;
  const missing = [];
  while (true) {
    try {
      if (fs.existsSync(cur)) {
        const real = fs.realpathSync(cur);
        return missing.length ? path.join(real, ...missing.reverse()) : real;
      }
    } catch {
      /* walk up */
    }
    const parent = path.dirname(cur);
    if (parent === cur) return abs;
    missing.push(path.basename(cur));
    cur = parent;
  }
}

/** Strict descendant: child under parent, not equal (G-1). */
export function isStrictInside(parent, child) {
  const P = path.resolve(parent);
  const C = path.resolve(child);
  if (C === P) return false;
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
  let tmp;
  try {
    tmp = fs.realpathSync(path.resolve(tmpdir));
  } catch {
    tmp = path.resolve(tmpdir);
  }

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
    resolved = realpathExistingAncestor(raw);
  }

  // G-1 first: must be strict descendant of tmpdir (unless override)
  if (!allowExternal) {
    if (resolved === tmp || !isStrictInside(tmp, resolved)) {
      throw new Error(
        `RAVEN_CONFORMANCE_RUNTIME_ROOT refused (outside os.tmpdir() / not a strict descendant of ${tmp}; set RAVEN_CONFORMANCE_ALLOW_EXTERNAL_ROOT=1 to override): ${raw ?? resolved}`,
      );
    }
  }

  // refuse inside repo (including equality)
  {
    const relToRepo = path.relative(repo, resolved);
    const insideOrEqual =
      resolved === repo || (relToRepo !== "" && !relToRepo.startsWith("..") && !path.isAbsolute(relToRepo));
    if (insideOrEqual) {
      throw new Error(
        `RAVEN_CONFORMANCE_RUNTIME_ROOT refused (inside repository root ${repo}): ${raw ?? resolved}`,
      );
    }
  }

  // refuse if runtime root would contain or equal the source tree
  {
    const rel = path.relative(resolved, source);
    const containsOrEqual =
      resolved === source || (rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel));
    if (containsOrEqual) {
      throw new Error(`refusing to relocate onto the source tree: ${resolved}`);
    }
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
