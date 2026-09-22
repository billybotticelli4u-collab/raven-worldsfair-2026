# Solana Transaction Pipeline — Clause Snapshot

- Published source: https://solana.com/docs/core/transactions/transaction-pipeline
- Retrieved: 2026-09-20
- Full response-body SHA-256 at retrieval: `a8a2cb701c48621f30a125ed3aead6c8baa7e9d5b08d8694babda92070315e83`
- Snapshot scope: the short sanitize clause used by V19, retained because the live HTML response is mutable.

## Sanitize

Source excerpt: “Number of signatures matches `num_required_signatures` in the header”.

Raven interpretation: sanitization rejects a serialized transaction whose signature-vector length differs from the header's required-signature count.
