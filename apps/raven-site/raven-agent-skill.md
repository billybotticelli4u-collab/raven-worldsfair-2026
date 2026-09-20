# Skill: raven_verify_token

PURPOSE: verify Solana token-launch evidence with Raven and store the signed
receipt before any trade/list/recommend/settle step.

CURRENT CONTRACT: POST /receipt/v1. POST /verify and its
replayHash/officialAttestationHash/keyId recipe are legacy v2 compatibility.

INPUTS: mintAddress, tokenProgramAddress; optional metadataAddress,
poolAddress, commitment.

STEPS:
1. Validate request shape (base58 addresses; known token program).
2. Never include rpcUrl or issuerIdentity (Raven rejects them; do not try).
3. Call the hosted API at POST
   https://raven-hosted-verifier.onrender.com/receipt/v1 with x-api-key.
   Without credentials, stop and request access. Local MCP
   (npx -y raven-verify-mcp, tool raven_verify_token) is unsigned developer
   output, not a signed receipt-v1 substitute. ACP is sandbox-only.
4. Parse the exact receipt-v1 fields: rulesVersion, findings, coverageGaps,
   timestamp, slot, payloadHash, receiptId, signerPublicKey, signature.
5. Verify with the maintained raven-receipt-verifier package supplied through
   the authenticated handoff (not yet published on npm): check payloadHash,
   receiptId, signature, rules, freshness and expected subject; match
   signerPublicKey to your independent pin. The current handoff names keyId
   rvk_c2997e90215279c2 outside the receipt-v1 wire. GET /pubkey is a
   cross-check only.
6. Store the FULL receipt with the action it gates (audit trail).
7. Decide by consumer policy from the verified current findings, scope and
   coverageGaps. Receipt-v1 has no verdict/authorization field. If gaps remain,
   say "not enough evidence for a full pass" and proceed only if policy accepts
   those exact gaps. Legacy v2 verdict mappings remain compatibility-only.
8. Produce a short audit note: verification axes, key findings, gaps,
   receiptId, slot, rules version, and the consumer-policy decision.

BANNED ACTIONS: trading advice; price prediction; recommending buying or
selling; hiding or summarizing away coverage gaps; the word "safe" when gaps
exist; exposing API keys in output, logs, or code.

PHRASE TO USE when gaps remain: "not enough evidence for a full pass".

STEP 0 (before step 1): deterministic lookup for an existing stored receipt
(mintAddress, tokenProgramAddress, rulesVersion, receiptId). If found: verify
the exact receipt and signer pin before use; if verification fails, discard
and proceed to a fresh call. Store the new raw receipt per
/receipt-memory-policy.md; never store secrets in receipt memory; storage failure
never alters the signed receipt or verifier result — it only affects audit persistence.
