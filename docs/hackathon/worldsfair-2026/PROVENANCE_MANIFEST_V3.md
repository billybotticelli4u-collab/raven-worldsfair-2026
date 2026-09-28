# Raven combined-candidate provenance manifest V3

Date: 2026-09-28

Class: **AUTHOR-SIDE DOCUMENTATION SUCCESSOR — NON-AUTHOR REVIEW REQUIRED**

This document describes the documentation successor whose parent is the
SDK-licence successor `d93cab02…` and whose grandparent is the preserved combined
candidate `4be5ff78…`. It corrects the attribution scope in the root README and
supersedes the older public-exposure labels only for this local successor. It
does not alter either ancestor, grant publication authority or transfer any
review verdict to new bytes.

## Exact lineage and bound evidence

- Parent HEAD `d93cab02758ee8a0b0f92accb0cfe78c37b6497b`, TREE
  `22dcc1eb62664340326c4a52eea02cb02a926cdf`; licence-successor bundle
  SHA-256 `697ef5a348132cbc7e2974ef7499cdc2ee1b939895782213dd107f4dbb63edf4`.
- Grandparent HEAD `4be5ff7858b6636108a219f2c4e94a989c08d79e`, TREE
  `30471bbd366d726102446ce3240e4b941e292439`; frozen-base bundle SHA-256
  `9db5e65d92b7e663c808ef9a10e3c1bbba45e316d09f933779a24d346481439d`.
- Combined-candidate review SHA-256
  `f2f48e8f0b5be969a927768dee75047e587a752f1ae51da52432f92794c1ad5a`.
- Billy 1 Linux freeze-packet tarball SHA-256
  `9cde5f3bdc9dad56a40cf5b91cd43f10fbfde697cfedaf558f299463432c8979`.
- Owner SDK-rights statement SHA-256
  `d2b4f0e0551ae615b4cad77c76a79963c2e0ccac6acbbf69cd75158b46b00d78`.

The candidate is local and unpublished. Public/live remains
`10326982e445bdb7b56776039cd3d9028f776747`, with the 12-vector Solana
slice. Freeze means preserve and assess; it does not mean merge, deploy,
publish or submit.

## Component attribution

| Component | Pre-existing foundation | Fair-era work in this candidate | Evidence and confidence |
| --- | --- | --- | --- |
| `apps/worldsfair-agent-trust` | Raven receipt-v1 verifier lineage, production trust anchor and BONK receipt content predate the Fair. The receipt-verifier is linked as submodule pin `1b04356a275742752fb7afd8dfcc4269d462a778`. | Agent A/B orchestration, `raven-agent-trust/1`, fail-closed PROCEED/REFUSE, Fair UI, About/Build Info and tests. | High for app code from bundle history. The BONK fixture carries pre-existing JSON content and must not be labelled wholly `FAIR_NEW`. |
| `apps/raven-conformance` | Research lineage and private corpora are referenced, not copied. The Solana targets are unchanged bytes from `apps/raven-solana-demo` at source demo HEAD `08889b69798ad69a719a2634cabbebb0eb82c5fe`, first committed during the Fair at `7df934b` on 2026-09-16. Fixture-generation claims are inherited and were not regenerated in this lane. | Runner, bounded execution, taxonomy, probes, replay, UI, profiles and corpora. The candidate raises the Solana corpus from 12 to 27 rows: 26 source rows plus one exact-key control. | High for bytes present in this history. "First appears in this history" is a repository-history statement, not a claim of invention. Exact component tree at `4be5ff78…`: `71a6c9ee71448bc66af50f4008f286145d484c61`. |
| `apps/raven-replay` excluding its nested SDK | `vendor/solana-inspector.mjs` is an unchanged copy of Raven's reference target from `a5c78f8a225c70f28661be600ea26af68c0cb0eb`; it is byte-identical to the Fair-era Conformance reference target. | Saved-case server, launcher, cleanup guard, browser UI and tests. | Medium because the included history begins with one import commit. Exact component tree at `4be5ff78…`: `88c58b8aa1400f4b0371a5e1fa502385c833a991`. |
| Nested parser SDK | No byte-identical SDK source was found in the pre-Fair baseline. Its dependency and runtime lineage are listed below. | Adapter registry, runner, bindings, CLI and tests; `d93cab02…` adds Apache-2.0 metadata and an SDK-local LICENSE. | Medium because the included history does not reproduce the stated upstream Replay commit. SDK origin HEAD `dbcee545f0ee22549d13faf622e86b5e52e73e65`, TREE `1e7b5835…`. |
| `apps/raven-site` | 166 files match the pre-Fair baseline at the same path, and one further file matches by content at another path. Site history begins 2026-06-04 with "Launch Console v1"; its last pre-Fair change was 2026-09-13 11:01. | 22 files under `worldsfair/` plus the changed Vercel configuration. | High from the measured blob ledger. Do not count the whole site as Fair-built. |
| `vendor/raven-receipt-verifier` | Pre-existing Raven foundation, linked rather than copied; Apache-2.0 upstream at pin `1b04356a275742752fb7afd8dfcc4269d462a778`. | No new implementation claimed here. | High for classification; the submodule was not materialized in the Linux packet. |
| Root judge docs, scripts, tests, API adapter and CI support | None claimed as pre-existing in the measured blob comparison. | Fair-era packaging, judge workflow, integration bindings and review support. | High within the included bundle history. |

