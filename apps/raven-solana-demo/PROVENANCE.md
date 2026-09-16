# PROVENANCE — raven-solana-demo

## Protocol facts and where they came from (all accessed 2026-09-16)

| Fact | Source |
|---|---|
| Runtime supports legacy, v0, v1; size limits 1232/1232/4096; v1 removes ALTs, rejects duplicate addresses | [Solana docs — Transaction versions](https://solana.com/docs/core/transactions/versions) |
| v1 wire layout, firsthand: version byte `0x81`; LegacyHeader; config = u32 bitmask + positional values; **InstructionHeaders array THEN InstructionPayloads array (grouped, not interleaved)**; signature tail count implicit; `num_readonly_signed >= num_required_signatures` is a sanitization failure; constraints table (12 sigs / 64 addresses / 64 instructions / 4096 B) | [SIMD-0385 proposal text](https://github.com/solana-foundation/solana-improvement-documents/blob/main/proposals/0385-transaction-v1.md) — read firsthand for profile 0.2.0 (doc status: Review) |
| v1 mainnet-beta activation: feature gate `txv1aq4pp281K9um3tnPgkfX8UqtFT6wcVW3hNezGLL`, activated at **slot 447120000 = 2026-09-15T01:04:23Z** | Chain-measured 2026-09-16: `getAccountInfo` on the gate account (owner `Feature111…`, data = `Some(447120000)`) + `getBlockTime(447120000)` = 1789434263, via `api.mainnet-beta.solana.com`. One read-only public RPC query at one moment; no second provider. (The earlier 2026-09-09 date came from a secondary news source and was the pre-delay schedule — corrected in profile 0.2.0.) |
| Config mask bit assignments (fee=0b11 both bits, CU=4, loaded=8, heap=16); grouped instruction layout confirmed in encoder output | `@solana/kit` **8.3.0** package source: `@solana/transaction-messages` `getInstructionHeaderEncoder/Decoder`, and the message encoder's `instructionHeaders` / `instructionPayloads` arrays (dist/index.node.mjs ~lines 522–610, 1231–1235). Additionally confirmed by encoding a 2-instruction v1 transaction and inspecting the bytes (grouped). |
| heapSize multiple of 1024 in [32 KiB, 256 KiB] = sanitization failure | SIMD-0385 TransactionConfigMask section. NOTE: kit 8.3.0 validates heap client-side and REFUSES to build an out-of-range v1, so V13 bytes were derived by single-field surgery on a real fixture. |

Doc-vs-code discrepancies noted:
- A secondary reference doc said "Kit does not validate this client-side" for heap bounds; kit 8.3.0 does. The corpus labels V13 accordingly.
- **Profile 0.1.0 mis-stated the v1 instruction layout as interleaved** ("as implemented by @solana/kit 8.3.0") — a misreading of the codec source. Independent review caught it because every v1 vector had exactly one instruction, where grouped and interleaved are byte-identical. Corrected in 0.2.0; V16/V17 now pin the distinction.
- kit 8.3.0's decoder tolerates trailing bytes, oversized transactions, out-of-bounds account indexes, and cap violations (measured: V17, V20–V26 decode fine). Codec decode success is not admission hygiene.
- The SIMD-0385 document at `main` still says `status: Review` with an unfilled `feature:` placeholder; the feature-gate account on mainnet-beta is the usable activation source.

## Fixtures

- `fixtures/base-fixtures.json` — four REAL serialized transactions (legacy, v0, v1, and a 2-instruction v1) generated **offline** by `fixtures/generate.mjs` using `@solana/kit` 8.3.0 with fixed synthetic keys (seeds 0x11×32 / 0x22×32) and a synthetic blockhash (0x42×32). Ed25519 signing is deterministic; byte-identical across runs (legacy/v0/v1 verified byte-identical across the 0.1.0→0.2.0 regeneration). kit's own decoder round-trips each with the correct version.
  - legacy sha256 `2385a602397d22dbdca60401f69aecc26829c9c5ddb4b398cc41881bcc88194d` (215 B)
  - v0 sha256 `a6d75426ebe41c3123f239a004154a6841b790780e7ed18a631f0192b2a982df` (217 B)
  - v1 sha256 `9cc0d4814d901b9345b93fc43ab6f7daba45748f9ec7c41e3b33157a2d42f98f` (240 B)
  - v1_2ix sha256 `f916689ab65ffa39c60e0457a38747304c1a87111913dfebf3f0b2022c2edd6c` (238 B)
- Fixture regeneration from the committed manifest is verified: `npm ci && node fixtures/generate.mjs` (devDependencies `@solana/kit` 8.3.0 + `@solana-program/system` ^0.14.1 — the latter was missing from package.json in v0.1.0, breaking regeneration; fixed in 0.2.0).
- Negative vectors derived from these by documented single-field surgery or programmatic construction inside `fixtures/build-corpus.mjs` (truncation, trailing bytes, version-byte flips, non-canonical short-vec, duplicate account substitution, heap value edit, header/payload reorder, header field surgery, valid-except-size constructions, cap violations). Each vector carries a `provenance` label: `real` / `derived` / `synthetic`.
- **Key material is synthetic throwaway material created for this corpus. It controls nothing and holds no value on any cluster. The blockhash is not a real blockhash.**

## What is NOT claimed

- Fixtures are locally generated; they establish nothing about current mainnet state. The activation timestamp is a chain-measured fact about the feature-gate account, not evidence derived from the fixtures.
- The corpus tests the named rules of the experimental profile, not SIMD-0385 sanitization as a whole. The profile is Raven-experimental, not a Solana specification, and the SIMD itself is still in Review status.
