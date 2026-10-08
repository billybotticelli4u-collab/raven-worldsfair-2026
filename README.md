> **Judges: [start here](JUDGE_START_HERE.md).** This repository is public. It contains Raven Conformance (30-row Solana transaction-version corpus, hosted at https://raven-worldsfair-2026.vercel.app/) and a local Raven Replay prototype under `apps/raven-replay/`.
>
> **Start with Conformance:** choose **Solana transaction versions**, run **SOL_BROKEN_SUBTLE** (27 matches, 3 divergences), then **SOL_CONFORMANT_REFERENCE** (30 matches), and replay its report. These are deliberately constructed Raven-owned demonstration targets, not a third-party vulnerability claim.
>
> **Two different things are called Replay.** The prototype in this checkout runs locally on Node v22.18.0: [Replay judge walkthrough](docs/hackathon/worldsfair-2026/REPLAY_JUDGE_WALKTHROUGH.md). The separate hosted page is https://raven-replay.vercel.app. Its [source at commit 51b60b7b](https://github.com/billybotticelli4u-collab/raven-worldsfair-2026/tree/51b60b7b9220d52f95ef747abc0ca5c97250b9e0/apps/raven-replay-hosted) is public on the unmerged branch `codex/hosted-replay-source-recovery-51b60b7-20261003`, not on `main` (checked 9 October 2026). Source availability does not establish which server bytes are running or that hosted execution is available. Reports from both are unsigned; MATCH is not a safety verdict.
>
> Sections below that describe earlier candidates and their reviews are kept as history and are labelled with the commits they refer to.

# Raven Conformance × Crypto World's Fair 2026

Earlier Fair Agent Trust demo: Agent A refuses blind trust, requires Raven-verified Solana
receipt-v1 evidence from Agent B, then PROCEED / REFUSE fail-closed.
Day-2 adds an explicit deterministic `raven-agent-trust/1` machine exchange,
truth disclosure (`liveAcquisition:false`, deterministic fixture/demo
evaluation time), and fail-closed refusal on malformed evaluation time.

**Live Conformance page:** https://raven-worldsfair-2026.vercel.app/
(its Disclosure / Build Info shows the commit the platform asserts).
Landing page: https://ravenattest.com/worldsfair

**This repository has recorded Vercel Preview and Production deployments.**
A push may trigger hosting automation. That does not authorize a change to
ravenattest.com. The Replay browser app in this repository is local only;
the hosted Raven Replay source is on the separate public branch linked above.
That branch does not provide a provisioned execution snapshot or service credentials.

---

## Required disclosures (Owner Glen Frank Dean FINAL AUTH)

### 1. Raven existed before Fair

Raven (the receipt/attestation product and related systems) existed
**before** Crypto World's Fair 2026. This Fair surface is a competition
demo built on that product — not the invention of Raven itself.

### 2. Receipt/verifier foundation + BONK evidence fixture are pre-existing

**PRE-EXISTING RAVEN FOUNDATION — NOT CRYPTO WORLD'S FAIR WORK**

- Raven `receipt-v1` offline verifier (`raven-receipt-verifier` /
  historically `packages/verify-js` in the private monorepo), production
  trust-anchor **public** key material, and the production-shaped BONK
  receipt vector predate contest start.
- This Fair repo **links** the already-public foundation repository
  [`billybotticelli4u-collab/raven-receipt-verifier`](https://github.com/billybotticelli4u-collab/raven-receipt-verifier)
  pinned to immutable commit
  `1b04356a275742752fb7afd8dfcc4269d462a778`
  via git submodule at `vendor/raven-receipt-verifier`.
- Fair does **not** invent a toy verifier.
- Do **not** `npm install raven-receipt-verifier` from the npm registry
  (package is not published). Consume the pinned submodule only.
- Foundation LICENSE remains Apache-2.0 upstream (separate from Fair app
  LICENSE copy; same SPDX family).

### 3. Fair app / orchestration / UX under Fair surface created during competition

## CRYPTO WORLD'S FAIR 2026 WORK

- Agent A / Agent B orchestration, `raven-agent-trust/1` machine exchange,
  fail-closed PROCEED/REFUSE, judge-facing web UI + About/Build Info honesty
  (PRE-EXISTING vs FAIR WORK; **Built during competition** discoverable),
  Fair app tests (including malformed-clock fail-closed), and provenance docs
  under `docs/hackathon/worldsfair-2026/`.
- Built after official contest start
  `2026-09-14T06:00:00-07:00` (America/Los_Angeles).

### 4. Deterministic fixture verification + BONK_FIXTURE_NOW (not wall-clock freshness)

- PATH A/B use **offline fixtures** under
  `apps/worldsfair-agent-trust/fixtures/`.
- Verification clock is pinned (`BONK_FIXTURE_NOW` =
  `2026-06-26T11:46:31.000Z`) so freshness is not falsely stale —
  **disclosed deterministic fixture/demo evaluation time**, not wall clock.
- The **same** evaluation time is what verification uses; disclosure labels
  `evaluationTimeKind: deterministic_fixture_demo_time` and
  `liveAcquisition: false`.
- **Malformed / empty / unusable evaluation time → fail-closed**
  (`invalid_evaluation_time` / REFUSE). Never silently substitutes a demo clock.

### 5. NOT live Solana acquisition

This demo does **not** perform live Solana RPC acquisition for PATH A/B.
Evidence is offline fixture-based (`liveAcquisition:false`). Do not treat the
demo as a live-chain fetch or production signing workflow.

### 6. Review class: bounded exact-artifact reviews — not release approval

This combined local candidate descends from non-author reviewed (INTERNAL_ADVERSARIAL_NON_AUTHOR; not EXTERNAL_INDEPENDENT) HEAD
`4be5ff7858b6636108a219f2c4e94a989c08d79e` / TREE
`30471bbd366d726102446ce3240e4b941e292439`. Claude's review was bounded to
the supplied Darwin/local/unpublished package and its stated component scopes.
The later SDK-licence successor `d93cab02758ee8a0b0f92accb0cfe78c37b6497b`
has a KIMI backup changed-scope CHANGES verdict: its four licence changes pass,
but that exact tree fails the guide's Replay checksum step. The condition is
closed in checksum-and-documentation successor
`d39517aac2e0ed8ffd6e6bfa2a3e4af4f6813f89`, which has a bounded Claude PASS.
This review-recording and manifest-completion successor requires its own
non-author review. None of those reviews authorizes a merge, deployment,
publication or submission.

The Agent Trust app's review class remains the Day-2 `a5cd592b` INTERNAL_ADVERSARIAL_NON_AUTHOR GO; the combined review did not exercise that app.

### 7. Combined-candidate attribution is component-specific

Publishing this repository does **not** imply that all Raven production, security, governance, or research work was created during the hackathon.

The combined candidate contains both pre-existing Raven foundations and work
first introduced during Crypto World's Fair 2026. Component-level attribution
is recorded in
[`PROVENANCE_MANIFEST_V3.md`](docs/hackathon/worldsfair-2026/PROVENANCE_MANIFEST_V3.md).
Review verdicts establish only their stated scopes; they do not establish
authorship, public availability, production readiness or publication authority.
The linked verifier submodule remains labeled **PRE-EXISTING RAVEN FOUNDATION
— NOT CRYPTO WORLD'S FAIR WORK**.

---

## Historical Agent Trust quickstart

For the current Conformance demonstration and its local reproduction, use
[Judge start](JUDGE_START_HERE.md). This older Agent Trust workflow is separate.

Use **Node.js 22.18.0** for the recorded environment.

```bash
git clone --recurse-submodules https://github.com/billybotticelli4u-collab/raven-worldsfair-2026
cd raven-worldsfair-2026

# Confirm submodule pin (must be exact SHA below):
git -C vendor/raven-receipt-verifier rev-parse HEAD
# expect: 1b04356a275742752fb7afd8dfcc4269d462a778

cd apps/worldsfair-agent-trust
npm test
npm start   # http://127.0.0.1:8787
```

`npm test` / `npm start` set `NODE_OPTIONS=--experimental-strip-types`
so Node can import the submodule's TypeScript entry
(`packages/verify-js/src/index.ts`) without a separate `dist/` build and
**without** npm-publishing `raven-receipt-verifier`.

No root workspace install is required — the Fair app has zero runtime
npm dependencies; verification code comes from the git submodule.

---

## Layout

| Path | Role |
| --- | --- |
| `apps/worldsfair-agent-trust/` | Fair Day-2 agent↔agent demo (FAIR_NEW) |
| `apps/raven-conformance/` | Fair-era Conformance runner, profiles, UI and corpora; imported Solana target bytes retain their recorded Raven lineage |
| `apps/raven-replay/` | Fair-era saved-case Replay prototype, including the nested parser SDK; included upstream history is limited as disclosed in V3 |
| `apps/raven-site/` | Pre-existing Raven site apart from the Fair-era `worldsfair/` surface and changed Vercel configuration |
| `docs/hackathon/worldsfair-2026/` | Fair provenance + PUBLIC_EXPOSURE_MANIFEST_V2 |
| `vendor/raven-receipt-verifier/` | **Submodule** — PRE-EXISTING foundation pin |
| `EXPORTED_FILE_MANIFEST.md` | Exact exported file set vs V2 |

---

## Review / deploy honesty

- This repository is **not** Owner production-publish authorization by itself
  beyond the Fair public surface authorized for this contest demo.
- **Deploy to ravenattest.com / `/worldsfair` is HOLD** — not performed
  by this Day-2 tip-bump pass.
- **No npm publish** of `raven-receipt-verifier` or this Fair app.

## Historical source tip (Fair product — Day-2; not the current combined candidate)

| Field | Value |
| --- | --- |
| Branch (private Fair worktree) | `billy/worldsfair-2026-day2-malformed-clock-repair-2026-09-14` |
| Fair HEAD | `a5cd592b72d2da1ebf6f0c1e224d05489ff31524` |
| Fair TREE | `3e442f93529bdb5da876b54d484294032535e84a` |
| Worktree | `<home>/raven-rnd-gauntlet-push/wf-day2-malformed-clock-repair` |
| Review | INTERNAL_ADVERSARIAL_NON_AUTHOR GO (Billy copy) — not EXTERNAL_INDEPENDENT |
| Verifier pin | `1b04356a275742752fb7afd8dfcc4269d462a778` |
| Prior public Day-1 HEAD | `feaa1fb452b8e1307979dea7fd1c561fad82aa00` |

---

## Related Fair app: Raven Conformance MVP

Judge-usable Conformance product MVP (separate from Agent Trust):

- Path: [`apps/raven-conformance/`](apps/raven-conformance/)
- Branch tip for this work: `billy/fair-conformance-mvp-2026-09-16`
- Loop: target → claimed profile → corpus → evidence report → clean reproduction
- Local: `cd apps/raven-conformance && npm test && npm start` → http://127.0.0.1:8791

Build Stage product milestone. Does not claim Day-3 Evidence Contract Handshake
as this product. See that app's README for PRE-EXISTING vs FAIR-built disclosure.