At `4be5ff78…`, the packet contains 562 tracked blobs. Of those, 167 are
byte-proven pre-existing in `apps/raven-site`; one additional Fair-era file,
the BONK fixture, carries pre-existing JSON content; and the receipt verifier
is a pre-existing linked submodule. "Everything else first appears in this
bundle history during the Fair" is a repository-history statement, not proof
of original invention.

## Replay and SDK history boundary

`apps/raven-replay` enters this repository as one import commit, `b493313`
(2026-09-25 11:50 CEST). It contains 113 files at `4be5ff78…`, including the
38-file SDK, and 114 files at `d93cab02…`, including the 39-file SDK after the
SDK-local LICENSE was added. The reconstructed base is local commit
`cce9acaa49bfbd672930fa0c79b715e279a94d56`, tree `fa14dadc…`. The stated
upstream commit `c7ffd6f94ef38b6b537088b34353fc5b0490e0ce` is **not reproduced** in
this history. Dates before 2026-09-25 rest on in-tree documents.

The pre-Fair monorepo contains a different product,
`apps/raven-solana-replay`: a Solana mint-fixture replay harness first
committed 2026-05-18. It shares no bytes with `apps/raven-replay` and is not
in this repository. The history limitation applies only to the new Replay and
its SDK; `raven-solana-replay` is outside this candidate.

## Third-party and separately obtained software

- `@solana/kit` 8.3.0 is MIT, copyright 2023 Solana Labs, Inc. It is not
  bundled. `npm ci` resolves 47 packages, all recorded as MIT in the SDK
  lockfile.
- The Conformance lockfile declares `@solana/web3.js` and its dependency tree.
  They are not bundled and are not needed by the tests or judge flow; only the
  `receipt:anchor` and `receipt:verify` CLIs import them. Licence fields in that
  lockfile count as 44 MIT, 3 BSD-3-Clause, 2 Apache-2.0, 1 ISC, 1 0BSD,
  1 BSD-2-Clause and **1 LGPL-3.0-only (`rpc-websockets`)**. Two packages,
  `eyes` and `text-encoding-utf-8`, have no licence field in the lockfile; no
  licence is asserted here for them.
- Node.js 22.18.0 is obtained separately and is not bundled.
- The receipt-verifier submodule is Apache-2.0 upstream at pin
  `1b04356a275742752fb7afd8dfcc4269d462a778`.

## BONK attribution erratum

The historical `EXPORTED_FILE_MANIFEST.md` and both
`PUBLIC_EXPOSURE_MANIFEST` files remain unchanged because they are records
bound to Day-2 `a5cd592b…`. For this successor, this V3 document supersedes
their labels as follows:

| Fair-era path | Corrected attribution |
| --- | --- |
| `apps/worldsfair-agent-trust/fixtures/bonk-valid-receipt.json` | Pre-existing content in a Fair-era file. It is JSON-equal to `apps/launchguard-acp/fixtures/receipt-v1/production-receipt-v1-bonk-2026-07-03.json` in pre-Fair baseline `18b1a13`. |
| `apps/worldsfair-agent-trust/fixtures/bonk-tampered-receipt.json` | Fair-era fixture differing from that pre-existing content at one field, `/findings/0/code`. |
| `apps/worldsfair-agent-trust/fixtures/bonk-wrong-subject-claim.json` | Fair-era fixture whose derivation was not measured. |

