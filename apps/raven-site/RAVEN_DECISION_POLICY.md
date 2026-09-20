# Raven Decision Policy (doc twin of /decision-policy.json)
Verdicts: pass/pass_with_info -> proceed only if gaps acceptable under YOUR
policy. warning -> escalate or explicit human approval. risk -> block or
escalate. unknowable -> not verified. verifier_error -> do not proceed;
retry/request support. stale receipt -> re-verify before action.
Language: never "safe" with gaps; say "not enough evidence for a full pass";
explain unchecked surfaces via coverageGaps; missing optional evidence
(metadataAddress, poolAddress) is a gap, never a pass. Liquidity evidence is
never converted into safety or price claims.
Handoff: verify -> verify signature vs independently pinned key (/pubkey cross-check) -> store exact receipt ->
evaluate verdict+gaps -> proceed/block/escalate.
Staleness: re-verify before high-risk/material actions, when prior receipt
lacked pool/metadata evidence, at delayed-execution time, or after engine
version changes. No universal expiry claimed.
Governance: Raven provides signed preflight evidence. It does not make the
business decision, does not decide allocation, and does not replace
treasury, legal, compliance, or security approval. Not financial advice.
