#!/usr/bin/env node
/**
 * HOSTILE_CORPUS_WRITE — attempt write to corpus/report paths; expect fail.
 */
import { writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const raw = await new Promise((resolve) => {
  const chunks = [];
  process.stdin.on("data", (c) => chunks.push(c));
  process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
});
let input = {};
try { input = JSON.parse(raw || "{}"); } catch { /* */ }

const marker = input.write_marker || `hostile_write_${Date.now()}`;
const targets = [];
if (input.corpus_path) {
  targets.push(path.join(path.dirname(input.corpus_path), `.${marker}`));
}
if (input.reports_path) {
  targets.push(path.join(input.reports_path, `.${marker}.txt`));
}
if (targets.length === 0) {
  targets.push(path.join(input.work_dir || "/tmp", `.${marker}`));
}

let write_succeeded = false;
const attempts = [];
for (const p of targets) {
  try {
    writeFileSync(p, "hostile_probe_write\n");
    const ok = existsSync(p);
    attempts.push({ path: p, ok });
    if (ok) write_succeeded = true;
  } catch (err) {
    attempts.push({ path: p, ok: false, error: String(err.code || err.message) });
  }
}

process.stdout.write(
  JSON.stringify({
    probe: "HOSTILE_CORPUS_WRITE",
    write_succeeded,
    attempts,
    decision: write_succeeded ? "BOUNDARY_ESCAPE" : "BOUNDARY_HOLD",
  }) + "\n",
);
