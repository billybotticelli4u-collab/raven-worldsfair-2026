# Raven Receipt Memory Policy (for agents)

1. Store the raw signed receipt EXACTLY as returned. rawResponse is the
   source of truth; everything else is derived.
   Current receipt-v1 comes from POST /receipt/v1; POST /verify is legacy v2
   compatibility. Never reinterpret a v2 archive as receipt-v1.
2. Store explanations separately (derivedExplanation). A derived explanation
   never replaces, edits, or overrides the raw receipt.
3. Never summarize away coverage gaps. coverageGaps is normative.
4. Never call a token safe when gaps remain. When gaps remain, say:
   "not enough evidence for a full pass."
5. Deterministic lookup BEFORE calling Raven again. Receipt-v1 lookup keys:
   mintAddress, tokenProgramAddress, rulesVersion, slot, payloadHash,
   receiptId. Legacy v2 retains replayHash, observedSlot, engineVersion,
   keyId. Not fuzzy vibes, not embeddings.
6. Suggested namespace formats:
   raven/{project}/{agent}/{environment}
   raven/{customer}/{bot}/{chain}
   raven/{mintAddress}/{engineVersion}
7. Before USING a stored receipt-v1: recompute payloadHash, check receiptId,
   verify the signature with signerPublicKey, match that signer to your
   independent pin, then check freshness, rules and expected subject.
   /pubkey is discovery/cross-check only. A receipt that cannot be verified
   under its exact version is unusable — discard and rerun verification.
8. Storage is OPTIONAL. If storage is unavailable, verification still
   proceeds; a storage failure never alters the signed receipt or separate
   verifier result — it only affects audit persistence.
9. NEVER store in receipt memory: API keys, private keys, bearer tokens,
   seed phrases, signing keys. Receipts contain none of these; keep it so.
10. A stale receipt (older engineVersion) is still a true historical claim.
    Re-verify the token for current state; compare receipts to distinguish
    coverage expansion from chain-state change.

Current vector: /receipt-v1-test-vector.json. The older /receipt-schema.json
and storage adapters are legacy v2 compatibility. Key policy:
/key-policy.json. Raven signs evidence; it does not predict price and is not
financial advice.
11. Do not overwrite older receipts. A later receipt is NEW evidence, not
    replacement truth — append, never replace. Keep payload and verification
    metadata together wherever they are stored.
12. Agent memory may hold preferences and pointers, never authority. A
    natural-language summary is not the record; a remembered pass never
    authorizes a NEW material action. Re-open the exact receipt and apply
    the staleness policy. Required stored fields incl. actionContext,
    decisionPolicyVersion, finalAction: see receipt-storage.json memoryPolicy.
