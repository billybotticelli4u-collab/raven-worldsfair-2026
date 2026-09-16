# PROVENANCE — raven-solana-demo

## Protocol facts and where they came from (all accessed 2026-09-16)

| Fact | Source |
|---|---|
| Runtime supports legacy, v0, v1; size limits 1232/1232/4096; v1 removes ALTs, rejects duplicate addresses | [Solana docs — Transaction versions](https://solana.com/docs/core/transactions/versions) |
| v1 envelope reorder: signatures move to the tail, version byte `0x81` at offset zero; `0x80` is the v0 prefix on the MESSAGE, not the transaction; config = u32 bitmask + positional values after the account array | [solana-foundation/solana-dev-skill — transactions-v1.md](https://github.com/solana-foundation/solana-dev-skill/blob/main/skills/solana-dev/references/transactions-v1.md) |
| v1 mainnet activation 2026-09-09 (Agave v4.2, feature gate `txv1aq4pp281K9um3tnPgkfX8UqtFT6wcVW3hNezGLL`) | [Solana Compass, 2026-09-03](https://solanacompass.com/news/solana-transaction-v1-heads-to-mainnet-september-9-format-breaking-changes-and-what-it-unlocks) + feature-gate check instructions in the skill doc |
| Config mask bit assignments (fee=0b11 both bits, CU=4, loaded=8, heap=16), instruction header `[programIndex u8][numAccounts u8][numDataBytes u16 LE]`, v1 signature tail count implicit from header byte 1 | `@solana/kit` **8.3.0** package source: `@solana/transaction-messages` lines 467–485, 515–560, 1660–1685; `@solana/transactions` lines 47–62, 82–88, 106–141. Pinned by reading `node_modules` at build time. |
| heapSize multiple of 1024 in [32 KiB, 256 KiB] = sanitization failure | transactions-v1.md (above). NOTE: kit 8.3.0 validates heap client-side and REFUSES to build an out-of-range v1, so V13 bytes were derived by single-field surgery on a real fixture. |

Doc-vs-code discrepancy noted: the skill doc says "Kit does not validate this client-side" for heap bounds; kit 8.3.0 does. The corpus labels V13 accordingly.

## Fixtures

- `fixtures/base-fixtures.json` — three REAL serialized transactions (legacy, v0, v1) generated **offline** by `fixtures/generate.mjs` using `@solana/kit` 8.3.0 with fixed synthetic keys (seeds 0x11×32 / 0x22×32) and a synthetic blockhash (0x42×32). Ed25519 signing is deterministic; byte-identical across runs (verified 3×). kit's own decoder round-trips each with the correct version.
  - legacy sha256 `2385a602397d22dbdca60401f69aecc26829c9c5ddb4b398cc41881bcc88194d` (215 B)
  - v0 sha256 `a6d75426ebe41c3123f239a004154a6841b790780e7ed18a631f0192b2a982df` (217 B)
  - v1 sha256 `9cc0d4814d901b9345b93fc43ab6f7daba45748f9ec7c41e3b33157a2d42f98f` (240 B)
- Negative vectors derived from these by documented single-field surgery inside `fixtures/build-corpus.mjs` (truncation, trailing bytes, version-byte flips, non-canonical short-vec, duplicate account substitution, heap value edit). Each vector carries a `provenance` label: `real` / `derived` / `synthetic`.
- **Key material is synthetic throwaway material created for this corpus. It controls nothing and holds no value on any cluster. The blockhash is not a real blockhash.**

## What is NOT claimed

- Fixtures are locally generated; they establish nothing about current mainnet state beyond the cited documentation.
- The v1 wire layout is pinned to `@solana/kit` 8.3.0's codec (source-quoted above); SIMD-0385 itself is cited via the skill doc, not read as a primary spec PDF.
