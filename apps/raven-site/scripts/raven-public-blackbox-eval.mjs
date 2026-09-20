#!/usr/bin/env node
// Raven public blackbox eval runner. Public surface needs no key; keyed evals
// run ONLY when RAVEN_HOSTED_API_KEY is exported. The key is never printed.
const SITE = process.env.RAVEN_SITE_URL || "https://raven-launch-console.vercel.app";
const API = process.env.RAVEN_VERIFIER_URL || "https://raven-hosted-verifier.onrender.com";
const KEY = process.env.RAVEN_HOSTED_API_KEY || null;
let pass = 0, fail = 0, skip = 0;
const P = (n) => { pass++; console.log("PASS -", n); };
const F = (n, m) => { fail++; console.error("FAIL -", n, "->", m); };
const S = (n) => { skip++; console.log("skip -", n, "(no RAVEN_HOSTED_API_KEY)"); };
const get = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error("HTTP " + r.status); return r; };
const post = (body) => fetch(API + "/verify", { method: "POST", headers: { "x-api-key": KEY, "content-type": "application/json" }, body: JSON.stringify(body) });
const SECRET_PATTERNS = [/rvk_alpha_[a-z0-9]+/i, /rvk_beta_[a-z0-9]{8,}/i, /BEGIN [A-Z ]*PRIVATE KEY/];

// --- public surface ---
try {
  const pages = ["/", "/agents.html", "/agents.json", "/openapi.json", "/evals.json", "/key-policy.json", "/llms.txt", "/llms-full.txt", "/workbench.html", "/evals.html", "/pricing.html", "/receipts.html", "/agent-pack.html", "/raven-agent-context.md", "/raven-agent-skill.md", "/prompt-recipes.json", "/demo-kit.html", "/receipt-storage.html", "/receipt-schema.json", "/receipt-storage-adapters.json", "/receipt-memory-policy.md", "/delegate-key-policy.html", "/feedback-for-agents.html", "/skills.html", "/raven.skill.md", "/AGENTS.md", "/key-policy.html", "/key-policy.json", "/payment-policy.html", "/payment-policy.json", "/evidence-sources.html", "/evidence-sources.json", "/receipt-storage.json", "/quality-ledger.html", "/quality-ledger.json", "/examples.html", "/examples.json", "/abuse.html", "/integrator-feedback.html", "/decision-policy.html", "/decision-policy.json", "/status-policy.html", "/status-policy.json", "/agent-runtime-policy.html", "/agent-runtime-policy.json", "/launchguard-readiness.html", "/launchguard-readiness.json", "/language-policy.html", "/language-policy.json", "/rubrics.html", "/rubrics.json", "/agent-portability.html", "/agent-portability.json", "/launchguard-rollout.html", "/launchguard-rollout.json", "/deployment-surfaces.html", "/deployment-surfaces.json", "/anti-slop-policy.html", "/anti-slop-policy.json", "/failure-drills.html", "/failure-drills.json", "/agent-threat-model.html", "/agent-threat-model.json", "/supply-chain-policy.html", "/supply-chain-policy.json", "/mcp-security-boundary-policy.html", "/mcp-security-boundary-policy.json", "/agentic-research-boundary-policy.html", "/agentic-research-boundary-policy.json", "/transaction-boundary-policy.html", "/transaction-boundary-policy.json", "/security.html", "/request-access.html"];
  for (const p of pages) {
    const t = await (await get(SITE + p)).text();
    for (const re of SECRET_PATTERNS) if (re.test(t)) throw new Error(p + " leaks pattern " + re);
  }
  P("site pages reachable, no secret patterns in any public file");
} catch (e) { F("site pages", e.message); }
try {
  const j = await (await get(SITE + "/agents.json")).json();
  if (j.attestation.keyId !== "rvk_c2997e90215279c2") throw new Error("keyId mismatch");
  P("agents.json keyId");
} catch (e) { F("agents.json keyId", e.message); }
try {
  const j = await (await get(API + "/pubkey")).json();
  if (j.keys[0].keyId !== "rvk_c2997e90215279c2" || j.keys[0].alg !== "ed25519") throw new Error("pubkey mismatch");
  P("eval pubkey_published");
} catch (e) { F("eval pubkey_published", e.message); }
try {
  const evals = await (await get(SITE + "/evals.json")).json();
  if (evals.evals.length < 8) throw new Error("expected >= 8 evals");
  P("evals.json well-formed (" + evals.evals.length + " evals)");
} catch (e) { F("evals.json", e.message); }
try {
  const t = await (await get(SITE + "/llms.txt")).text();
  if (!t.includes("fail closed") || !t.includes("not financial advice")) throw new Error("trust copy missing");
  P("llms.txt trust policy present");
} catch (e) { F("llms.txt", e.message); }

try {
  const j = await (await get(SITE + "/key-policy.json")).json();
  if (j.currentKeyId !== "rvk_c2997e90215279c2" || j.currentSignatureAlgorithm !== "ed25519" || !j.publicKeyEndpoint.endsWith("/pubkey")) throw new Error("policy fields wrong");
  P("eval key_policy_available");
} catch (e) { F("eval key_policy_available", e.message); }

// --- keyed evals (optional) ---
if (!KEY) { S("usdc_authorities_are_risk"); S("token2022_extensions_surface"); S("invalid_request_structured_error"); S("forbidden_fields_rejected"); S("receipt_fields_complete"); }
else {
  try {
    const j = await (await post({ mintAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", tokenProgramAddress: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" })).json();
    if (j.verdict !== "risk") throw new Error("verdict " + j.verdict);
    for (const c of ["issuer_control.mint_authority_active", "issuer_control.freeze_authority_active"]) if (!j.findingCodes.includes(c)) throw new Error("missing " + c);
    if (!j.replayHash || !j.officialAttestationHash || !j.keyId || !j.signature || !j.rpc?.observedSlot) throw new Error("receipt fields incomplete");
    P("eval usdc_authorities_are_risk + receipt_fields_complete");
  } catch (e) { F("eval usdc/receipt", e.message); }
  try {
    const r = await post({ mintAddress: "not-a-mint" });
    if (r.status !== 400) throw new Error("status " + r.status);
    P("eval invalid_request_structured_error");
  } catch (e) { F("eval invalid_request", e.message); }
  try {
    const r = await post({ mintAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", tokenProgramAddress: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", rpcUrl: "https://x.example" });
    if (r.status !== 400) throw new Error("rpcUrl accepted: " + r.status);
    P("eval forbidden_fields_rejected");
  } catch (e) { F("eval forbidden_fields", e.message); }
}
console.log(`\nRESULT: ${pass} pass, ${fail} fail, ${skip} skipped`);
process.exit(fail === 0 ? 0 : 1);
