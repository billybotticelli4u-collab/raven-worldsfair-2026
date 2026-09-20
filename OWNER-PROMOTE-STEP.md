# Owner promote step — Fair tip (ask not open yet)

**Updated:** 2026-09-20 (Europe/Rome)
**Author:** Billy (Release Lead / integrator — not independent reviewer)
**Deploys:** FROZEN. No push. No deploy.

## Promote shape (structural — non-negotiable)

This tip’s Fair lineage **does not descend from `main`** (`git merge-base` with `origin/main` fails; root `feaa1fb` 2026-09-14 "Strategy A"). A git merge of this branch into `main` would delete every `main`-only file the lineage lacks.

**Therefore the promote is:**

> **Promote the branch’s Vercel preview deployment to production**
> (or set the Vercel production branch to this branch).

**Never:**

> Merge this branch into `main`.

CODEX must confirm this sentence in re-review before any Owner YES/NO is opened.

## Site-test status on this tip

Measured with `node apps/raven-site/test.mjs` (Node 22):

| Class | Count | Notes |
|-------|------:|-------|
| PASS | 139 | Includes the two former tip defects below |
| FAIL (lineage ENOENT) | 5 | Expected on Fair tip — **not** site defects |
| FAIL (real tip defects) | 0 | Fixed on this HEAD |

### Fixed on this HEAD (were real tip defects; main was already green)
1. **World’s Fair footer** — link lived only in `index.html`; added to `index.template.html` and regenerated so template↔HTML twins match.
2. **`apps/raven-site/package.json`** — was empty/missing; now `{"type":"commonjs"}` so `api/request-access.js` and `build.js` do not inherit Fair-root `"type":"module"`.

### Also on this HEAD
- **D5/D6 harness** (`scripts/verify-judge-url.mjs`): `V07_`/`V08_` `vector_id` prefix match + `LOCAL-UNBOUND` for unbound identity rows.
- **Claude-036 `.vercelignore`**: `!worldsfair/download/README.md` after the bare `README.md` ignore so the download surface is not 404.

### Lineage artefacts (5 ENOENTs — do not chase as site bugs)
These paths exist on `main` and are absent on the Fair tip because the lineages diverged. Documented so CODEX does not treat them as regressions to fix on this branch:

1. `apps/launchguard-acp/deploy/HOSTED-VERIFIER-DEPLOY-RUNBOOK.md` (×2 tests)
2. `.github/workflows/raven-canary.yml` (×2 tests)
3. `docs/raven/RAVEN_RECEIPT_V1_SPEC.md` (×1 test; Claude also saw a second pin against the same missing tree)

Contrast: `origin/main` (e.g. `8336f86`) reports **SITE TESTS OK (144 ok)** because those files exist there.

## Status

Prior ask **Promote `fa205f85`? YES/NO** remains **WITHDRAWN**.

This tip is for **CODEX delta re-review only**. A new one-line YES/NO ask opens only after that review PASSes **and** explicitly confirms the preview-promote / never-merge-main rule.

## Candidate (fill after commit)

| Field | Value |
|-------|-------|
| Branch | `billy/fix-verify-judge-url-d5-d6-2026-09-20` (carries site+vercelignore+harness) |
| **HEAD** | _(see commit)_
| Worktree | `…/worktree-tip-apex-evidence-fix` |

### Explicitly not done
- No deploy / push / alias / env
- No Colosseum post
- No merge into `main`
- No open Owner YES/NO until CODEX re-review PASS
