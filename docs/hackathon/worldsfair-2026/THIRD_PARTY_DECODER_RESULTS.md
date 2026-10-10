# Third-party decoder measurements — 10 October 2026

On the **13 structural rows** of Raven's 30-vector experimental corpus, unmodified published decoders matched as follows: Kit 8.4.0 and 8.3.0 each 11/13; Kit 4.0.0 9/13; Kit 3.0.3 8/13; web3.js 1.99.0 (`VersionedTransaction.deserialize`) 12/13; solders 0.29.0 11/13. The Node adapters ran in Raven's official sandboxed runner; solders used a separate harness.

These are not quality rankings. Three other rows test adapter JSON/base64 handling; fourteen test sanitize/policy rules these decoders do not claim to enforce. The corpus is synthetic and its v1 interpretation experimental; agreement by other decoders supports rather than proves that interpretation. These headline scores are Billy's retained measurements. KIMI initially checked that summary without rerunning the decoders; its later independent reconciliation is partly confirmed, with a one-row Kit discrepancy and a different derived structural mapping, detailed below.

## Structural results

| Decoder and exact API | Matches / structural rows |
| --- | --- |
| @solana/kit 8.4.0 | 11/13 |
| @solana/kit 8.3.0 | 11/13 |
| @solana/kit 4.0.0 | 9/13 |
| @solana/kit 3.0.3 | 8/13 |
| @solana/web3.js 1.99.0 `VersionedTransaction.deserialize` | 12/13 |
| solders 0.29.0 `VersionedTransaction.from_bytes`, separate harness | 11/13 |

These are matches to Raven's stated profile, not a decoder ranking or security verdict. This is retained campaign evidence, not a newly executed comparison.

## What was counted

| Category | Rows | Meaning |
| --- | --- | --- |
| Structural | 13 | Version detection, envelope, truncation, v1 layout, exact byte consumption |
| Sanitize/policy | 14 | Size/count caps, duplicate accounts, header consistency, heap bounds; not claims made by these decoders |
| Adapter prelude | 3 | JSON/base64 handling performed by Raven's adapter |

Full retained rows: [RESULTS_TABLE.md](third-party-decoders/RESULTS_TABLE.md). Machine-readable summary: [results-summary.json](third-party-decoders/results-summary.json). The secondary web3.js legacy-only `Transaction.from` API is listed separately; its results are not the versioned API's results. The [original Billy summary](third-party-decoders/JUDGE_SUMMARY.original.md) retains the complete explanation, including raw totals. Raw totals are not a decoder ranking.

## V10 interpretation

V10 places `81 00` at the transaction's first byte (signature count). KIMI's independent per-API checks found web3.js 1.99.0 `VersionedTransaction.deserialize` **REJECT**, on the v1 config-mask check rather than length minimality, while its legacy `Transaction.from` **ACCEPTS**. That modern/legacy split applies to web3.js only; an 'older versions only' description does not apply to Kit. Kit 4.0.0 and 8.4.0 both **ACCEPT** V10 (8.4.0 attributes it as v1). solders 0.29.0 **REJECTS** the non-canonical length. A V10 match therefore does not prove minimal-length validation, and none of these observations certifies an API as safe.

The retained Billy table reports Kit 8.4.0 rejecting V10, whereas KIMI's later direct and official-runner checks accept it. Both records are preserved; they are not represented as identical executions. Impact unassessed.

### Separate retained reproducer — outside the submission summary

Standalone **case B** places `82 00` in the account-count field, away from the first byte, instead of canonical `02`. Kit 3.0.3, 4.0.0, 8.3.0, 8.4.0 and web3.js 1.99.0 accept it; solders 0.29.0 refuses it as non-canonical. Canonical cases A/D are positive controls. The [JavaScript input bytes and outputs](third-party-decoders/repro_js.out.json) and [Python/solders outputs](third-party-decoders/repro_solders.out.json) are retained verbatim. This is a measured parse difference, not an exploit or security-impact claim. No new upstream issue was filed by this work. KIMI's later search found no prior report for the non-minimal-length behavior within its stated search scope; that is not proof of novelty. Impact unassessed.

## Evidence and review scope

Billy 1 authored and executed the decoder campaign on Node 22.18.0. Its sealed packet manifest is `4b2070e9134175e4b3feffbe5d12eb0a45569d6966ec7ae064c438180a864f3c`. The corpus is 1.4 at reproduction pin `2cb12875b2a0f65b8a59999ffa33807e35a81e43`; it is synthetic and Raven-authored.

KIMI independently verified the seal and rederived the category split and structural counts from the retained rows, with a bounded summary PASS (review SHA-256 `a5e15ba2eb3397d92768df531ca9a7f85a5ff8340e184793cd4f6cc150dacb8d`). KIMI did not rerun the adapters or report replay; this is independent confirmation of the summary, not independent execution acceptance. CODEX copied the public evidence files unchanged. SIMD-0385's v1 layout remains experimental in this corpus; acceptance by two other decoders supports, rather than proves, the interpretation. No customer or outside pilot is claimed.

## Later independent reconciliation — partly confirmed

KIMI's 10 October reconciliation (review SHA-256 `b73be56f3a00c25dfb81d08fc78ab5a2ebc2757b76069be03795d73c9e2e34fb`) freshly installed the named decoders, checked separate APIs and used Raven's official runner in scratch. CODEX did not rerun those decoder measurements in this documentation successor.

- web3.js 1.99.0 deserialize-only: 17/30, matching Billy's retained total. A fallback to legacy `Transaction.from` changes V10 and V19 and explains the other adapter's 15/30.
- Kit 8.4.0: KIMI measured 15/30; Billy retained 16/30. One row remains unresolved. The displayed structural headline is retained evidence, not a claim that the two runs have identical rows.
- The 13 structural / 14 sanitize-policy / 3 prelude split is a derived taxonomy, not named corpus metadata. Billy's retained structural set includes V17 and excludes V19; KIMI's mapping instead includes V19 and puts V17 in sanitize-policy. Both yield Kit 11/13 and web3.js 12/13 in their own reported mappings; equal totals do not prove equal coverage.
- KIMI did not repeat the full solders corpus, Kit 3.0.3/8.3.0 full runs or a standalone web3.js legacy-only full run. Their retained totals are not independently executed acceptance from that review.

Kit's V07 trailing-byte tolerance is a **documented maintainer-accepted tradeoff**, tracked in [kit#1963](https://github.com/anza-xyz/kit/issues/1963); it is not a novel discovery. KIMI's reconciliation records that upstream disposition. These are differences against Raven's experimental decode/admit profile, not a demonstrated SDK security defect. **Impact unassessed.** No SDK safety, exploit, vulnerability, customer impact or universal correctness is established.
