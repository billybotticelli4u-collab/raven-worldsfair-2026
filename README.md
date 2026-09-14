# Raven × Crypto World's Fair 2026 — Agent Trust demo

Judge demo: Agent A refuses blind trust, requires Raven-verified Solana
receipt-v1 evidence from Agent B, then PROCEED / REFUSE fail-closed.

**Preferred live URL (when Owner authorizes deploy):**
https://ravenattest.com/worldsfair

**This public Fair repo does not deploy by itself.** No deployment to
ravenattest.com is performed by this repository's publication.

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

- Agent A / Agent B orchestration, fail-closed PROCEED/REFUSE,
  judge-facing web UI + About/Build Info honesty, Fair app tests, and
  provenance docs under `docs/hackathon/worldsfair-2026/`.
- Built after official contest start
  `2026-09-14T06:00:00-07:00` (America/Los_Angeles).

### 4. Deterministic fixture verification + BONK_FIXTURE_NOW

- PATH A/B use **offline fixtures** under
  `apps/worldsfair-agent-trust/fixtures/`.
- Verification clock is pinned (`BONK_FIXTURE_NOW` =
  `2026-06-26T11:46:31.000Z`) so freshness is not falsely stale —
  deterministic demo time, not wall clock.

### 5. NOT live Solana acquisition

This demo does **not** perform live Solana RPC acquisition for PATH A/B.
Evidence is offline fixture-based. Do not treat the demo as a live-chain
fetch or production signing workflow.

### 6. Review class: INTERNAL_ADVERSARIAL_NON_AUTHOR — not EXTERNAL_INDEPENDENT

Day-1 product tip `1ba45d5a787172da648b9da4241f119bcc49e814` /
tree `9205ca7901c0acd12663e628bd9936c1a8eb8c76` carries
**INTERNAL_ADVERSARIAL_NON_AUTHOR** GO (Billy copy-GO class).
That is **not** EXTERNAL_INDEPENDENT review.

### 7. Public Fair repo ≠ all Raven production/security work is hackathon-created

Publishing this Fair-only repository does **not** imply that all Raven
production, security, governance, or research work was created during
the hackathon. Only the Fair surface listed under FAIR_NEW in
`docs/hackathon/worldsfair-2026/PUBLIC_EXPOSURE_MANIFEST_V2.md` is
competition work. The linked verifier submodule is labeled
**PRE-EXISTING RAVEN FOUNDATION — NOT CRYPTO WORLD'S FAIR WORK**.

---

## Quickstart (judges)

Requires **Node.js >= 22.18** (Node 25+ also fine).

```bash
git clone https://github.com/billybotticelli4u-collab/raven-worldsfair-2026
cd raven-worldsfair-2026
git submodule update --init --recursive

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
| `apps/worldsfair-agent-trust/` | Fair Day-1 agent↔agent demo (FAIR_NEW) |
| `docs/hackathon/worldsfair-2026/` | Fair provenance + PUBLIC_EXPOSURE_MANIFEST_V2 |
| `vendor/raven-receipt-verifier/` | **Submodule** — PRE-EXISTING foundation pin |
| `EXPORTED_FILE_MANIFEST.md` | Exact exported file set vs V2 |

---

## Review / deploy honesty

- This repository is **not** Owner production-publish authorization by itself
  beyond the Fair public surface authorized for this contest demo.
- **Deploy to ravenattest.com / `/worldsfair` is HOLD** — not performed
  by this publication pass.
- **No npm publish** of `raven-receipt-verifier` or this Fair app.

## Source tip (Fair product)

| Field | Value |
| --- | --- |
| Branch (private Fair worktree) | `billy/worldsfair-2026-day1-agent-trust-2026-09-14` |
| Fair HEAD | `1ba45d5a787172da648b9da4241f119bcc49e814` |
| Fair TREE | `9205ca7901c0acd12663e628bd9936c1a8eb8c76` |
| Verifier pin | `1b04356a275742752fb7afd8dfcc4269d462a778` |