## Authorship and review separation

- Combined candidate and packaging: CODEX author; Claude non-author review,
  bounded to Darwin/local/unpublished evidence.
- Replay browser UI: Claude author; CODEX performed a bounded frontend review
  on the preserved UI bytes.
- Solana repair `9f6aaf77020ebc7d56c0ff272f157320d156ccd2`: CODEX author; Claude reviewed
  it unchanged inside the combined candidate.
- Freeze packet/Linux measurements: Billy 1 operator and packet author; not
  an independent product-acceptance reviewer.
- Local recording: Billy 2 operator; not an acceptance review.
- Claude authored the Replay browser UI, so Claude's review of this
  documentation commit is non-author for these docs but touches text about
  Claude's own work.
- Claude authored submission-copy REV2 and REV3.
- KIMI's licence verdict on `d93cab02…` and Claude's verdict on this
  documentation successor are separate scopes. Neither approves the combined
  release.
- Four Claude PASS lanes are four scopes from one reviewer, not four
  independent reviewers.

## Licence state

- Root `LICENSE` SHA-256
  `53f50c6af11f9a1ae5ff24eada09ba31568de449839690f0704c4988f9c7f9a9`
  is Apache License 2.0 text for the Fair surface.
- The exact Owner statement exists in four byte-identical relay copies at
  SHA-256 `d2b4f0e0551ae615b4cad77c76a79963c2e0ccac6acbbf69cd75158b46b00d78`
  and selects Apache-2.0 option (a).
- Parent `d93cab02…` carries Apache-2.0 in the nested SDK package metadata and
  an SDK-local LICENSE byte-identical to the root LICENSE. KIMI's changed-scope
  review of those four changed paths is pending.
- Preserved `4be5ff78…` still declares the nested SDK `UNLICENSED`; it has not
  been modified.
- No whole-tree "wholly open source" claim is valid until the KIMI review
  returns PASS on the exact `d93cab02…` identity and the remaining third-party
  and history limitations are kept visible.

## Test-count attribution

The Conformance Darwin run registers 217 tests (211 pass, 6 skip); the Linux
run registers 214 (212 pass, 2 skip). The extra three Darwin tests are the
subtests of `N1 real Seatbelt` at
`apps/raven-conformance/test/disclosure-regressions.test.js:25`. They register
only when that Darwin-only test runs. Claude reproduced the Darwin count on
2026-09-28 with Node 22.18.0 and name-diffed it against the Linux transcript;
exactly those three names differ.

## Known open checksum defect inherited from `d93cab02…`

`apps/raven-replay/SHA256SUMS.txt` lines 98–99 still pin the pre-licence SDK
`package-lock.json` and `package.json`. The documented judge command in
`JUDGE_START_HERE.md` line 18,
`cd apps/raven-replay && shasum -a 256 -c SHA256SUMS.txt`, exits 1 with those
two entries reported `FAILED` on `d93cab02…`; it exited 0 with 112/112 entries
on `4be5ff78…`. This documentation-only successor intentionally carries the
same two failures. Fixing the checksum manifest is outside this commit's
authorized scope and requires a separately authorized successor.

## Claim limits

- Reports are unsigned. A digest checks byte consistency; it does not
  authenticate a publisher.
- `MATCH` means a saved expectation reproduced under the bound inputs. It is
  not transaction safety, authorization, confirmation or proof of an on-chain
  event.
- `CONFORMANT` means the target matched the claimed profile on the measured
  corpus. It is not a safety score, audit or certification.
- Fixtures are synthetic and offline. No signatures, account state,
  simulation, RPC acquisition or on-chain checks are established by these
  cases.
- The bounded runner is not an OS/kernel sandbox and does not restrict network.
- The live site serves the 12-vector public Solana slice. The 27-row corpus and
  Replay browser remain local and unpublished.
- Linux package measurements do not establish the unrun Linux browser harness,
  KIMI stranger test, Windows behavior or deployment behavior.

No push, PR mutation, merge, deploy, publication, repository-visibility
change, outreach, upload, form submission or paid action is authorized by this
document.
