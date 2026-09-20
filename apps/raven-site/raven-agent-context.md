# Raven — agent context pack (terse, for machine ingestion)

PURPOSE: signed evidence-and-receipt layer for AI agents before they touch a
Solana token. BEACHHEAD: signed Solana token-launch verification. Nothing else.

CURRENT SIGNED INPUT (POST https://raven-hosted-verifier.onrender.com/receipt/v1, x-api-key):
required: mintAddress, tokenProgramAddress
optional: metadataAddress, poolAddress (Raydium CPMM), commitment (finalized|confirmed)
forbidden (rejected 400): rpcUrl, issuerIdentity

CURRENT RECEIPT-V1 OUTPUT: chain, mintAddress, tokenProgramAddress, slot,
timestamp, rulesVersion, findingTaxonomyVersion, scopeChecksPerformed,
scopeChecksNotPerformed, coverageGaps, findings, interpretations,
maxAgeSeconds, disclaimer, payloadHash, receiptId, signature,
signerPublicKey. These are signed evidence fields, not a verdict or permission.

LEGACY V2 COMPATIBILITY ONLY (POST /verify) carries the historical engine
outcome labels: pass | pass_with_info_finding | warning | risk | unknowable.
- risk: rug-capable control exists (issuer_control.* findings)
- warning: needs eyes OR unverified surfaces (coverage degradation) OR high holder concentration (beta)
- pass_with_info_finding: clean on checked surfaces, informational notes
- pass: only recognized immutable infrastructure, only on checked surfaces
- unknowable: evidence unfetchable/undecodable or signer down; Raven never guesses
RULES: informational evidence never upgrades a verdict. coverageGaps is
normative: listed = NOT evaluated = unverified. Pass-grade + gaps = "no risk
findings on checked surfaces" — say: not enough evidence for a full pass.

VERIFY A CURRENT RECEIPT: use the maintained raven-receipt-verifier package
supplied through the authenticated pilot/release handoff (not yet published
on npm). Recompute payloadHash over the canonical receipt-v1 body, check
receiptId = "raven-receipt-v1:" + payloadHash, verify the ed25519 signature
over canonicalJson({domain:"raven-receipt",version:"v1",payloadHash}) using
signerPublicKey, then match that key to your independently authenticated pin.
GET /pubkey is discovery/cross-check only. Exact vector:
/receipt-v1-test-vector.json.

MACHINE SURFACES: /agents.json /openapi.json /access.json /evals.json
/key-policy.json /prompt-recipes.json /llms.txt /llms-full.txt
MCP: npx -y raven-verify-mcp (tool raven_verify_token). Local developer
output is unsigned and is not a receipt-v1 deliverable or trust verification.
ACP: offering solana_verify_token, 0.1 USDC/job (Virtuals, escrow) — SANDBOX
     ONLY, not publicly listed; not hireable via the ACP marketplace today
ACCESS: invite-gated alpha -> /request-access.html

RAVEN REFUSES TO CLAIM: "safe", guaranteed, price prediction, trading advice,
rug score, buy/sell. Not financial advice. No post-quantum guarantee.

ESCALATE TO A HUMAN when the agent's policy rejects signed findings or
requires surfaces listed in coverageGaps; or a receipt fails integrity,
signer-trust, freshness, rules, or subject checks (treat mismatch as incident).

RECEIPT MEMORY: before calling Raven, check stored receipts (deterministic
lookup: mintAddress+tokenProgramAddress+rulesVersion+receiptId). If using a
stored receipt, VERIFY it and the signer pin first; unverifiable = unusable.
Store the exact receipt-v1 response and local verification result. The older
/receipt-schema.json is legacy v2 storage compatibility; follow
/receipt-memory-policy.md for the version split.
Never store secrets in receipt memory. Missing storage is NOT a verification
failure; storage failure never alters the signed receipt or verifier result.
