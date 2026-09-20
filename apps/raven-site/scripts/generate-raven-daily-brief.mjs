#!/usr/bin/env node
// Raven daily brief — internal chief of staff. Reads private data if present
// (degrades to templates), checks live health read-only. Never needs secrets,
// never prints keys. --write saves to operator/private/daily-brief-<date>.md.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const site = join(dirname(fileURLToPath(import.meta.url)), "..");
const priv = (f) => join(site, "operator", "private", f);
const load = (p, fb) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return fb; } };
const today = new Date().toISOString().slice(0, 10);
const yday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);

const leads = load(existsSync(priv("leads.json")) ? priv("leads.json") : join(site, "operator", "leads-template.json"), { leads: [] })
  .leads.filter((l) => l.name || l.tokenRequested || l.useCase);
const dots = load(existsSync(priv("dotplot.json")) ? priv("dotplot.json") : join(site, "operator", "dotplot-template.json"), { rows: [] });
const decisions = load(priv("decisions.json"), { entries: [] });

let verifier = "UNREACHABLE", pubkeyOk = false;
try {
  const h = await (await fetch("https://raven-hosted-verifier.onrender.com/healthz")).json();
  verifier = h.status === "ok" && h.signer ? "ok (signer present)" : JSON.stringify(h);
  const p = await (await fetch("https://raven-hosted-verifier.onrender.com/pubkey")).json();
  pubkeyOk = p.keys?.[0]?.keyId === "rvk_c2997e90215279c2";
} catch { /* offline is a valid state for the brief */ }

const newLeads = leads.filter((l) => l.dateReceived === today || l.dateReceived === yday);
const awaiting = leads.filter((l) => l.tokenRequested && !l.verdictSent);
const sentYday = leads.filter((l) => l.verdictSent && l.notes?.includes(yday));
const due = leads.filter((l) => l.followUpDate && l.followUpDate <= today);
const betaActive = leads.filter((l) => l.holderBetaEnabled);
const repeat = dots.rows.filter((r) => Object.keys(r.days || {}).length > 1);
const stalledRows = dots.rows.filter((r) => Object.keys(r.days || {}).length <= 1);
const missing = {}; for (const l of leads) for (const e of l.missingEvidence || []) missing[e] = (missing[e] || 0) + 1;
const pendingApproval = decisions.entries.filter((e) => e.humanApproval !== "APPROVED" && e.humanApproval !== "REJECTED");

let rec = "No leads yet: the loop starts at distribution — site is ready, verifier healthy; the bottleneck is callers.";
if (awaiting.length) rec = `${awaiting.length} token request(s) awaiting verdict — run them and reply TODAY (skills/token-verdict-reply.md).`;
else if (due.length) rec = `${due.length} follow-up(s) due — draft from templates/follow-up-3-days.md, queue for Glen.`;
else if (verifier !== "ok (signer present)") rec = "Verifier unhealthy — investigate before anything else (read-only first).";

const md = `# Raven Daily Brief — ${today}

| Section | Status |
|---|---|
| New leads (48h) | ${newLeads.length} |
| Tokens awaiting verdict | ${awaiting.length}${awaiting.length ? " ⚠️" : ""} |
| Verdicts sent yesterday | ${sentYday.length} |
| Receipts on file | ${leads.filter((l) => l.receiptHash).length} |
| Follow-ups due | ${due.length} |
| Beta keys active | ${betaActive.length} |
| Repeat users | ${repeat.length} (${repeat.map((r) => r.caller).join("; ") || "—"}) |
| Stalled users | ${stalledRows.length} |
| Hosted verifier | ${verifier} · pubkey ${pubkeyOk ? "ok" : "CHECK"} |
| Decisions awaiting Glen | ${pendingApproval.length} |

## Top missing-evidence requests
${Object.entries(missing).sort((a, b) => b[1] - a[1]).map(([k, v]) => `- ${k}: ${v}`).join("\n") || "- (none yet)"}

## Eval / smoke
- run: node scripts/raven-public-blackbox-eval.mjs (paste RESULT)
- run: node scripts/site-smoke.mjs (paste last line)

## Pulse / Quality Ledger
- (operator note: check during Render window if needed; not automated here)

## Recommended next action
- ${rec}

## Decisions requiring human approval
${pendingApproval.map((e) => `- ${e.date}: ${e.action} (owner: ${e.owner || "UNASSIGNED"})`).join("\n") || "- (none pending)"}
`;
if (process.argv.includes("--write")) {
  mkdirSync(priv(""), { recursive: true });
  writeFileSync(priv(`daily-brief-${today}.md`), md);
  console.log("wrote operator/private/daily-brief-" + today + ".md");
} else console.log(md);
