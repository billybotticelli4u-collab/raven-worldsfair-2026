#!/usr/bin/env node
// Auto-review gate for site + operator files. PASS/FAIL with file:line.
// Never prints matched secret values. Optional arg: directory to scan
// (default: the raven-site tree) — used by tests with a planted fixture.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_EXT = /\.(html|json|js|css|svg|txt|md|csv)$/;
const SKIP = /node_modules|operator\/private|\.git/;

const SECRETS = [
  { name: "alpha/beta API key", re: /rvk_(alpha|beta)_[a-z0-9]{6,}/i },
  { name: "private key block", re: /BEGIN [A-Z ]*PRIVATE KEY/ },
  { name: "bearer token", re: /bearer\s+[a-z0-9_\-\.]{24,}/i },
  { name: "key=value secret", re: /(RAVEN_API_KEYS|RAVEN_V2_SIGNING_KEY|RAVEN_HOLDERS_BETA_KEYS)\s*[=:]\s*["']?[A-Za-z0-9+/]{8,}/ },
];
const LANGUAGE = [
  { name: "affirmative price prediction", re: /we predict|price prediction service|predicts the price|price will/i },
  { name: "trading advice", re: /you should (buy|sell)|buy now|sell now|strong (buy|sell)|take profit/i },
  { name: "macro commentary", re: /dollar collapse|hyperinflation|fed will|recession is coming|milkshake theory/i },
  { name: "unsafe 'safe' claim", re: /is safe to (buy|trade|ape)|completely safe|100% safe|fully vetted|all clear/i },
];
const COPYTRADE = { name: "wallet copy-trading reference", re: /copy.?trad|profitable wallet/i };
const COPYTRADE_ALLOWLIST = /RAVEN_FOCUS|RECEIPT-SPRINT|DECISION_POLICY|OPERATOR_CONTEXT|PROBLEM_HUNTING|access-declined|feedback-classifier|change-review|README|REVENUE_MODEL|agent-runtime-policy|agent-portability/;
const GUARDRAIL = /coverage-gap-review|OPERATOR_CONTEXT|change-review|DECISION_POLICY|language-policy|rubrics|launchguard-readiness/;

const failures = [];
function scan(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (SKIP.test(p)) continue;
    if (statSync(p).isDirectory()) { scan(p); continue; }
    if (!PUBLIC_EXT.test(f)) continue;
    const rel = relative(root, p);
    const lines = readFileSync(p, "utf8").split("\n");
    lines.forEach((line, i) => {
      for (const s of SECRETS) if (s.re.test(line) && !/xxxx|YOUR_KEY|<key>|KEY_PREFIX|\$RAVEN|\$KEY|placeholder/i.test(line))
        failures.push(`${rel}:${i + 1} — ${s.name} (value not printed)`);
      for (const l of LANGUAGE) if (l.re.test(line) && !GUARDRAIL.test(rel)) failures.push(`${rel}:${i + 1} — ${l.name}`);
      if (COPYTRADE.re.test(line) && !COPYTRADE_ALLOWLIST.test(rel)) failures.push(`${rel}:${i + 1} — ${COPYTRADE.name} outside guardrail files`);
    });
  }
}
scan(root);

// Structural checks (only when scanning the real site root)
if (!process.argv[2]) {
  for (const j of ["agents.json", "access.json", "openapi.json", "evals.json"]) {
    try { JSON.parse(readFileSync(join(root, j), "utf8")); } catch (e) { failures.push(`${j} — broken JSON: ${e.message}`); }
  }
  for (const page of ["receipts.html", "security.html", "evals.html"]) {
    const s = readFileSync(join(root, page), "utf8");
    if (!s.includes("rvk_c2997e90215279c2")) failures.push(`${page} — missing keyId`);
  }
  for (const page of ["index.html", "receipts.html", "pricing.html"]) {
    const s = readFileSync(join(root, page), "utf8");
    if (!/not financial advice|does not predict price/i.test(s)) failures.push(`${page} — missing no-financial-advice language`);
  }
  const idx = readFileSync(join(root, "index.html"), "utf8");
  if (/<input[^>]*(mint|verify)[^>]*>/i.test(idx)) failures.push("index.html — possible live public verifier box");
}

if (failures.length) { console.error("FAIL\n" + failures.map((f) => "  " + f).join("\n")); process.exit(1); }
console.log("PASS — no secrets, no banned language, structure intact"); 
