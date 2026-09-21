# Raven Conformance for Solana Transaction Versions

## The developer problem

Solana software encounters legacy and v0 transactions, while SIMD-0385 specifies a proposed v1 format. A client can appear healthy while misclassifying a version byte, reading v1 instruction headers and payloads in the wrong order, accepting an out-of-bounds account index, or ignoring a transaction constraint.

Raven Conformance turns those behavioral claims into a reproducible comparison. A target names the Raven experimental profile it claims, the runner executes a pinned corpus, and the report records expected versus observed decisions and detected versions for every vector.

## The Week-2 demonstration

The second profile is `raven-solana-txversion-experimental/0`. Its 12-vector corpus covers:

- one accepted fixture for each format: legacy, v0, and v1;
- the two-instruction v1 grouped layout and its interleaved negative pair;
- exact byte consumption and fail-closed input shape;
- signature-count binding and account-index bounds;
- the v1 size limit, fee-payer header invariant, and instruction-count limit.

Each vector records its controlling source identity, section, clause, behavior class, input, and expected outcome. Published-format rows name their source URL; the local fail-closed transport row binds the committed Raven profile. The primary v1 source is SIMD-0385 with raw source-body SHA-256 `aacd6477cb5e2b67cf661fe302487a29b169391586d1b75cfa6a84334f5c5e64`; the corpus distinguishes Solana clauses from Raven-specific transport or profile extensions.

## What judges can run

```bash
cd apps/raven-conformance
npm test
npm run conform -- --profile solana --target SOL_CONFORMANT_REFERENCE --run-id solana-reference
npm run conform -- --profile solana --target SOL_BROKEN_SUBTLE --run-id solana-broken-subtle
npm run replay -- --report reports/solana-reference.json
```

The reference target exits `0` with 12/12 PASS. The deliberately stale target exits `1` and differs on exactly two rows, `V03` and `V16`, because it does not understand the v1 layout. Replay rechecks the profile, corpus, target, and report bindings before repeating the run.

## What the result means

`CONFORMANT` means that the target matched this named 12-vector corpus at its pinned digest. `DIVERGENT` identifies the exact rows where observed decision or version differed from the corpus expectation. Reports separate behavioral mismatches from crashes, timeouts, invalid output, output floods, and runner failures.

The fixtures are synthetic or generated offline. This profile does not check signatures, account state, blockhash freshness, simulation, execution, wallet rendering, Blink behavior, or what happened on-chain. The 12-vector Fair slice also omits several per-arm detections retained by its 26-vector source corpus. Strict-base64 reason discrimination, legacy/v0 header-inconsistency call sites, and `writable_unsigned_overflow` are not covered. Family-level mutant results do not prove site-by-site coverage; `DEVELOPER.md` lists the limits.

## Why this is Solana-native

This is not the existing Raven JSON-envelope profile with Solana labels. The inputs are serialized Solana transaction bytes, the comparison includes detected transaction version, and the selected behaviors trace to the published Solana transaction-format documentation, SIMD-0385, the Solana transaction pipeline documentation, and RFC 4648 for the profile's base64 transport.
