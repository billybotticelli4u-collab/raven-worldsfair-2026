# Submission reconciliation — source map and decisions

Public attribution uses stable role labels: contributor A (integration/packaging), contributor B (frontend/documentation and internal review), contributor C (decoder measurements/Linux operations), contributor D (recording/reconstruction), and reviewer E (backup/decoder review). These are AI-assisted internal contributors and reviews, not external audits. Role labels preserve author/reviewer separation; historical commits and sealed evidence remain unchanged. Private packet filenames are omitted here; retained hashes identify the exact records.

This is an editorial successor of `1db786e63766cc2671209331a555b0d9c58c3cbb`. Inputs are preserved; this checkout has one active file per deliverable. No input packet, verifier, fixture, lockfile or runtime is amended. This reconciliation is local, pending Glen's go-ahead.

## Input identities

Private packet records below are retained in the local delivery/review archive and identified by digest. Commit paths are immutable Git blobs. SHA-256 values identify the exact source bytes; they are not signatures or independent approval.

| ID | Source | SHA-256 |
| --- | --- | --- |
| B0 | Draft packet checksum manifest (private archive) | `dcffaf3bc185a10e7fb022c1109df438a1393e05a5e89885c0fb7c0e1847e7a1` |
| B1 | Earlier card draft (private archive) | `e31cca849160e6b72bd11f5288151e73ccf188119e05e7133a9990920bf74c48` |
| B2 | Earlier portal field draft (private archive) | `a38faf064f631b49d5c2c3d0897c62b969c07ee79f3c546ac901f0269b17125f` |
| B3 | Earlier product demo script (private archive) | `c962aabd59f100c87cedff0606dcc68f8a569fd1cacbaa986ab180f9694f678a` |
| B4 | Earlier founder pitch (private archive) | `571811df8634c8a4d19d49239092f8aefcf4ded904f79e6762b39052d6cd5c1f` |
| B5 | Unselected alternative demo-script bundle (private archive) | `94c9111aff1220804a86c16187a1e3ec4c069c50dafbd895025e668c9a4aca7f` |
| T1 | Decoder measurements summary (private archive) | `94d10801a02e848a9a10d53fedf1f438460dc2fbfda11c505d09219e907d6777` |
| T2 | Decoder measurements checksum manifest (private archive) | `4b2070e9134175e4b3feffbe5d12eb0a45569d6966ec7ae064c438180a864f3c` |
| K1 | Internal decoder-summary review (private archive) | `a5e15ba2eb3397d92768df531ca9a7f85a5ff8340e184793cd4f6cc150dacb8d` |
| C0 | Internal judge-guide review (private archive) | `5dddf7344385083a1202d5b9aaa2cf3358c27f7a55ed01b6e9b120ad6c355fd6` |
| R9 | Hosted-release draft paste set (private archive) | `74c5cc7c7449314258747230b5fddd78c9987335865b770e65703e06efaa248d` |
| C1 | `1db786e63766cc2671209331a555b0d9c58c3cbb:JUDGE_START_HERE.md` | `f35b2b9b80d1f497e895f46f554ebf756be3ff746f4e8e5e3c3f9f33df5fd6a1` |
| C2 | `1db786e63766cc2671209331a555b0d9c58c3cbb:README.md` | `05ebb2e0bf24df66865f8248f54b134f8c395a18d0fbf4d6937e9159f05f8b25` |
| C3 | `1db786e63766cc2671209331a555b0d9c58c3cbb:docs/hackathon/worldsfair-2026/submission/CARD-COPY.md` | `8b5da6c53d220b6c50617cd78b6a378bb0b5b4514bcf42894ef7d662e6b3dabf` |
| C4 | `1db786e63766cc2671209331a555b0d9c58c3cbb:docs/hackathon/worldsfair-2026/submission/PRODUCT-DEMO.md` | `519566057cb8d5ceb9ee9dcca79ca4ae03b03f76515ff2b721976fac7e2b7e22` |
| C5 | `1db786e63766cc2671209331a555b0d9c58c3cbb:docs/hackathon/worldsfair-2026/submission/FOUNDER-PITCH.md` | `94f548b547fd4bd7d3640bca0f6721ba5081fb81bf33396e2771f7ab792d6a79` |

## One selected demo command

Keep **`npm run demo` → `scripts/agent-trust-demo.mjs`**, with its existing five subprocess refusal tests. B5's contributor C branch `0f59aacd7ae06e2ae9e117bb42d72940fb5f0a80` is based on `1c2637d8` and is not cherry-picked. Its shell script and alternate npm entry remain in the sealed input packet; they are not included in this successor.

The retained command invokes the real pinned verifier on both fixtures and checks both outcomes before printing the success pair. C0 independently rebuilt the parent, ran 43/43 Agent Trust tests and four real fixture/verifier sabotages; every sabotage exited non-zero with empty stdout. Retaining it avoids a second wrapper and a second output format. contributor C's implementation also checks both outcomes, but routes them through shell output matching and an environment-selectable executable; it would require its own adoption review. This decision is source comparison, **not a non-author PASS on contributor C's unselected script**. No second `demo.sh` or alternate command is added.

