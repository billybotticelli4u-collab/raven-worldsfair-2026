# Owner promote step — Fair tip (ask not open yet)

**Updated:** 2026-09-20 (Europe/Rome), successor to b29c1f2 after CODEX CHANGES_REQUESTED (B1–B3)
**Author:** Billy (Release Lead / integrator — not independent reviewer); this successor commit authored by Claude desktop as Billy's stand-in (Billy offline 2026-09-20) — Claude may not review it
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

Measured with `node apps/raven-site/test.mjs` (pinned Node 22.18.0) on this HEAD:

| Class | Count | Notes |
|-------|------:|-------|
| PASS | 139 | |
| FAIL (lineage ENOENT) | 5 | Expected on Fair tip — **not** site defects (listed below) |
| FAIL (real tip defects) | 0 | Exit code is 1 only because of the five ENOENTs |

### How the two former tip defects are resolved on this HEAD (apex bytes stay identical to `main`)
1. **World's Fair footer** — the link was only in generated `index.html`, not the template. Resolution: the footer link is **removed** from `index.html`, so `apps/raven-site/index.html`, `index.template.html` and `.vercelignore` are byte-identical to `origin/main` 8336f86d. `/worldsfair` stays reachable through the redirect already in `apps/raven-site/vercel.json` (allowlisted).
2. **CommonJS intake** — `apps/raven-site/api/request-access.js` inherited the Fair root `"type":"module"`. Resolution: `apps/package.json` = `{"type":"commonjs"}` (new file **outside** `apps/raven-site/`, so outside the apex surface and outside the production Root Directory). `apps/raven-conformance` and `apps/worldsfair-agent-trust` keep their own `type:module` package.json, so they are unaffected.

### Also on this HEAD
- **D5/D6 harness** (`scripts/verify-judge-url.mjs` + `scripts/lib/judge-url-identity.mjs`): `V07_`/`V08_` `vector_id` prefix match; `LOCAL-UNBOUND` is loopback-only and now covers both real local shapes — extracted package (`UNKNOWN`/null, no commit) **and** git checkout (`UNVERIFIED_ASSERTION` + 40-hex HEAD, `commitSource: git_checkout`). `CONFLICT`/`CORRUPTED`/malformed commit never soft-pass; non-loopback with unset `EXPECTED_COMMIT` always fails the binding row. 12/12 unit tests; `d6-red` proof exits 1.
- **Download surface (CODEX B3)** — `worldsfair/download/README.md` renamed to `worldsfair/download/DOWNLOAD-NOTES.md` (same bytes 71ae943f…), link + copy + `SHA256SUMS.txt` updated; `.vercelignore` untouched (== main). Deployment-input proof: `node scripts/verify-download-surface-deploy-input.mjs` evaluates `.vercelignore` with `git check-ignore` (gitignore semantics, rooted at `apps/raven-site`) for every linked download → `DOWNLOAD_SURFACE_DEPLOY_INPUT_OK`; negative control shows the old `README.md` name **would** be excluded.

### Measured harness runs on this HEAD (real `npm start` from the git checkout, loopback)
| Run | Result |
|-----|--------|
| `EXPECTED_COMMIT` unset | 7 PASS / 2 LOCAL-UNBOUND / 0 FAIL, exit 0 |
| `EXPECTED_COMMIT=<this HEAD>` | 9 PASS / 0 / 0, exit 0 |
| `EXPECTED_COMMIT=000…0` | exit 1 |
| non-loopback gate (`VERIFY_JUDGE_HOSTNAME_FOR_GATE=raven-worldsfair-2026.vercel.app`), unset pin | 8 PASS / 0 / 1 FAIL (`EXPECTED_COMMIT binding`), exit 1 |

### Lineage artefacts (5 ENOENTs — do not chase as site bugs)
These paths exist on `main` and are absent on the Fair tip because the lineages diverged. Documented so CODEX does not treat them as regressions to fix on this branch:

1. `apps/launchguard-acp/deploy/HOSTED-VERIFIER-DEPLOY-RUNBOOK.md` (×2 tests)
2. `.github/workflows/raven-canary.yml` (×2 tests)
3. `docs/raven/RAVEN_RECEIPT_V1_SPEC.md` (×1 test)

Contrast: `origin/main` (8336f86) reports **SITE TESTS OK (144 ok)** because those files exist there.

## Status

Prior ask **Promote `fa205f85`? YES/NO** remains **WITHDRAWN**.

This tip is for **CODEX delta re-review only**. A new one-line YES/NO ask opens only after that review PASSes **and** explicitly confirms the preview-promote / never-merge-main rule.

## Candidate (fill after commit)

| Field | Value |
|-------|-------|
| Branch | `billy/fix-verify-judge-url-d5-d6-2026-09-20` (carries site+vercelignore+harness) |
| **HEAD** | trust `git rev-parse HEAD` on this branch (relay ask carries the exact tip) |
| Worktree | `…/worktree-tip-apex-evidence-fix` |

### Explicitly not done
- No deploy / push / alias / env
- No Colosseum post
- No merge into `main`
- No open Owner YES/NO until CODEX re-review PASS

## Binding

Relay asks carry the exact tip `HEAD` / `TREE`. In-repo, prefer `git rev-parse` over any pasted hash so this file cannot drift from itself.
