# Canonical submission set — Raven

Aligned with the [current public project card](https://colosseum.com/arena/projects/raven), 11 October 2026. This is the current routing guide; it does not claim the contest submission is final or that videos have been recorded.

| Field | Current value |
| --- | --- |
| Project name | **Raven** |
| Website | https://ravenattest.com/ |
| First demonstration | [Compare real Kit versions](https://ravenattest.com/compare.html) |
| Judge walkthrough | https://ravenattest.com/judge-guide.html |
| Public source | https://github.com/billybotticelli4u-collab/raven-worldsfair-2026 |
| Reproduction guide | [JUDGE_START_HERE.md](../../../../JUDGE_START_HERE.md) |

## Judge order

1. **Compare real Kit versions.** Run the same synthetic bytes through the unmodified published Kit 3.0.3, 4.0.0 and 8.3.0 builds in the browser. The default version-3 example is accepted by 3.0.3 and rejected by 4.0.0 and 8.3.0 through the stated two-call adapter. A disagreement is evidence to investigate, not a bug or safety verdict; the downloaded report is unsigned.
2. **Conformance.** The [hosted 30-vector demonstration](https://raven-worldsfair-2026.vercel.app/) compares Raven-owned reference and intentionally broken readers, then replays the unsigned report. It is a bounded synthetic experimental profile, not a test of arbitrary third-party libraries.
3. **Agent Trust.** Run `npm run demo` locally. The pinned verifier prints `Valid receipt: PROCEED` and `One-field tamper: REFUSE`. This uses a fixed signed fixture and evaluation clock, not live acquisition or permission to act. Optionally, `npm run demo:live-local` runs a live exchange between separate local processes on 127.0.0.1: fresh one-time challenges, receipts verified against the pinned verifier, and the same retained fixture evidence; see the [reproduction guide](../../../../JUDGE_START_HERE.md#agent-trust-live-local).

## Historical drafting records

The [card](COLOSSEUM-CARD.md), [portal fields](PORTAL-FIELDS.md), [demo script](DEMO-SCRIPT-3MIN.md) and [pitch](PITCH-2MIN.md) below retain the previous Conformance-first draft and are explicitly superseded. Do not paste them over the current card or treat their media placeholders as completed deliverables. The [source map](SOURCE-MAP.md) preserves that editorial history and bounded internal reviews.

This update changes documentation only. It does not edit the contest portal, choose tracks, upload videos or submit the entry.
