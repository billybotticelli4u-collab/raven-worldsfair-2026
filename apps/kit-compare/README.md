# Compare real Kit versions

This is the source of [ravenattest.com/compare.html](https://ravenattest.com/compare.html): three published `@solana/kit` browser builds execute the same bytes locally. No wallet, signing, RPC, upload or install is needed. The downloadable JSON report is unsigned. A difference is evidence to investigate, not a bug claim or safety verdict; impact unassessed.

## Serve locally

From the repository root, using Python 3:

```sh
cd apps/kit-compare
python3 -m http.server 8080 --bind 127.0.0.1
```

Open http://127.0.0.1:8080/compare.html and click **Run real comparison**. Stop with Ctrl-C. Use a different port if 8080 is occupied. The page's home and privacy links belong to the hosted Raven site; when serving only this folder, `/` is the directory listing and `privacy.html` is not included. Visit https://ravenattest.com/privacy.html for the current notice.

| Synthetic example | Kit 3.0.3 | Kit 4.0.0 | Kit 8.3.0 |
| --- | --- | --- | --- |
| E, version-3 message | ACCEPT, version 3 | REJECT | REJECT |
| A / D, canonical controls | ACCEPT | ACCEPT | ACCEPT |
| C, non-canonical signature count | ACCEPT | ACCEPT | REJECT |
| B, non-canonical account count | ACCEPT | ACCEPT | ACCEPT |

These are observed outcomes of the **two-call adapter**, not universal library admission rules. Each version calls `getTransactionDecoder().decode(bytes)`, then `getCompiledTransactionMessageDecoder().decode(transaction.messageBytes)`. ACCEPT means both calls returned. It does not verify signatures, transaction validity, simulation, freshness, authorization or settlement. Input is limited to 4,096 decoded bytes as a UI bound, not a transaction admission policy. Use public or synthetic input only.

The version-3 synthetic example above is separate from Conformance's V03/V16 proposed-v1 (SIMD-0385) examples. The [Kit 8.4.0 V10 result](../../docs/hackathon/worldsfair-2026/THIRD_PARTY_DECODER_RESULTS.md#v10-interpretation) is also adapter-dependent; this page pins 3.0.3/4.0.0/8.3.0, not 8.4.0. Kit's trailing-byte tolerance is a documented maintainer-accepted tradeoff ([kit#1963](https://github.com/anza-xyz/kit/issues/1963)); impact unassessed.

## Pinned published bundles

All three production UMD bundles are copied unmodified. [decoder-vendor/manifest.json](decoder-vendor/manifest.json) gives their exact unpkg source URLs and SHA-256 hashes. Matching a digest establishes byte consistency with the pin, not publisher authentication or a security certification.

| File | SHA-256 |
| --- | --- |
| `kit-3.0.3.js` | `56778f4c15228ba6e2b2c3a0126e93562cd1681555232250ecc06c08847f9f72` |
| `kit-4.0.0.js` | `897742a5905e3d0b49e881c2ac2b94e4889292fe2b76be05fc0630f4248b6225` |
| `kit-8.3.0.js` | `bbf744562e1fd5ae6bc29b7ff6e07e11adb2174eadbe7f72d19a1fe992e16c95` |

With Node 22.18.0, from the repository root:

```sh
node --test apps/kit-compare/test.mjs
```

The tests verify all three bundle hashes and execute their actual decoder calls on the examples and malformed input. They are not a browser or security certification. No package install is required.

## Source and attribution

The comparison page and its three presentation files (`compare.html`, `_decoder-compare.js`, `_decoder-compare.css`, `_index-style.css`) are synchronized with the 11 October site correction. The worker, examples, logo, manifest, bundles and font assets retain their byte-for-byte source at commit `05f11778dbd57a5c67a95cf4b19871a3d1c9ea18`. Those four files are byte-identical to `apps/raven-site` at source commit `d5292174f84d32c66cb6c55809afe7bc96e3fbbc`. The comparison implementation first appears in that history at `a796a85d0e77ea8809e156c6104cbd51bcb1b73c`; this is a history statement, not proof of invention. Site styling, branding and fonts are reused foundations; Kit is third-party software, not Raven-authored. Each Kit version's MIT licence is retained in `decoder-vendor/LICENSE-*`; the Manrope and Barlow Condensed font licences are retained in `fonts/*-OFL.txt`. The existing [component provenance](../../docs/hackathon/worldsfair-2026/PROVENANCE_MANIFEST_V3.md) remains applicable to the other demonstrations.

Serving this folder does not deploy the comparison on the Conformance site's root configuration. No live-page/source identity, external audit, customer usage or release clearance follows from putting these files in the public repository.
