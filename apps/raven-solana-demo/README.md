# raven-solana-demo — EXPERIMENTAL Solana transaction-version admission demo

**Status: EXPERIMENTAL Raven R&D demo. Not an accepted Raven protocol. Not a certification. Optional and off the critical path of the primary receipt-conformance demo.**

One narrow, technically credible Solana demonstration for the Crypto World's Fair story:

> **Claim:** given the raw bytes of a serialized Solana transaction, an admission layer must correctly classify and admit the three formats the Solana runtime now supports — legacy, v0, and **v1 (SIMD-0385; feature gate `txv1aq4pp281K9um3tnPgkfX8UqtFT6wcVW3hNezGLL` activated on mainnet-beta at slot 447120000 = 2026-09-15T01:04:23Z, chain-measured via getAccountInfo/getBlockTime)** — and reject malformed, non-canonical, or unsupported-version bytes. Getting the version byte wrong shifts every subsequent field boundary.

The demo ships one correct target and two Raven-owned broken targets, a 26-vector corpus with expectations frozen by an independent oracle, and a zero-dependency harness modeled on the MVP interface (`apps/raven-conformance`), which it does not modify.

## Why this matters to a Solana developer (two sentences)

Version detection is the first byte-level decision a parser makes: a pre-v1 parser reads the v1 version byte `0x81` as a short-vec continuation, computes a nonsense signature count, and rejects every valid v1 transaction — the exact "stale consumer breaks on v1" failure the Solana docs warn about. And the v1 instruction section is *grouped* (all InstructionHeaders, then all InstructionPayloads): a parser built on the wrong layout silently misreads every instruction of any real multi-instruction v1 transaction while looking structurally fine to a codec.

## Layout

```
profiles/raven-solana-txversion-experimental-0.json   narrow experimental profile (14 rules, cited sources)
corpus/raven-solana-txversion-demo-corpus-1.json      26 frozen vectors (digest c463a23b…)
oracle/oracle.mjs                                     independent spec-arithmetic parser; freezes expectations
targets/                                              SOL_CONFORMANT_REFERENCE, SOL_BROKEN_OBVIOUS, SOL_BROKEN_SUBTLE
harness/run.js                                        zero-dependency MVP-style runner (decision AND version)
harness/selftest.js                                   corpus-integrity guard (npm test)
fixtures/                                             base fixtures + generator + corpus builder
results/RESULTS.json                                  frozen measured outcomes
```

## Reproduce (no npm install needed)

```bash
npm test                   # corpus integrity + reference CONFORMANT + both broken targets DIVERGENT
node harness/run.js --all
# SOL_CONFORMANT_REFERENCE — CONFORMANT (26/26)
# SOL_BROKEN_OBVIOUS     — DIVERGENT (21 divergences — accept-everything caught)
# SOL_BROKEN_SUBTLE      — DIVERGENT (V03 + V16 false refusal of valid v1; V10 incorrect admission)
```

Regenerate fixtures and re-freeze the corpus (requires `npm install`, offline):

```bash
node fixtures/generate.mjs            # real legacy/v0/v1 bytes, deterministic synthetic keys
node fixtures/build-corpus.mjs --kit-check
```

## Repair history (v0.1.0 → profile 0.2.0 / corpus 1.1.0)

Independent review (Claude, GROK — `RESEARCH/RAVEN_FAIR_SOLANA_DEMO_INDEPENDENT_REVIEW_CLAUDE_2026_09_16.md`) found that v0.1.0 implemented an **interleaved** v1 instruction layout; SIMD-0385 and the @solana/kit 8.3.0 encoder both specify **grouped** (all headers, then all payloads). Every v1 vector had exactly one instruction, where the two layouts are byte-identical — so the defect was invisible to the corpus. This repair: corrected R9 + both parsers to grouped, added the 2-instruction ACCEPT/REJECT layout pair (V16/V17, identical byte multisets), tightened R6 to the SIMD-0385 strict inequality (V23), added the SIMD-0385 count caps as R12b (V24–V26), added valid-except-size vectors that actually kill size-cap-deletion mutants (V21/V22), added header/sigcount/index-bounds killers (V18–V20), corrected the mainnet activation date (was 2026-09-09 from a secondary source; chain-measured 2026-09-15T01:04:23Z), fixed fixture regeneration from the committed manifest, corrected the network-policy wording, and added `npm test` as a corpus-shrink guard.

## What this demo does NOT establish

- No Ed25519 signature verification, account existence, blockhash freshness, simulation, or execution — envelope-level byte-structure admission only.
- No claim about current mainnet behavior from the fixtures: they are locally generated with synthetic throwaway keys and a synthetic blockhash (see `PROVENANCE.md`). The activation date above is a separate, chain-measured fact about the feature gate account, not evidence derived from the fixtures.
- This corpus does not test SIMD-0385 sanitization as a whole; it tests the named rules of the experimental profile. The profile remains Raven-experimental, not a Solana specification.
- Oracle and reference target share an author; kit cross-check provides third-party-codec confirmation (bidirectional: decode_ok AND decode_fail expectations), but this is author evidence, not independent review.
- Isolation is MVP-style restricted-env child process with timeout — not a container. The harness does NOT deny network, filesystem, or child-process access to targets; proxy env vars are unset only.
