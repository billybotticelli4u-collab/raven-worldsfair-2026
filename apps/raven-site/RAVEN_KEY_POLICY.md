# Raven Key Policy (doc twin of /key-policy.json and /key-policy.html)
Current receipt-v1: Ed25519 under the raven-receipt/v1 domain. Receipts carry
signerPublicKey; the authenticated release/onboarding handoff identifies the
accepted production signer as keyId rvk_c2997e90215279c2. The verifier's
/pubkey is discovery/cross-check only, never the trust root. Legacy v2
compatibility receipts carry keyId + signatureAlg under the
raven-official-attestation/v2 domain. Rotation is explicit,
versioned, and published BEFORE retirement; deprecated keys remain verifiable
for historical receipts; agents reject receipts from unknown keys. Future
hybrid/post-quantum schemes may arrive under a new keyId and a
future-compatible signatureSuite field (documented plan, not current
behavior). No urgency claims, no broken-crypto claims, no investment advice.
Full rationale: apps/raven-site/RAVEN_CRYPTO_AGILITY.md.
