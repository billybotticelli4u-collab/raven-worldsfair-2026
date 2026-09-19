import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveRuntimeRoot } from "../api/runtime-root-guard.mjs";

const REPO = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const SOURCE = path.join(REPO, "apps", "raven-conformance");

function oldWouldAccept(runtimeRootAbs) {
  const RUNTIME_ROOT = path.resolve(runtimeRootAbs);
  const SOURCE_ROOT = SOURCE;
  if (RUNTIME_ROOT === SOURCE_ROOT || SOURCE_ROOT.startsWith(RUNTIME_ROOT + path.sep)) {
    return { accept: false, reason: "old-refuse-source-under-or-equal-runtime" };
  }
  return { accept: true, reason: "old-would-proceed-to-rmSync" };
}

function neu(raw) {
  try {
    return { accept: true, resolved: resolveRuntimeRoot({ env: { RAVEN_CONFORMANCE_RUNTIME_ROOT: raw }, sourceRoot: SOURCE, repoRoot: REPO, tmpdir: os.tmpdir() }) };
  } catch (e) {
    return { accept: false, reason: String(e.message || e) };
  }
}

const outside = fs.mkdtempSync(path.join(os.homedir(), "raven-a1-red-"));
const cases = [
  { name: "relative", raw: "relative-runtime", expectGap: true },
  { name: "equal-repo-root", raw: REPO, expectGap: false, note: "old also refused because SOURCE sits under REPO; new refuses via explicit repo-root policy" },
  { name: "inside-repo-descendant", raw: path.join(SOURCE, "corpus"), expectGap: true },
  { name: "outside-tmpdir", raw: outside, expectGap: true },
];
const rows = [];
for (const c of cases) {
  const abs = path.isAbsolute(c.raw) ? path.resolve(c.raw) : path.resolve(c.raw);
  const old = oldWouldAccept(abs);
  const n = neu(c.raw);
  const gap = old.accept === true && n.accept === false;
  rows.push({ case: c.name, value: c.raw, old_on_0e36d800: old, new_a1_guard: n, red_then_green_gap: gap, note: c.note || null });
}
fs.rmSync(outside, { recursive: true, force: true });
const gaps = rows.filter((r) => r.case !== "equal-repo-root");
const ok = gaps.every((r) => r.red_then_green_gap) && rows.every((r) => r.new_a1_guard.accept === false);
console.log(JSON.stringify({ base_head: "0e36d800", gaps_required: 3, gaps_ok: ok, rows }, null, 2));
process.exit(ok ? 0 : 1);
