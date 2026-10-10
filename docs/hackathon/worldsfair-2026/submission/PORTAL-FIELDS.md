# Portal fields — one canonical set, not submitted

All blocks below are the selected plain-text values, not alternatives. A2 is identical to the card's about-text. Counts include line breaks. Limits are inherited from REV9-S8 and Billy's packet; the live portal labels were not rechecked in this local reconciliation. Glen must check those labels before pasting. No prices, terms, customer or release readiness is implied.

| Field | Selected value |
| --- | --- |
| Project name | Raven Conformance |
| Tagline | Check Solana readers. Verify signed receipts offline. |
| B2 GitHub | https://github.com/billybotticelli4u-collab/raven-worldsfair-2026 |
| B6 Live URL | https://raven-worldsfair-2026.vercel.app/ |

<a id="field-a2"></a>

## A2 Brief description — 495/500 characters

```text
Raven checks Solana transaction readers against tricky bytes and lets an agent verify a signed receipt offline before acting. Our demo reader, broken only against our experimental v1 profile (proposed v1, SIMD-0385), matches 27/30 rows; the reference matches 30/30. On 13 structural rows, Kit 8.4.0 11/13, web3.js 1.99.0 12/13, solders 0.29.0 11/13 (not a ranking). Agent Trust's fixture gives PROCEED, then REFUSE after a one-field tamper. Reports are unsigned; matches are not safety verdicts.
```

<a id="field-a4"></a>

## A4 What are you building — 968/1000 characters

```text
Raven is for teams whose Solana parsers, SDKs, explorers, indexers or wallets others rely on, and for agents checking evidence before acting.

Conformance compares a reader with a stated experimental profile on 30 synthetic vectors. Our reader, broken against our experimental profile, matches 27/30; V03/V16 use proposed v1 (SIMD-0385); V10 has a non-canonical length. The reference matches 30/30. Reports replay and are unsigned.

Published decoders ran unmodified through local adapters. On 13 structural rows: Kit 8.4.0 11/13, web3.js 1.99.0 12/13, solders 0.29.0 11/13. Not a ranking; solders used a separate harness.

Agent Trust verifies a signed fixed receipt offline: PROCEED, then REFUSE after one finding changes without a new signature. It uses a fixed clock, not live acquisition or permission to transact.

The hosted Conformance page runs our readers; your decoder needs a local adapter. MATCH means a saved expectation reproduced, not a safety verdict.
```

<a id="field-a5"></a>

## A5 Why now — 665/1000 characters

```text
As transaction formats evolve, an outdated reader can return a plausible but different result. Raven turns a stated support claim into row-by-row evidence another engineer can rerun. Our 30 synthetic vectors cover legacy, v0 and an experimental v1 interpretation; they are a finite test set, not proof of universal correctness.

The Fair-built work connects the Conformance loop, judge UI and an agent exchange to Raven's pre-existing verifier. One engineer's task is to evaluate a version upgrade without silently changing earlier behavior. A team's decoder requires an adapter and scoped local evaluation. No paying customer or completed outside pilot is claimed.
```

<a id="field-a6"></a>

## A6 Technologies — 455/500 characters

```text
Node.js 22.18; plain browser JavaScript; SHA-256 over canonical JSON; Node permission controls and macOS network denial for bounded runs; TypeScript verifier from a pinned Git submodule; thin local JS adapters to published Kit/web3.js, separate Python/solders harness; Vercel for hosted Conformance. Saved-case Replay is separate: Vercel Sandbox execution and Supabase admission. A subprocess is not a sandbox; no kernel security certification is claimed.
```

<a id="field-a8"></a>

## A8 How it uses the chains — 482/500 characters

```text
Conformance checks serialized legacy, v0 and experimental v1 bytes offline against a finite profile; it does not verify signatures, account state or settlement. Agent Trust verifies a signed retained receipt offline at a fixed demo clock (liveAcquisition:false). Separate hosted saved-case Replay fetches a finalized transaction from public RPC; slot, time and finality are provider-reported. It saves legacy/v0, not v1. No wallet or transaction signing is required for these demos.
```

<a id="field-a14"></a>

## A14 Anything else / attribution — 487/500 characters

