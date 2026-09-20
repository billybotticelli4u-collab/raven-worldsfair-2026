# Raven Cryptographic Agility & Long-Term Receipt Policy

Security-readiness document. Raven does NOT claim post-quantum security, and
quantum computers do NOT currently break Raven's signatures. This document
exists so receipts stay verifiable across key rotations and future algorithm
migrations — algorithm agility as a design principle.

## Current receipt-v1 behavior

- Signing algorithm: **ed25519**, domain-separated
  (`canonicalJson({domain:"raven-receipt",version:"v1",payloadHash})`).
- Current authenticated handoff identifies the production signer as
  **rvk_c2997e90215279c2**; receipt-v1 carries the exact `signerPublicKey`.
- Public key endpoint: `GET https://raven-hosted-verifier.onrender.com/pubkey`
  is discovery/cross-check material only; it does not bootstrap trust.
- Receipt fields returned by the primary `POST /receipt/v1` path:
  `chain, mintAddress, tokenProgramAddress, slot, timestamp, rulesVersion,
  findingTaxonomyVersion, scopeChecksPerformed, scopeChecksNotPerformed,
  coverageGaps, findings, interpretations, maxAgeSeconds, disclaimer,
  payloadHash, receiptId, signature, signerPublicKey`.

## What a verifying agent must check today

1. Recompute `payloadHash` over the canonical 14-field receipt-v1 body.
2. Require `receiptId === "raven-receipt-v1:" + payloadHash`.
3. Verify the ed25519 `signature` over the receipt-v1 domain preimage using
   `signerPublicKey`.
4. Match `signerPublicKey` to the independently authenticated pin supplied
   with the reviewed verifier package/handoff; `/pubkey` is cross-check only.
5. Evaluate freshness, rules status and expected subject independently from
   integrity and signer trust. Treat `coverageGaps` as unverified surfaces.

Exact current vector: `/receipt-v1-test-vector.json`. The maintained
`raven-receipt-verifier` package is reviewed but not yet published on npm.

## Legacy v2 compatibility

`POST /verify` remains reachable for existing integrations. Its frozen v2
envelope contains `verdict`, `engineOutcome`, `replayHash`,
`officialAttestationHash`, `keyId`, `issuedAt`, `signatureAlg` and related
fields, signed under `raven-official-attestation` / v2. Use
`/receipt-test-vector.json` only for that legacy contract. Do not use the v2
recipe for new integrations or describe its verdict object as receipt-v1.

## Why receipts are key-scoped and versioned

A receipt is a historical claim: "this key said this, then." Receipt-v1 binds
the exact signerPublicKey and rulesVersion; legacy v2 binds keyId and engine
version. Rotation and engine evolution never silently rewrite history.

## Key rotation principles
- Rotation is a deliberate operator action (see operator/skills/
  key-rotation-review.md) — never automated, always human-approved.
- A new key gets a new keyId; `/pubkey` may serve multiple keys.
- Old receipts remain verifiable against the key that signed them. Agents
  must NOT assume the newest key verifies old receipts.

## Retired keys
Retired = no longer signs new receipts; remains published (marked) so
historical receipts verify. Honoring old signatures is the point of receipts.

## Revoked keys
Revoked = compromise suspected. A revoked key blocks future trust; receipts
signed by it require case-by-case review (cross-check against the Quality
Ledger / re-run the request). Revocation semantics will be published in
/key-policy.json `keyStates` before any revocation event.

## Old receipt verification policy
Store the full receipt and its version. Verification needs the exact receipt,
the correct versioned verifier and the historical signer pin. Do not infer a
receipt version from whichever key is newest.

## Future algorithm migration (future receipt-version plan — NOT current behavior)
If a stronger algorithm is adopted (including post-quantum candidates), Raven
will: add it under a NEW keyId and a NEW receipt/attestation version; publish
both algorithms in `/pubkey` and `/key-policy.json` during transition; never
re-sign or mutate historical receipts. Migration is additive.

## What this document does not claim
No post-quantum guarantee. No claim that current cryptography is broken. No
investment, market, or asset commentary of any kind.
