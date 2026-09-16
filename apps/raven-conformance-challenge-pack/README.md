# Raven Conformance Challenge Pack

Standalone adversarial oracle for `raven-canonical-envelope/1`. It does not edit or wrap Billy's runner/UI.

## Frozen Source

- Repository: `billybotticelli4u-collab/raven-worldsfair-2026`
- Branch inspected: `billy/fair-conformance-mvp-2026-09-16`
- HEAD: `53360df071872a29447993e879add2be9406b7b5`
- TREE: `468b0397c89165160337a53597e8b6533f1f1dec`
- Baseline inspected: 3 Raven-owned targets, 10 vectors, 7 tests

## Reproduce

```bash
cd apps/raven-conformance-challenge-pack
npm test
npm run evaluate
```

`npm run evaluate` executes the exact MVP `CONFORMANT_REFERENCE.mjs` bytes and nine loadable semantic mutants, writes `results/measured.json`, and regenerates `COVERAGE_MATRIX.md`. Expectations are frozen in `corpus/raven-canonical-envelope-challenge-corpus-1.json`; the harness never learns expectations from target output.

The corpus `content_digest_sha256` covers the UTF-8 bytes of the two-space-indented JSON object with that digest field removed and one final newline. The machine result separately records the exact corpus file digest, target manifest digest, source profile/corpus/reference digests, and each vector's exact stdin bytes and digest.

## Scope

- 10 mapped baseline vectors plus 23 added vectors.
- 29 specified/scored vectors and 4 unscored underspecified parser probes.
- Exact stdin bytes are recorded as Base64 and SHA-256 in the machine result.
- The profile has no signer/key field, so signer/key representation testing is not applicable.
- Passing means matching this named frozen corpus only. It does not establish security, authorization, signer trust, deployment identity, provenance, or on-chain execution.

## Three Judge-Visible Divergences

1. An accept-everything target is rejected by the negative controls.
2. A refuse-everything target is rejected by valid controls.
3. A target hashing insertion-order JSON is separated from recursive sorted-key canonicalization by paired positive/negative vectors.