```text
Pre-existing, referenced, not Fair work: Raven's receipt verifier and public trust anchors, hosted verifier, BONK receipt fixture and raven-site. Fair-built: Conformance, profiles, runner, judge UI, demo targets, corpus, saved-case Replay and agent exchange. Third-party decoders ran unmodified via our adapters; solders used a separate harness. Reviews are internal and bounded, not external audits. No third-party security defect, paying customer or completed outside pilot is claimed.
```

<a id="field-b3"></a>

## B3 Repo context — 479/500 characters

```text
Current repo: raven-worldsfair-2026. Conformance's 30-row reproduction pin is 2cb12875. Agent Trust's npm run demo is in 1db786e6 and this docs successor. Local saved-case Replay is apps/raven-replay; hosted Replay source is on unmerged branch codex/hosted-replay-source-recovery-51b60b7-20261003 at 51b60b7b, not main. The verifier is a pinned pre-Fair submodule. PROVENANCE_MANIFEST_V3.md attributes components; Apache-2.0. Earlier raven-conformance-worldsfair links are stale.
```

<a id="field-b7"></a>

## B7 Access instructions — 1106 characters; no stated limit

```text
No login. Open https://raven-worldsfair-2026.vercel.app/, select Solana transaction versions and SOL_BROKEN_SUBTLE, then Run Conformance (live). Expect DIVERGENT: 27 matching rows and 3 differences (V03/V16: proposed v1, SIMD-0385; V10: non-canonical length). Run SOL_CONFORMANT_REFERENCE: 30/30. Click Replay report: Replay matched, bundle yes, semantics yes. Reports are unsigned.

For Agent Trust, use Node 22.18.0 and a recursive clone of https://github.com/billybotticelli4u-collab/raven-worldsfair-2026. From its root run npm run demo; no npm install is needed. Expect Valid receipt: PROCEED and One-field tamper: REFUSE. The receipt is signed; the fixed fixture and evaluation clock are not live chain acquisition or permission to transact.

Read JUDGE_START_HERE.md for exact commands and scope. The primary two demos need no wallet, provider or credentials. The page asserts its build identity; that is not proof of served bytes. A customer's decoder requires a scoped local adapter. Separate saved-case Replay has separate hosting prerequisites and does not inherit this walkthrough's acceptance.
```

## Media fields — still unfilled

Use only the final recorded product demo and Glen's founder pitch after approval, recording and URL verification. No new video was recorded or uploaded here, and this set invents no links. The selected scripts are [DEMO-SCRIPT-3MIN.md](DEMO-SCRIPT-3MIN.md) and [PITCH-2MIN.md](PITCH-2MIN.md). Their timing is a target, not measured media duration. Confirm current portal duration and format requirements before recording.

## Scope and limits carried with this set

The Conformance report and the separate saved-case Replay report are unsigned; Agent Trust's retained receipt is signed. PROCEED is the fixture policy outcome, not authority to trade or proof of current account state. Finite synthetic profile, experimental v1 interpretation, no customer decoder upload, no outside pilot or paying customer claim, internal bounded reviews, and pre-existing component attribution all remain.

Separate workflows retain separate names: **Replay report** is Conformance's report check; **Local saved-case Replay** is `apps/raven-replay`; **Hosted saved-case Replay** is the separate hosted app whose source is on an unmerged branch. This set leads with Conformance and Agent Trust. It does not certify hosted Replay's snapshot, deployed bytes, distribution clearance or execution readiness.

Third-party headlines use only the 13 structural rows. The three adapter-prelude rows and fourteen sanitize/policy rows are not claims these libraries promise to enforce; solders used a separate harness. These are Billy's retained structural scores. KIMI's initial check confirmed the summary; Billy 1's later author reconciliation traced the one-row Kit difference to V10 adapter composition, with KIMI's confirmation pending. The row taxonomy is derived, and the two mappings differ at V17/V19. The technical results page records that limit, the web3.js-only V10 API split and Kit's documented maintainer-accepted trailing-byte tradeoff (kit#1963). Impact unassessed. No standalone length-encoding follow-up is part of this copy.

[Source decisions and hashes](SOURCE-MAP.md) preserve the revision lineage. Earlier submitted weekly links were reported as locked in Billy's packet; that portal behavior was not rechecked here. This set corrects the current GitHub field and does not claim to edit those earlier links.
