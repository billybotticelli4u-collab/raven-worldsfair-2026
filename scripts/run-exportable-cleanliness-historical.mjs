#!/usr/bin/env node
/** Historical leak fixtures must FAIL (exit 1). */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, "fixtures/exportable-cleanliness/historical");
const checker = path.join(here, "check-exportable-cleanliness.mjs");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
let fail = 0;
console.log("| file | exit | status |");
console.log("|---|---|---|");
for (const f of files) {
  const r = spawnSync(process.execPath, [checker, path.join(dir, f)], {
    encoding: "utf8",
  });
  const st = r.status ?? 2;
  const ok = st === 1;
  if (!ok) fail++;
  console.log(`| ${f} | ${st} | ${ok ? "PASS (failed gate as required)" : "FAIL (should have exited 1)"} |`);
}
process.exit(fail > 0 ? 1 : 0);
