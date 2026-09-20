#!/usr/bin/env node
// Weekly problem hunt. Reads operator/private/* when present, degrades to
// committed templates. No secrets required, none printed.
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyFeedback } from "./raven-feedback-classifier.mjs";

const site = join(dirname(fileURLToPath(import.meta.url)), "..");
const priv = (f) => join(site, "operator", "private", f);
const tmpl = (f) => join(site, "operator", f);
const load = (p, fb) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return fb; } };

const leadsSrc = existsSync(priv("leads.json")) ? priv("leads.json") : tmpl("leads-template.json");
const usingTemplates = !existsSync(priv("leads.json"));
const leads = load(leadsSrc, { leads: [] }).leads.filter((l) => l.name || l.tokenRequested || l.useCase);
const dots = load(existsSync(priv("dotplot.json")) ? priv("dotplot.json") : tmpl("dotplot-template.json"), { rows: [] });

const tally = (arr) => { const m = {}; for (const a of arr) if (a) m[a] = (m[a] || 0) + 1;
  return Object.entries(m).sort((x, y) => y[1] - x[1]); };
const L = (rows) => rows.length ? rows.map(([k, v]) => `- ${k}: ${v}`).join("\n") : "- (none)";

const missing = tally(leads.flatMap((l) => l.missingEvidence || []));
const roles = tally(leads.map((l) => l.role));
const cases = tally(leads.map((l) => (l.useCase || "").slice(0, 60)));
const stalled = leads.filter((l) => l.followUpDate && l.followUpDate < new Date().toISOString().slice(0, 10) && !l.repeatUsage);
const noVerdict = leads.filter((l) => l.tokenRequested && !l.verdictSent);
const repeatBeta = dots.rows.filter((r) => Object.keys(r.days || {}).length > 1);
const oneShot = dots.rows.filter((r) => Object.keys(r.days || {}).length <= 1);
const oos = leads.map((l) => ({ l, c: classifyFeedback(l) })).filter((x) => x.c.outOfScope);

const deployerDemand = missing.find(([k]) => /deployer/i.test(k));
const holderRepeat = repeatBeta.some((r) => r.holderBeta);
let rec = "Reply to every token request same-day with a signed receipt; interview one-shot users before building anything.";
if (noVerdict.length) rec = `${noVerdict.length} token request(s) have NO verdict sent — fix today before anything else.`;
else if (deployerDemand && deployerDemand[1] >= 3) rec = `Deployer history demanded by ${deployerDemand[1]} leads — P3-4 is now feedback-sanctioned; propose to Glen.`;
else if (missing[0]) rec = `Top measured gap: "${missing[0][0]}" (${missing[0][1]}x) — schedule against existing coverage roadmap.`;

console.log(`# Raven Problem Hunt — ${new Date().toISOString().slice(0, 10)}
${usingTemplates ? "_(template data only — populate operator/private/ for real signal)_" : ""}

## Repeated missing-evidence requests\n${L(missing)}
## Repeated lead roles\n${L(roles)}
## Repeated use cases\n${L(cases)}
## Stalled leads\n${stalled.length ? stalled.map((l) => `- ${l.leadId} (follow-up was ${l.followUpDate})`).join("\n") : "- (none)"}
## Tokens requested, no verdict sent\n${noVerdict.length ? noVerdict.map((l) => `- ${l.leadId}: ${l.tokenRequested}`).join("\n") : "- (none)"}
## Eval / smoke failures\n- run: node scripts/raven-public-blackbox-eval.mjs and paste RESULT here
## Beta users WITH repeat usage\n${repeatBeta.length ? repeatBeta.map((r) => `- ${r.caller}`).join("\n") : "- (none)"}
## Beta users WITHOUT repeat usage\n${oneShot.length ? oneShot.map((r) => `- ${r.caller}`).join("\n") : "- (none)"}
## Out-of-scope requests\n${oos.length ? oos.map((x) => `- ${x.l.leadId}: ${x.c.reason}`).join("\n") : "- (none)"}
## Holder-beta -> repeat usage?\n- ${holderRepeat ? "yes: at least one beta caller is repeating" : "no evidence yet — do NOT propose global enablement"}
## Recommended next action\n- ${rec}
${deployerDemand && deployerDemand[1] >= 3 ? "" : "- (P3-4 stays parked: feedback has not demanded deployer history 3+ times)"}
`);
