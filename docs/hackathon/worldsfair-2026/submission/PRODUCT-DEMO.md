# Product demo — recording draft, target 1:58

Not recorded or uploaded by this change. Two demonstrations, with the same names, outputs and limits as the guide. Use the actual screens; do not replace an error with a prerecorded success. On the recording day verify the hosted build information and rehearse both flows once. Keep the visible disclosure of pre-existing verifier/fixture versus Fair work.

| Time | Screen/action | Narration |
| --- | --- | --- |
| 0:00–0:16 | Hosted Conformance, top of page | Raven checks how Solana transaction readers handle tricky bytes, and lets an agent verify a signed receipt offline before it acts. Here are the two demonstrations. |
| 0:16–0:39 | Select Solana transaction versions, SOL_BROKEN_SUBTLE; Run Conformance (live) | These thirty synthetic rows test a stated experimental profile. This is our deliberately broken reader: twenty-seven match and three differ. V03 and V16 are new version-one transactions. V10 has a non-canonical length. |
| 0:39–0:55 | Inspect V03 or V16 and the expected/observed decisions | Raven names the differing row and rule. This result is about agreement with this profile. It is not a security score. |
| 0:55–1:14 | Run SOL_CONFORMANT_REFERENCE; Replay report | The reference matches all thirty. Replay the report: bundle and semantics match. This Conformance report is unsigned. |
| 1:14–1:43 | Terminal at a recursive checkout, run `npm run demo`; hold both output lines | Agent Trust is a separate offline fixture. Agent A verifies a signed receipt using the pinned verifier: PROCEED. Change one finding code without a new signature: REFUSE. The command checks both outcomes before printing this pair. No live chain fetch happens here. |
| 1:43–1:58 | Return to guide and public repo link | Try Conformance online, then reproduce Agent Trust locally. Our hosted page runs our readers. Your decoder requires a local adapter. A match is not a safety verdict. |

Do not insert the separate saved-case Replay or Time Capsule into this cut: they add another story and do not demonstrate the signed receipt shown here. Third-party decoder measurements belong in the guide's measured-results section; do not turn raw scores into a ranking. This draft does not assert final media readiness or compliance with a portal field that has not been rechecked.
