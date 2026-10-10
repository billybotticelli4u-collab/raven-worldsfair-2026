# Product demo — one recording draft, target 2:45

Not recorded or uploaded. This is the selected cut; no optional beat or alternate command. It combines Billy's Conformance → third-party table → Agent Trust sequence with CODEX's reviewed command and receipt/report distinctions. Confirm the live portal cap before recording; 2:45 is a target, not a measured video.

Prepare the actual Conformance page, the [structural results table](../THIRD_PARTY_DECODER_RESULTS.md#structural-results) and a recursive checkout with Node 22.18.0. Use `npm run demo` only. The command needs no install and is already present in the reviewed 1db786e6 parent; this local docs successor does not change it. Verify the hosted build information and rehearse both demos on the recording day.

| Time | Screen and exact action | Narration | Visible label |
| --- | --- | --- | --- |
| 0:00–0:15 | Hosted Conformance at https://raven-worldsfair-2026.vercel.app/ | Raven checks how Solana transaction readers handle tricky bytes, and lets an agent verify a signed receipt offline before it acts. Here are two demonstrations. | LIVE |
| 0:15–0:29 | Select **Solana transaction versions**, then **SOL_BROKEN_SUBTLE** | Thirty synthetic vectors, an experimental profile and a reader we deliberately broke. Online, Raven runs our demonstration readers; a customer's decoder needs a local adapter. | LIVE · Raven-owned reader |
| 0:29–0:42 | Click **Run Conformance (live)**; hold the result | Twenty-seven match; three differ. V03 and V16 are new version-one transactions. V10 has a non-canonical length. | LIVE · 30 rows · V03 / V10 / V16 |
| 0:42–0:58 | Inspect the first divergence and its expected/observed decisions | Raven names the row and the rule. The result compares this reader with this finite profile. It is not a security score. | LIVE · experimental profile |
| 0:58–1:11 | Select **SOL_CONFORMANT_REFERENCE**, run it | The reference matches all thirty. That is agreement with this profile, not proof of universal correctness. | LIVE · 30/30 |
| 1:11–1:25 | **Download & reproduce** → **Replay report** | Replay the report: bundle and semantics match. This Conformance report is unsigned. The guide also gives local reproduction commands. | LIVE · reports unsigned |
| 1:25–1:56 | Structural table, with exact versions and 13-row denominator visible | We also ran published decoders unmodified through local adapters. On thirteen structural rows: Kit eleven, web3.js twelve, solders eleven. These are not rankings. Fourteen other rows test policy limits, and three test adapter handling. Solders used a separate harness. | RETAINED RUN · 10 Oct · Kit 8.4.0 11/13 · web3.js 1.99.0 12/13 · solders 0.29.0 11/13 |
| 1:56–2:26 | Terminal: `npm run demo`; hold **Valid receipt: PROCEED**, **One-field tamper: REFUSE** | Agent Trust is separate and offline. A signed receipt passes the pinned verifier: proceed. Change one finding without signing again: refuse. Both are fixed fixtures at a fixed demo clock, not live Solana acquisition or permission to transact. | LOCAL · signed receipt fixture · liveAcquisition:false |
| 2:26–2:45 | Return to guide with public website and repository URLs | Try Conformance online, then reproduce Agent Trust locally. The verifier and receipt foundation predate the Fair. Reviews are internal and bounded. No customer or completed outside pilot is claimed. | Website + public repo · MATCH is not a safety verdict |

Narration: 229 words across the 2:45 target; leave pauses while the measured results appear. This is not a timed recording.

Show hosted runs at real speed. If a run errors, show the error and retry once; do not substitute a recorded success. Do not use the old **Load recorded BROKEN_SUBTLE report**: it is a different 12-row report, not corpus 1.4's 30 rows. The 13-row table is retained measured evidence, not a new live decoder run.

Do not insert Local saved-case Replay, Hosted saved-case Replay or Time Capsule into this cut. Do not call Conformance reports signed, certify SDK safety, claim a third-party bug, or imply customer uploads, authorization, settlement or current chain state. No standalone encoding finding is included. The [guide](../../../../JUDGE_START_HERE.md) retains the full workflow, review and source limitations.
