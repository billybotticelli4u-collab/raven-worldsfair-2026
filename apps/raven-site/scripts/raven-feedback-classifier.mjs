#!/usr/bin/env node
// Deterministic feedback classifier. Rules only — no LLM, no scoring vibes.
// Usage: node raven-feedback-classifier.mjs --role "trader" --usecase "..."
//        --evidence "liquidity,holders" --decision "..." --token "..." --notes "..."
// Or import { classifyFeedback } from this module.

const RULES = [
  { bucket: "unsupported/out of scope", outOfScope: true,
    re: /price predict|pump signal|call(s)? before|moon|sentiment|social|copy.?trad|profitable wallet|portfolio|macro|trading advice|buy signal|sell signal|guarantee/i },
  { bucket: "deployer history", engine: true, re: /deployer|dev wallet history|past launches|serial rug|creator history/i, evidence: "deployer history" },
  { bucket: "holders", engine: true, re: /holder|whale|concentration|top.?10|distribution/i, evidence: "holders" },
  { bucket: "liquidity", engine: true, re: /liquidity|lp\b|pool lock|burned lp|withdraw/i, evidence: "liquidity" },
  { bucket: "Token-2022", engine: true, re: /token.?2022|extension|transfer hook|transfer fee|permanent delegate/i, evidence: "Token-2022" },
  { bucket: "receipts/verifiability", engine: false, re: /receipt|signature|attestation|replay|verify.*(verdict|signature)|audit trail|proof/i },
  { bucket: "MCP integration", engine: false, re: /\bmcp\b|claude|model context|tool call|agent framework|langchain|eliza/i },
  { bucket: "ACP/payment", engine: false, re: /\bacp\b|usdc|payment|escrow|pay per|x402|micropayment|settle/i },
  { bucket: "pricing/access", engine: false, re: /price\b|pricing|cost|rate limit|quota|tier|api key|access/i },
  { bucket: "docs/onboarding", engine: false, re: /docs|documentation|example|tutorial|confus|how do i|unclear|onboard/i },
];
const EVIDENCE_BUCKETS = { "liquidity": "liquidity", "holders": "holders", "deployer history": "deployer history", "token-2022": "Token-2022" };

export function classifyFeedback(input) {
  const text = [input.role, input.useCase, input.decisionSupported, input.tokenRequested, input.notes]
    .filter(Boolean).join(" \n ");
  const evidence = (input.missingEvidence || []).map((e) => String(e).toLowerCase().trim());

  // Explicit missing-evidence selection wins (it is the measured signal).
  for (const ev of evidence) {
    if (EVIDENCE_BUCKETS[ev]) {
      return result(EVIDENCE_BUCKETS[ev], true, false, false,
        "explicit missing-evidence selection: " + ev);
    }
  }
  for (const r of RULES) {
    if (r.re.test(text)) {
      if (r.outOfScope) return result(r.bucket, false, false, true,
        "matched forbidden-scope pattern (RAVEN_FOCUS.md)");
      return result(r.bucket, r.engine === true, r.engine === false, false,
        "matched rule: " + r.bucket);
    }
  }
  return result("docs/onboarding", false, true, false,
    "no rule matched; default to docs/onboarding for human review");
}
function result(bucket, engine, docs, oos, reason) {
  return { bucket, sanctionedEngineWork: engine, docsSiteIssue: docs, outOfScope: oos, reason };
}

// CLI
import { fileURLToPath } from "node:url";
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (k) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : ""; };
  const out = classifyFeedback({
    role: arg("role"), useCase: arg("usecase"), decisionSupported: arg("decision"),
    tokenRequested: arg("token"), notes: arg("notes"),
    missingEvidence: arg("evidence").split(",").map((s) => s.trim()).filter(Boolean),
  });
  console.log(JSON.stringify(out, null, 2));
}