This reconciliation leaves the script, package.json, its tests, app source and submodule byte-identical to C0's reviewed subject. C0 does not approve the newly merged submission text.

## What each output takes from each source

| Output | Retained source and editorial change |
| --- | --- |
| Judge guide | C1's first screen, one-sentence pitch, exact outputs, fixed-clock and unsigned-report limits retained. T1's structural counts adopted, confirmed in K1; the headline excludes raw totals and the separate encoding follow-up. Corpus 1.4 is 30 vectors. Legitimate 27-matching-row results and historical provenance are not converted into a false 30/30 broken-reader result. |
| Card / portal A2 | C3's concrete two-demo pitch and receipt/report distinction, B1/B2's structural-row evidence. The reviewed successor uses contributor B's exact 495-character replacement byte-for-byte in the card and A2. Exact decoder versions included. |
| Portal A4 | B2's reader/profile/result flow and audience; C1/C3's fixed signed receipt, deterministic clock and no-authorization limits. The claim that v1 is live on Solana is not carried: the measured corpus interpretation remains experimental. No new network-history claim is substituted. |
| Portal A5/A6/A8 | R9's motivation, technologies and separate workflow disclosures, updated to match the primary two demos. Conformance does not verify signatures; the separate Agent Trust fixture does. Hosted saved-case Replay facts remain provider-reported and its source access is not hosted readiness. |
| Portal A14 | B2 and C2/C3: receipt verifier, trust anchors, hosted verifier, BONK fixture and raven-site are pre-Fair; Fair orchestration and Conformance are attributed separately. Internal bounded reviews are not external audits. |
| Portal B3/B7 and links | B1/B2's corrected public repository and no-login access; C1's single command and exact outputs. Old 2cb12875-as-current-main claims are removed. contributor B's recorded hosted assertion 1db786e6 and the older 2cb12875 Conformance reproduction pin are distinguished in the guide; Conformance code alone is byte-identical, and 1db786e6 contains the convenience command. No claim this unpushed successor is on public main. |
| Product demo | B3's 2:45 sequence: hosted Conformance → structural table → Agent Trust. C4's pitch, exact retained output, signed/unsigned, fixed fixture, pre-Fair and no-customer wording. Drops B3's fallback command and optional follow-up beat. Changes “recorded transactions” to synthetic vectors and removes the unsupported story that the demo reader predates v1. |
| Founder pitch | B4's engineer/one-ticket framing, plain problem statement and ask for three teams; C5's signed fixture, fixed clock, pre-Fair foundation, no live acquisition/permission, unsigned Conformance and no outside pilot claims. Unconfirmed personal biography and “every miss has a known cause” are not turned into new claims. One script, with a 2:00 target rather than a promised measured duration. |

The former `CARD-COPY.md`, `PRODUCT-DEMO.md` and `FOUNDER-PITCH.md` drafts are replaced by the named canonical files. Their old contents remain in Git history. Input packets remain read-only. Alternative A4/F1 copy and optional recording variants in contributor C's packet are not active outputs.

## Limits carried into the selected set

- Finite 30-vector, synthetic, experimental profile; not universal parser correctness or a safety score.
- The three demo differences are V03/V16 proposed v1 (SIMD-0385) scope differences and V10 non-canonical length. V10 does not isolate the separately recorded current-decoder length behavior.
- Structural denominator 13 only; fourteen sanitize/policy and three adapter-prelude rows have different responsibilities. Exact published versions and API named; solders used a separate harness. Counts are not SDK quality rankings.
- K1 is confirmation against retained evidence, not independent decoder execution. The separate follow-up is absent from the headline, card, portal, demo and pitch. Original measured evidence remains preserved below the technical results page; no security impact or upstream novelty is claimed.
- Conformance and saved-case Replay reports unsigned. Agent Trust's receipt signed, with one finding changed and no new signature for the tamper.
- Deterministic fixture and fixed evaluation clock, `liveAcquisition:false`; PROCEED is not authorization, settlement or proof of current token state.
- Hosted Conformance runs Raven-owned readers; user-supplied decoders need a local adapter and scoped evaluation.
- Local saved-case Replay cannot save v1; Hosted saved-case Replay is a separate app on an unmerged source branch with provisioning, deployment-identity and distribution limits. Conformance's Replay report does not accept that app.
- Pre-Fair foundations stay attributed; internal bounded reviews are not external audits or contest eligibility.
- No paying customer, completed outside pilot, final media readiness or portal submission is claimed. No real customer bytes are added.
- Live portal labels, current hosted identity, decoder execution and final media were not rechecked by this local editorial change. Glen must approve the set before publication/submission; media still needs recording and verified URLs.

## Review state

The parent demo's C0 review and T1 summary's K1 review retain exactly their old scopes. This merged editorial successor has not received a new non-author review. Repeated command/tests from a fresh local clone are author verification, recorded in its sealed delivery packet. No push, portal edit, upload, signing or publication occurs here.

