# Week-2 update — Conformance receipt on Solana DEVNET (draft)

Raven Conformance can now bind a report’s deterministic digest into a
`raven-conformance-receipt/1`, verify it offline, and (once funded) post that
digest as a Solana **DEVNET** memo. The frozen receipt-v1 mint attestation format
is unchanged; this is a separate, versioned kind. Only the digest goes on-chain —
never the full report. Stranger path: `npm run receipt:issue` → `receipt:anchor` →
`receipt:verify`. Judge UI can issue a local receipt; explorer link appears after
anchor. Labeled DEVNET everywhere. Not mainnet. Not a safety claim.
