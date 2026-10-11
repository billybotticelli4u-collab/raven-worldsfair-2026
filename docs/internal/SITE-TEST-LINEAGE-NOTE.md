# Site-test lineage note (Fair tip)

`origin/main` passes `apps/raven-site/test.mjs` clean (144 ok).
This Fair tip fails **exactly five** tests, all `ENOENT`, all for paths that exist on `main` and not on this lineage:

- `apps/launchguard-acp/deploy/HOSTED-VERIFIER-DEPLOY-RUNBOOK.md` (2)
- `.github/workflows/raven-canary.yml` (2)
- `docs/raven/RAVEN_RECEIPT_V1_SPEC.md` (1)

Cause: Fair branch root `feaa1fb` (2026-09-14 Strategy A) does not descend from `main`; `git merge-base` fails. These are **lineage artefacts**, not tip regressions. Do not copy `main` files onto this tip to “green” the suite as part of the promote delta.

The two **real** tip defects Claude-038 named (World’s Fair footer only in generated HTML; empty/missing `apps/raven-site/package.json`) are fixed on this HEAD. Intake + template twin tests pass.
