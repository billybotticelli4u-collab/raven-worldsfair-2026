# Crypto World's Fair 2026 — Hackathon Start Baseline

Factual provenance record. Not marketing.

## Context

Raven (receipt-v1 verifier, trust anchors, Solana evidence packages, hosted verifier,
and related monorepo work in `billybotticelli4u-collab/-launchguard`) predated this
contest. This document freezes the exact repository state from which Fair Day-1
product work descends. Foundation code at this HEAD is **not** claimed as Fair-created
work.

## Official contest start

- **officialContestStart:** `2026-09-14T06:00:00-07:00` (`America/Los_Angeles`)
- Equivalent UTC: `2026-09-14T13:00:00Z`

## Baseline measurement (when this freeze was recorded)

Measurement is **not** claimed to have occurred at 06:00 PT.

- **baselineMeasuredAt (UTC):** `2026-09-14T16:02:30Z`
- **baselineMeasuredAt (Europe/Rome):** `2026-09-14T18:02:30+02:00`

## Repository identity at baseline

| Field | Value |
| --- | --- |
| Remote URL | `https://github.com/billybotticelli4u-collab/-launchguard` |
| Tracked branch tip | `origin/main` |
| Fair branch (created from tip) | `billy/worldsfair-2026-day1-agent-trust-2026-09-14` |
| **HEAD** | `18b1a13c601cc362404dc6306fd8f4d1cc3e046e` |
| **TREE** | `6bd7276fb71f8878bd9b3313d7200e56f447a0f3` |
| Working tree | clean (0 porcelain lines at measurement worktree) |
| Tip subject | Merge pull request #210 (`billy/public-truth-reconciliation-2026-09-13`) |
| Tip committer date | `2026-09-13 11:20:02 +0200` |

## Relevant pre-existing packages at this HEAD (non-exhaustive)

| Path | Package name | Version (package.json) | Role |
| --- | --- | --- | --- |
| `packages/verify-js` | `raven-receipt-verifier` | `0.1.0` | Offline receipt-v1 verify + subject binding + production trust anchor |
| `packages/pre-action` | `@raven/pre-action` | `0.0.0` (private) | Framework-neutral pre-action core (verify → consumer policy) |
| `packages/policy` | (present) | — | Consumer policy evaluation helpers |
| `apps/raven-site` | — | — | Production website sources (not redesigned for Fair) |
| `apps/raven-blink` | `raven-blink` | — | Solana Action / Blink demo consuming receipt primitives |
| Fixtures | `packages/verify-js/fixtures/receipt-v1/` | — | Includes production BONK receipt vector |

## Broad pre-existing capabilities (foundation ≠ Fair claim)

At this HEAD the monorepo already includes, among other things:

- Offline Solana receipt-v1 verification (`verifyReceiptV1`, `verifyReceiptV1ForSubject`)
- Embedded production trust anchor (`RAVEN_PRODUCTION_TRUST_ANCHOR` / `ravenProductionTrustedKeys`)
- Golden / production fixtures (including BONK `DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263`)
- Pre-action proceed/pause/reject-style consumer flow
- Multiple Solana evidence / scan / holders / liquidity apps
- Hosted verifier and public site materials

None of the above are re-attributed as Fair Day-1 invention.

## Descent rule

All future Fair commits on `billy/worldsfair-2026-day1-agent-trust-2026-09-14`
descend from this baseline HEAD. Product vertical-slice work is additive after the
first provenance commit that introduces this document set.

## Method note

Baseline was taken via `git fetch origin main` against the existing local clone
`/Users/ROBY/launchguard`, then `git worktree add` to
`/Users/ROBY/launchguard-billy-worldsfair-2026-day1` at `origin/main` tip
`18b1a13…`. No fresh clone. No history rewrite.
