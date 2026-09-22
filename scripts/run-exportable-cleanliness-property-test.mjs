#!/usr/bin/env node
/**
 * Property test: random strings embedding a home-path segment under random
 * obfuscations; when a real home segment remains after lexical normalisation,
 * checker MUST NEVER exit 0. Report any counterexample verbatim.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { lexicalResolve, hasHomeIdentity } from "./check-exportable-cleanliness.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const checker = path.join(here, "check-exportable-cleanliness.mjs");
const allowlist = path.join(
  here,
  "fixtures/exportable-cleanliness/allowlists/judge-package-v5.2.txt",
);

const N = Number(process.env.EC_PROP_N || 1200);
const seed = Number(process.env.EC_PROP_SEED || 20260921);

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(seed);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

const usernames = ["ROBY", "raven", "billy", "glen", "alice"];
const homes = [
  (u) => `/Users/${u}/secret.txt`,
  (u) => `/home/${u}/.ssh/id_rsa`,
  (u) => `C:/Users/${u}/Desktop/x`,
  (u) => `C:\\Users\\${u}\\x`,
  (u) => `/Users/${u}`,
  (u) => `~/Documents/${u}.txt`,
];

const obfuscators = [
  (p) => p,
  (p) => (p.startsWith("/") ? `/private/tmp/../..${p}` : p),
  (p) => (p.startsWith("/") ? `/private/tmp/..${p}` : p),
  (p) => (p.startsWith("/") ? `/tmp/..${p}` : p),
  (p) => (p.startsWith("/") ? `/private/tmp/a/b/../../..${p}` : p),
  (p) => p.replace(/\.\./g, "%2e%2e"),
  (p) =>
    `/private/tmp/%2e%2e/%2e%2e${p.startsWith("/") ? p : "/" + p}`,
  (p) =>
    p
      .split("")
      .map((ch) => (ch === "/" && rand() < 0.25 ? "\\" : ch))
      .join(""),
  (p) =>
    `/var/folders/xx/T/%2e%2e/%2e%2e/%2e%2e${p.startsWith("/") ? p : "/" + p}`,
  (p) => {
    if (/^\/Users\//i.test(p) || /^\/home\//i.test(p)) {
      return p.replace(/\/[^/]+$/, "") + "/../../private/tmp/x";
    }
    return p;
  },
  (p) => p.replace(/Users/g, "uSeRs"),
  (p) => p.replace(/home/gi, (m) => (m === "home" ? "HoMe" : m)),
  (p) => `/private/tmp/.${"/../.."}${p.startsWith("/") ? p : "/" + p}`,
];

const counterexamples = [];
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ec-prop-"));
let asserted = 0;

for (let i = 0; i < N; i++) {
  const u = pick(usernames);
  const base = pick(homes)(u);
  const ob = pick(obfuscators)(base);
  const resolved = lexicalResolve(ob);
  if (!hasHomeIdentity(ob) && !hasHomeIdentity(resolved)) {
    continue;
  }
  asserted++;
  const file = path.join(tmpDir, `case-${i}.json`);
  fs.writeFileSync(file, JSON.stringify({ p: ob }));
  const r = spawnSync(
    process.execPath,
    [checker, "--allowlist", allowlist, file],
    { encoding: "utf8" },
  );
  const status = r.status ?? 2;
  if (status === 0) {
    counterexamples.push({
      i,
      input: ob,
      resolved,
      base,
      stdout: r.stdout,
      stderr: r.stderr,
    });
  }
}

console.log(`exportable-cleanliness property-test`);
console.log(`seed=${seed} requested=${N} asserted_with_home_segment=${asserted}`);
console.log(`counterexamples=${counterexamples.length}`);
if (counterexamples.length) {
  for (const c of counterexamples.slice(0, 25)) {
    console.log("--- COUNTEREXAMPLE ---");
    console.log(JSON.stringify(c, null, 2));
  }
  process.exit(1);
}
console.log(`0 counterexamples in ${N} runs (${asserted} asserted)`);
process.exit(0);
