# RAVEN SKILL (for Claude Code / Codex / Cursor / Gemini and agent frameworks)

WHAT RAVEN IS: the signed evidence-and-receipt layer an AI agent checks
before touching a Solana token. The current receipt-v1 carries decoded
on-chain findings, explicit coverageGaps, signed scope, rulesVersion,
payloadHash, receiptId, signerPublicKey, and an ed25519 signature. It is
evidence, not a verdict or authorization.

WHEN TO USE: before any trade, listing, recommendation, settlement, or
escalation involving a Solana token. Also when re-checking: do a
deterministic stored-receipt lookup first (mintAddress + tokenProgramAddress
+ rulesVersion + receiptId).

HOSTED API:
curl -s -X POST https://raven-hosted-verifier.onrender.com/receipt/v1 \
  -H "x-api-key: $RAVEN_KEY" -H "content-type: application/json" \
  -d '{"mintAddress":"...","tokenProgramAddress":"..."}'
Optional: metadataAddress, poolAddress, commitment. NEVER send rpcUrl or
issuerIdentity (rejected 400). Contract: /openapi.json.

MCP: npx -y raven-verify-mcp -> tool raven_verify_token. Local developer
output is unsigned; it is not a signed receipt-v1 or trust-verification path.
Config: {"mcpServers":{"raven":{"command":"npx","args":["-y","raven-verify-mcp"]}}}

ACP (SANDBOX ONLY, NOT PUBLICLY LISTED): Virtuals offering
solana_verify_token, 0.1 USDC/job, escrowed, signed deliverable. Raven is not
discoverable or hireable in the public ACP marketplace today; use the hosted
signed API, which requires a key.

VERIFY EVERY CURRENT RECEIPT: use the maintained raven-receipt-verifier
package supplied through the authenticated pilot/release handoff (not yet
published on npm). Recompute payloadHash, check receiptId, verify the
ed25519 signature over canonicalJson({domain:"raven-receipt",version:"v1",payloadHash})
using signerPublicKey, then match the signer to your independent pin. GET
/pubkey is discovery/cross-check only. Exact vector:
/receipt-v1-test-vector.json. The authenticated handoff names the current
anchor as keyId rvk_c2997e90215279c2 outside the receipt-v1 wire.
Unverifiable receipt = unusable; rerun.

LEGACY V2 COMPATIBILITY ONLY: POST /verify and its verdict,
replayHash, officialAttestationHash, and keyId envelope. Do not use that
recipe for new integrations.

COVERAGE-GAP LANGUAGE: coverageGaps is normative — listed surfaces were NOT
evaluated. Current receipt-v1 has no verdict or authorization field. Say "not enough evidence for a full pass" when gaps remain. Explain anything unchecked
using the gaps, never by guessing.

HANDOFF POLICY: verify integrity, signer pin, subject, rules, freshness,
findings, and gaps separately, then apply consumer policy. Never invent a
receipt-v1 verdict. Legacy v2 risk/warning/pass/unknowable mappings remain
compatibility-only.

FORBIDDEN CLAIMS: "safe", guaranteed, price prediction, trading advice,
buy/sell recommendation, rug score, yield/return language, portfolio advice.

ERROR HANDLING: 400 invalid_request -> fix the request shape, do not retry
blind. 401 -> credentials missing/wrong; stop, never embed keys in code or
memory. 422 receipt_unavailable -> unsigned refusal, no receipt issued. 429
-> back off (15/min per key). 500/502/503/504 -> no usable receipt; retry
later or escalate, never substitute a guess.

STORE RECEIPTS: exact receipt-v1 response plus local verification result per
/receipt-memory-policy.md. The older /receipt-schema.json is legacy v2
storage compatibility. Append-only — later receipts are new evidence,
not replacement truth. Never store API keys or secrets in receipt memory.
Storage failure never alters the signed receipt or verifier result.

Raven signs evidence. It does not predict price and is not financial advice.

BEFORE ACTING ON A TOKEN (always, in order):
1. Call POST /receipt/v1. 2. Verify receipt integrity and expected subject.
3. Match signerPublicKey to the independently pinned key; cross-check GET
/pubkey against the pin. 4. Check rulesStatus. 5. Check findings. 6. Check
coverage gaps. 7. Check receipt staleness. 8. Apply the
decision policy (/decision-policy.json). 9. Apply the runtime permission
policy (/agent-runtime-policy.json — Raven is read-only; never give it
wallet scope). 10. Store the exact signed receipt. 11. Escalate when
required. 12. Re-verify before any delayed material action.
If asked whether to buy/sell/hold: Raven does not provide trading,
investment, treasury, legal, tax, or portfolio advice.
ADDITIONAL REFUSALS: do not infer liquidity quality without pool evidence;
do not treat missing evidence as a pass; missing optional evidence is a
coverage gap.

CONTEXT IS NOT EVIDENCE: context helps you decide what to ask Raven, but
only the signed receipt states what Raven actually checked. Screenshots,
chat summaries, UI badges, social posts, and model explanations are never
authority. Handoffs carry the exact receipt JSON + signature; receivers
re-verify. Agent memory is not authority: a remembered pass never
authorizes a new material action.

## Never (compact agent rules)
- Never treat "pass" as "safe" — with coverage gaps, say "not enough
  evidence for a full pass".
- Never hide coverage gaps or convert risk/warning/unknowable into approval.
- Never use Raven for trading advice, buy/sell/hold, position size, yield,
  or treasury decisions.
- Never proceed on a stale, unsigned, invalid, or unknown-key receipt —
  fail closed or escalate.

Positioning rule: discovery tools find, research tools summarize,
payment tools pay, trading tools execute - Raven verifies BEFORE action.
Asset-backed/RWA/stablecoin/brand claims are coverage gaps unless
explicitly evidenced in the receipt.
