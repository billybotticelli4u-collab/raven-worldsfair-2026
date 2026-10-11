# Raven × Crypto World's Fair 2026

Raven checks how Solana transaction readers handle tricky bytes, and lets an agent verify a signed receipt offline before it acts. [**Judges: start here.**](JUDGE_START_HERE.md)

## Compare real Kit versions

**30 seconds, nothing to install:** [open the browser comparison](https://ravenattest.com/compare.html) and click **Run real comparison**. The same synthetic version-3 bytes run through published `@solana/kit` 3.0.3, 4.0.0 and 8.3.0 in your browser. Expect **3.0.3 ACCEPT (version 3)** and **4.0.0 / 8.3.0 REJECT**. A difference is evidence to investigate, not a bug claim or safety verdict. The downloadable report is unsigned.

[Source and local serving instructions](apps/kit-compare/README.md) · [pinned bundle SHA-256 hashes](apps/kit-compare/decoder-vendor/manifest.json). No wallet, signing, RPC or upload is needed; use public or synthetic bytes. The two decoder calls and their limits are explicit in the source README.

## Conformance and Agent Trust

In two minutes, [Raven Conformance](https://raven-worldsfair-2026.vercel.app/) shows a Raven-owned reader diverging on V03/V16 (proposed v1, SIMD-0385) and V10 (a non-canonical length): 27 match, 3 differ, then the reference matching 30/30. The separate **Agent Trust** offline fixture shows Agent A PROCEED with a valid receipt and REFUSE after one finding code changes without a new signature. From a recursive checkout, run `npm run demo`. Both paths and their expected output are in the judge guide.

## Scope and limits

The hosted page's Disclosure / Build Info shows the commit it asserts (read it from /api/build-info; it can lag `main`; an unverified platform assertion, not proof of the served bytes). The Conformance app, api/ and vercel.json are unchanged since dba22af. The Conformance reproduction pin `2cb12875` has byte-identical Conformance product code (`apps/raven-conformance` unchanged) and reproduces the same corpus, though it predates the Agent Trust `npm run demo` command; run `npm run demo` from a clone of `main`, not from a checkout of the asserted build. Conformance reports are unsigned and a match is not a safety verdict. Agent Trust uses a deterministic fixture (`liveAcquisition:false`), not live Solana acquisition; PROCEED is a fixture policy result, not permission to transact. The hosted page runs Raven-owned demonstration readers, not visitor uploads. [Local saved-case Replay](docs/hackathon/worldsfair-2026/REPLAY_JUDGE_WALKTHROUGH.md) and [Hosted saved-case Replay](https://raven-replay.vercel.app) are separate applications; hosted source is [public on an unmerged branch at `51b60b7b`](https://github.com/billybotticelli4u-collab/raven-worldsfair-2026/tree/51b60b7b9220d52f95ef747abc0ca5c97250b9e0/apps/raven-replay-hosted). Source availability does not prove deployed bytes or hosted execution.

The [third-party decoder measurements](docs/hackathon/worldsfair-2026/THIRD_PARTY_DECODER_RESULTS.md) lead with 13 structural rows and distinguish them from adapter and policy rows. An internal non-author review independently confirmed the retained Kit 8.4.0 result by reproducing both adapters row by row: V10 is the only differing row, caused by adapter composition ([confirmation record](docs/hackathon/worldsfair-2026/JUDGE_PROVENANCE_APPENDIX.md#kit-v10-independent-confirmation)). The displayed scores remain the original measurements under their recorded row mapping. Kit's trailing-byte tolerance is a documented maintainer-accepted tradeoff (kit#1963); impact unassessed.

The [canonical submission set](docs/hackathon/worldsfair-2026/submission/README.md) contains one card, portal field set, product demo and founder pitch, all drafts awaiting go-ahead. Sections below retain the required attribution; technical history is in the [provenance appendix](docs/hackathon/worldsfair-2026/JUDGE_PROVENANCE_APPENDIX.md). This repository has recorded Vercel Preview and Production deployments; a push may trigger hosting automation and does not authorize a change to ravenattest.com. The hosted Replay branch does not provide a provisioned execution snapshot or service credentials.

---

## Disclosures

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

### 6. Review limits

Reviews are internal, bounded to specific artifacts and scopes, and are not external audits or release approval. See the [recorded component reviews](docs/hackathon/worldsfair-2026/JUDGE_PROVENANCE_APPENDIX.md#recorded-component-reviews).

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

## Agent Trust local quickstart (retained Fair demo)

For the Conformance demonstration and its local reproduction, use
[Judge start](JUDGE_START_HERE.md). Agent Trust is a separate offline fixture demo.

Use **Node.js 22.18.0** for the recorded environment.

```bash
git clone --recurse-submodules https://github.com/billybotticelli4u-collab/raven-worldsfair-2026
cd raven-worldsfair-2026
npm run demo  # Valid receipt: PROCEED; One-field tamper: REFUSE

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
| [`apps/kit-compare/`](apps/kit-compare/README.md) | Browser comparison of three published Kit versions; pinned bundles, licences and synthetic examples |
| `apps/worldsfair-agent-trust/` | Fair Day-2 agent↔agent demo (FAIR_NEW) |
| `apps/raven-conformance/` | Fair-era Conformance runner, profiles, UI and corpora; imported Solana target bytes retain their recorded Raven lineage |
| `apps/raven-replay/` | Fair-era saved-case Replay prototype, including the nested parser SDK; included upstream history is limited as disclosed in V3 |
| `apps/raven-site/` | Pre-existing Raven site apart from the Fair-era `worldsfair/` surface and changed Vercel configuration |
| `docs/hackathon/worldsfair-2026/` | Fair provenance + PUBLIC_EXPOSURE_MANIFEST_V2 |
| `vendor/raven-receipt-verifier/` | **Submodule** — PRE-EXISTING foundation pin |
| [`docs/internal/`](docs/internal/README.md) | Historical operations notes and the original export manifest |

---

The [historical operations archive](docs/internal/README.md) preserves older deployment and promotion notes. It is not current release authority. This source update does not authorize a production deployment or npm publication.
