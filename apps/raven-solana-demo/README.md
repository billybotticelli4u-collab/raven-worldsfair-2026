# raven-solana-demo — EXPERIMENTAL Solana transaction-version admission demo

**Status: EXPERIMENTAL Raven R&D demo. Not an accepted Raven protocol. Not a certification. Optional and off the critical path of the primary receipt-conformance demo.**

One narrow, technically credible Solana demonstration for the Crypto World's Fair story:

> **Claim:** given the raw bytes of a serialized Solana transaction, an admission layer must correctly classify and admit the three formats the Solana runtime now supports — legacy, v0, and **v1 (SIMD-0385, mainnet-activated 2026-09-09)** — and reject malformed, non-canonical, or unsupported-version bytes. Getting the version byte wrong shifts every subsequent field boundary.

The demo ships one correct target and two Raven-owned broken targets, a 15-vector corpus with expectations frozen by an independent oracle **before** any target ran, and a zero-dependency harness modeled on the MVP interface (`apps/raven-conformance`), which it does not modify.

## Why this matters to a Solana developer (two sentences)

Version detection is the first byte-level decision a parser makes: a pre-v1 parser reads the v1 version byte `0x81` as a short-vec continuation, computes a nonsense signature count, and rejects every valid v1 transaction — the exact "stale consumer breaks on v1" failure the Solana docs warn about. Worse, a parser that tolerates non-minimal encodings *admits* bytes that the post-SIMD-0385 envelope convention defines as a malformed v1 transaction, silently misinterpreting every field after it.

## Layout

```
profiles/raven-solana-txversion-experimental-0.json   narrow experimental profile (13 rules, cited sources)
corpus/raven-solana-txversion-demo-corpus-1.json      15 frozen vectors (digest 99d91fb7…)
oracle/oracle.mjs                                     independent spec-arithmetic parser; freezes expectations
targets/                                              SOL_CONFORMANT_REFERENCE, SOL_BROKEN_OBVIOUS, SOL_BROKEN_SUBTLE
harness/run.js                                        zero-dependency MVP-style runner (decision AND version)
fixtures/                                             base fixtures + generator + corpus builder
results/RESULTS.json                                  frozen measured outcomes
```

## Reproduce (no npm install needed)

```bash
node harness/run.js --all
# SOL_CONFORMANT_REFERENCE — CONFORMANT (15/15)
# SOL_BROKEN_OBVIOUS     — DIVERGENT (11 divergences)
# SOL_BROKEN_SUBTLE      — DIVERGENT (V03 false refusal of valid v1; V10 incorrect admission)
```

Regenerate fixtures and re-freeze the corpus (requires `npm install`, `@solana/kit` 8.3.0, offline):

```bash
node fixtures/generate.mjs            # real legacy/v0/v1 bytes, deterministic synthetic keys
node fixtures/build-corpus.mjs --kit-check
```

## What this demo does NOT establish

- No Ed25519 signature verification, account existence, blockhash freshness, simulation, or execution — envelope-level byte-structure admission only.
- No claim about current mainnet behavior: fixtures are locally generated with synthetic throwaway keys and a synthetic blockhash (see `PROVENANCE.md`).
- Oracle and reference target share an author; kit cross-check provides third-party-codec confirmation for ACCEPT vectors, but this is author evidence, not independent review.
- Isolation is MVP-style restricted-env child process with timeout — not a container.
