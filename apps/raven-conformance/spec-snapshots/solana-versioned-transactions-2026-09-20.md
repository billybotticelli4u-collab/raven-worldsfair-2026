# Solana Versioned Transactions — Clause Snapshot

- Published source: https://solana.com/docs/core/transactions/versioned-transactions
- Retrieved: 2026-09-20
- Full response-body SHA-256 at retrieval: `0ee4929047e7923cf38db7c9e1596eedafb8b3cc6c2c9b5bf717567d24186878`
- Snapshot scope: the short source clauses used by V01 and V02, retained because the live HTML response is mutable.

## Legacy

Source clause snapshot:

- Legacy has no version prefix: the first transaction byte is the compact-u16 signature-array count.
- The first message byte is `num_required_signatures`, whose high bit is unset.
- Each variable-length array is prefixed by a compact-u16 length.

Raven interpretation: the legacy fixture begins with its compact-u16 signature count, followed by signatures and a legacy message whose header byte cannot be mistaken for a version prefix.

## Version 0

Source clause snapshot:

- v0 adds a `0x80` version-prefix byte before the legacy-compatible message body.
- v0 appends `address_table_lookups` after the instructions.
- Each lookup contains the table account key plus compact-u16-prefixed writable and read-only index arrays.

Raven interpretation: version 0 is selected by the `0x80` prefix before the legacy-compatible body; any lookup extension follows the instruction list.
