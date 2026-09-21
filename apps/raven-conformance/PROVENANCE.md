# Solana Profile Provenance

## Integration base

- Fair integration base: `fa205f8580ac29a72188698a27974a8e63975a1c`
- Base tree: `ad0cad8bd8a450777881fd05c9501d5c2fba714a`
- Source application: `apps/raven-solana-demo` at the source demo commit below
- Source demo HEAD: `08889b69798ad69a719a2634cabbebb0eb82c5fe`
- Source demo tree: `384507c892c83c372eddb2331fabb5fad392ddd4`

## Imported target bytes

- `targets/solana/SOL_CONFORMANT_REFERENCE.mjs`: SHA-256 `b1d03b29b298c922a64078a7f55b9344c0908b92ca411b4e5371786b92cac9d5`
- `targets/solana/SOL_BROKEN_SUBTLE.mjs`: SHA-256 `91c3214b70def9c3af125b440cdf791b2391e30e6961edfbc2b06e9e3bea0d1f`

Those target bytes are unchanged from the source demo. Fixture-generation claims are inherited from that source and were not independently regenerated in this integration lane.

## Corpus lineage

- Source corpus file SHA-256: `edf533bd64bac1eb00de78833614edd94e190bef437c7f73b80b100e7ea5540e`
- Source corpus declared content digest: `c463a23b9ee3d1e91204e1d2bc9b1a3bf121e97ca9ba00e7a970b8fd97c5aa1a`
- Selection record review-package path: `REVIEWS/RAVEN_SOLANA_PROFILE_PROVENANCE_AND_SELECTION_KIMI_2026_09_20.md`
- Selection record SHA-256: `4586542b491668478167ddc83cb4087e9097ccc4936860ccd7e50c5e50497ee6`

The integrated corpus is version `1.2.0` with new bytes and a new content digest. Review of the source corpus does not approve the integrated corpus.

## Specification identities

The corpus uses two digest scopes and names the scope per vector:

- Published page or branch: `spec_digest` is SHA-256 of a committed UTF-8 clause snapshot under `spec-snapshots/`; the snapshot records the published URL, retrieval date, and full response-body digest observed at retrieval.
- Local transport policy: `spec_digest` is SHA-256 of the committed profile JSON named by `policy_source`.

No vector uses a live response-body digest as its `spec_digest`. The snapshots make the bytes used in review reproducible from a clean clone; their recorded raw-response identities do not claim that a mutable upstream page will keep the same body.
