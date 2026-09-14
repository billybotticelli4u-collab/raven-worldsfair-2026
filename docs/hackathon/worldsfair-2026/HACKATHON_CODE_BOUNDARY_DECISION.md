# Hackathon Code Boundary Decision — World's Fair 2026 Day 1

## Decision: Option A (isolated app in monorepo)

**Location:** `apps/worldsfair-agent-trust/`

**Dedicated Fair repo:** not required for Day 1.

## Why Option A

1. **Inspected `apps/`:** existing Fair-adjacent and product demos already live as
   sibling apps under this monorepo (`raven-blink`, `raven-site`, `raven-verify-mcp`,
   Solana evidence apps, etc.). There is no established pattern of spinning a new
   GitHub repository for a single vertical slice.
2. **Consume, do not redesign:** Day-1 product must use pre-existing
   `packages/verify-js` (`raven-receipt-verifier`) offline. An in-monorepo app can
   import that package by relative path without publishing, forking, or weakening
   verifier semantics.
3. **Judge distinction:** Fair work is confined to a new app directory plus
   `docs/hackathon/worldsfair-2026/*`. Pre-existing packages remain unmodified unless
   a concrete bugfix is later justified (none planned for Day 1).
4. **Colosseum / GitHub submission path:** submit the focused branch
   `billy/worldsfair-2026-day1-agent-trust-2026-09-14` on
   `https://github.com/billybotticelli4u-collab/-launchguard`, pointing judges at
   `apps/worldsfair-agent-trust/` and the provenance docs under
   `docs/hackathon/worldsfair-2026/`.
5. **No Glen blocker:** creating a new GitHub repository is unnecessary; Option A
   proceeds without Owner/Glen intervention.

## New vs pre-existing dependencies

| Kind | What |
| --- | --- |
| Pre-existing (consumed) | `packages/verify-js` / `raven-receipt-verifier` (verify + trust anchor + fixtures) |
| Pre-existing (not modified) | Verifier implementation, trust semantics, production site |
| New (Fair) | `apps/worldsfair-agent-trust/` agent A/B orchestration, UI, Fair tests, PRODUCT.md |
| New (Fair docs) | Baseline, boundary, checklist under `docs/hackathon/worldsfair-2026/` |

## Explicit non-goals for this boundary

- No Owner trust ceremony / keys / enrollment / epoch / override
- No redesign of Raven verifier
- No rewrite of production homepage `ravenattest.com` / `apps/raven-site` product UX
- No npm publish, production deploy, merge to `main`, or history rewrite

## Revisit criterion

A dedicated Fair repository would only be warranted if Colosseum or organizers
require a standalone repo URL that cannot be a branch+path pointer into this
monorepo. That necessity is not present for Day 1; if it appears later, escalate
to Glen with this document as the current recommendation.
