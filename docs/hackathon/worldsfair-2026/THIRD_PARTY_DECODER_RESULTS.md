# Third-party decoder measurements — 10 October 2026

On the **13 structural rows** of Raven's 30-vector experimental corpus, unmodified published decoders matched as follows: Kit 8.4.0 and 8.3.0 each 11/13; Kit 4.0.0 9/13; Kit 3.0.3 8/13; web3.js 1.99.0 (`VersionedTransaction.deserialize`) 12/13; solders 0.29.0 11/13. The Node adapters ran in Raven's official sandboxed runner; solders used a separate harness. These are not quality rankings: three other rows test adapter JSON/base64 handling and fourteen test sanitize/policy rules the decoders do not claim to enforce. Older Kit versions can score higher overall merely by refusing every v1 transaction. Structural differences concern unsupported v1 layouts, a version check fixed in Kit 4.0.0, and trailing-byte tolerance. A separate standalone check showed Kit 3.0.3, 4.0.0, 8.3.0 and 8.4.0, and web3.js 1.99.0 accepting a non-minimal account-count encoding (`82 00` for 2), while solders rejected it. Impact is unassessed. V10 hints at this only on older versions; **no current corpus row isolates that behavior**. Both valid v1 vectors were made with Kit 8.3.0 and accepted by web3.js and solders, supporting rather than proving the experimental layout.

## What was counted

| Category | Rows | Meaning |
| --- | --- | --- |
| Structural | 13 | Version detection, envelope, truncation, v1 layout, exact byte consumption |
| Sanitize/policy | 14 | Size/count caps, duplicate accounts, header consistency, heap bounds; not claims made by these decoders |
| Adapter prelude | 3 | JSON/base64 handling performed by Raven's adapter |

Full retained rows: [RESULTS_TABLE.md](third-party-decoders/RESULTS_TABLE.md). Machine-readable summary: [results-summary.json](third-party-decoders/results-summary.json). The secondary web3.js legacy-only `Transaction.from` API is listed separately; its results are not the versioned API's results. The [original Billy summary](third-party-decoders/JUDGE_SUMMARY.original.md) retains the complete explanation, including raw totals. Raw totals are not a decoder ranking.

## V10 and the separate non-minimal-length finding

V10 places `81 00` at the transaction's first byte (signature count). Older envelope readers can accept it as legacy. Current Kit 8.x and web3.js VersionedTransaction treat the first byte as a v1 marker and refuse it for another reason. Therefore a V10 match does not prove minimal-length validation.

Standalone **case B** places `82 00` in the account-count field, away from the first byte, instead of canonical `02`. Kit 3.0.3, 4.0.0, 8.3.0, 8.4.0 and web3.js 1.99.0 accept it; solders 0.29.0 refuses it as non-canonical. Canonical cases A/D are positive controls. The [JavaScript input bytes and outputs](third-party-decoders/repro_js.out.json) and [Python/solders outputs](third-party-decoders/repro_solders.out.json) are retained verbatim. This is a measured parse difference, not an exploit or security-impact claim. No new upstream issue was filed by this work. Whether upstream has another report was not independently researched here.

## Evidence and review scope

Billy 1 authored and executed the decoder campaign on Node 22.18.0. Its sealed packet manifest is `4b2070e9134175e4b3feffbe5d12eb0a45569d6966ec7ae064c438180a864f3c`. The corpus is 1.4 at reproduction pin `2cb12875b2a0f65b8a59999ffa33807e35a81e43`; it is synthetic and Raven-authored.

KIMI independently verified the seal and rederived the category split and structural counts from the retained rows, with a bounded summary PASS (review SHA-256 `a5e15ba2eb3397d92768df531ca9a7f85a5ff8340e184793cd4f6cc150dacb8d`). KIMI did not rerun the adapters or report replay; this is independent confirmation of the summary, not independent execution acceptance. CODEX copied the public evidence files unchanged. SIMD-0385's v1 layout remains experimental in this corpus; acceptance by two other decoders supports, rather than proves, the interpretation. No customer or outside pilot is claimed.