## Docs-only review correction on d19ded96

The append-only Git successor is based on `d19ded963a748a21c15ab7cd08f8b545d9f47fd1`; that commit and all sealed packets remain intact. The initial editorial history above is retained, with the active copy corrected as follows.

| Review input | SHA-256 | Applied change |
| --- | --- | --- |
| contributor B (private archive record; identified by the adjacent hash) | `7e938d401ccbe81e4053587edd074a1ba60ab63acfa318a0db00ec51820eccc0` | 4a: Agent Trust-only command table and exact note. 4b: exact hosted-build/reproduction replacements, no two-docs-only claim. 6: proposed-v1 label, scoped broken-reader wording and exact 495-character card/A2. 7: Disclosures heading. Version/exit spacing corrected. |
| reviewer E (private archive record; identified by the adjacent hash) | `b73be56f3a00c25dfb81d08fc78ab5a2ebc2757b76069be03795d73c9e2e34fb` | V10 modern/legacy split is web3.js-only; Kit 4.0.0 and the transaction-decoder-only Kit 8.4.0 adapter accept V10. Kit trailing-byte tolerance is a documented maintainer-accepted tradeoff (kit#1963). Impact unassessed; no SDK defect/security claim. |
| contributor C (private archive record; identified by the adjacent hash) | `5a4e14cb93a6ec52a7287a32cd6f9cc02ab41ef40edd0977d3fd0a1b917a7f73` | Author evidence, now independently confirmed by reviewer E in the confirmation record below. Kit 8.4.0 V10 result is adapter-dependent: two-call adapter rejects (#8078001), transaction-decoder-only accepts; the 16/30 vs 15/30 row is V10. No change to raw retained evidence. |
| reviewer E (private archive record; identified by the adjacent hash) | `ac43c83e3fe7a9d869374e03e7af84274e2cfdf875443d7a1ecdc24fb9590655` | Independent row-by-row reproduction of both verbatim adapters confirms V10 as the single differing row and adapter composition as its cause. Scope and local review path below. |

reviewer E's later execution does not supersede contributor C's raw evidence files: Kit's 15/30 versus retained 16/30 is explained: the one row is V10 and comes from adapter composition (contributor C kit-delta reconciliation, 10 Oct), not a different Kit, and the derived row mappings differ at V17/V19 despite the same structural totals. The technical results page discloses both. The selected card uses contributor B's exact text; the surrounding scope identifies the unsigned reports as Conformance reports and the signed receipt as Agent Trust's fixture. No separate encoding finding is promoted into the headline.

Only documentation changes. The single demo command, every runtime blob, submodule, fixture, lockfile, retained decoder table and JSON are unchanged from d19ded96. Fresh-clone command/link/field checks are author verification, not contributor B's re-review. The successor is stopped for Glen; contributor B must re-review the new exact identity.


## Final C-1/C-2 correction on 972b8b2

contributor B's R2 review `dc9a1709efc1ac6887bbea22d27e0ab3daaeee7f46dbd9acbf53b322166a9265` requests these wording corrections only. contributor C reproduced both adapter compositions and identified V10 as their only differing row. reviewer E subsequently independently reproduced both verbatim adapters row by row and confirmed the single-row V10 delta from adapter composition, within the scope recorded below. The displayed Kit 8.4.0 11/13 remains contributor C's retained two-call-adapter result under his mapping. Kit 4.0.0 accepts V10, and the legacy/modern API split remains web3.js-only. Neither Kit 8.4.0 outcome demonstrates length-minimality enforcement.

All prior commits and sealed packets are preserved. The card, field values, runtime and retained raw evidence are unchanged from 972b8b2. contributor B rechecks C-1/C-2 on the new exact successor; local-only, stopped for Glen.

## Kit V10 independent confirmation

reviewer E's review at (private archive record; identified by the adjacent hash) (SHA-256 `ac43c83e3fe7a9d869374e03e7af84274e2cfdf875443d7a1ecdc24fb9590655`) confirms contributor C's Kit delta claim. On Node 22.18.0, macOS arm64, reviewer E independently reproduced both verbatim adapters row by row, including reason strings: zero differences from each retained 30-row report. The two adapters differ only at V10; the other 29 rows agree. The two-call adapter rejects V10 on the compiled-message layout error (#8078001), while the transaction-decoder-only adapter accepts it as a v1 envelope. reviewer E also verified the two versus one decoder calls in the bundle sources, confirming adapter composition as the cause.

This confirmation covers the two verbatim adapters, not the five rebuilt diagnostic variants or every decoder/API. Environment-bound report digests differ across platforms even though the per-row content reproduces. The displayed structural scores and the V17/V19 mapping disclosure are unchanged. Kit's trailing-byte tolerance remains a documented maintainer-accepted tradeoff (kit#1963); impact unassessed. contributor A verified the review hash and seal for this documentation update and did not rerun decoders. contributor B's pending documentation tick covers the SHA-free build-info commit `bc10ab12` plus this append-only confirmation update; no push or publication is authorized here.
