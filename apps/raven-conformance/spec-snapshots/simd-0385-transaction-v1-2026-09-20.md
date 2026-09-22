# SIMD-0385 Transaction V1 — Clause Snapshot

- Published source: https://github.com/solana-foundation/solana-improvement-documents/blob/main/proposals/0385-transaction-v1.md
- Retrieved from `main`: 2026-09-20
- Document status at retrieval: `Review`
- Full raw Markdown SHA-256 at retrieval: `aacd6477cb5e2b67cf661fe302487a29b169391586d1b75cfa6a84334f5c5e64`
- Snapshot scope: the v1 fields and constraints exercised by the Fair corpus; retained because the source URL names a mutable branch.

## Selected clauses

- `VersionByte` is 129 (`0x81`).
- The transaction carries `NumInstructions` headers followed by the corresponding instruction payloads.
- Instruction account indices are bounded by `NumAddresses` during sanitization.
- The serialized transaction size is at most 4096 bytes.
- `num_readonly_signed_accounts` must be smaller than `num_required_signatures`.
- `NumInstructions` is at most 64.
- `Signatures` has `num_required_signatures` elements and each element is a 64-byte Ed25519 signature.
- The transaction contains no trailing data after the signatures field and has no padding fields.

These bullets are a review snapshot, not a replacement for the published proposal. Vector metadata retains the published URL and names the specific section used.
