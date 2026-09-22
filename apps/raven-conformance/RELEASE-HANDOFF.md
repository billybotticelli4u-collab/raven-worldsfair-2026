# C2 release successor — local handoff

Use Node 22.18.0 or 24.20.0 for the measured reproduction. No dependency install or network fetch is needed for the application. Authenticate the external ZIP hash, then verify the packet manifest before execution. The extracted folder contains raven-c2-release-successor-2026-09-19.bundle, DELIVERY-IDENTITY.json and AUTHOR-REPORT.md. These names must travel together. The final HEAD/TREE are outside source, avoiding a self-referential commit hash.

## Fresh reference run

Run this verbatim from the extracted delivery directory. Use a fresh directory: an existing raven-worldsfair-2026 destination should cause a refusal, not overwrite it.

```sh
# Verify the external ZIP hash and packet manifest before running these commands.
# Run from the extracted delivery folder containing the bundle and DELIVERY-IDENTITY.json.
set -e
git clone --branch codex/c2-release-successor-2026-09-19 ./raven-c2-release-successor-2026-09-19.bundle raven-worldsfair-2026
cd raven-worldsfair-2026
git rev-parse HEAD
git rev-parse 'HEAD^{tree}'
node -e 'const fs=require("node:fs"),cp=require("node:child_process"),id=JSON.parse(fs.readFileSync("../DELIVERY-IDENTITY.json","utf8"));const head=cp.execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),tree=cp.execFileSync("git",["rev-parse","HEAD^{tree}"],{encoding:"utf8"}).trim();if(id.head!==head||id.tree!==tree||id.branch!=="codex/c2-release-successor-2026-09-19"||id.bundle!=="raven-c2-release-successor-2026-09-19.bundle")throw Error("DELIVERY_IDENTITY_MISMATCH");'
# AUTHOR-REPORT.md beside the bundle records scope, checks and limitations.
cd apps/raven-conformance
npm test
npm run conform -- --target CONFORMANT_REFERENCE
# BROKEN_SUBTLE intentionally returns exit 1 for V07/V08 divergence; reference returns 0.
```

Expected: 12 PASS, CONFORMANT, exit 0. From the same app directory, run `npm run conform -- --target BROKEN_SUBTLE`: 10 PASS, only V07/V08 divergent, exit 1 is the expected observed divergence. V11/V12 both PASS.

## Recorded mode

All four sample reports retain their earlier measurements and timestamps. Only clean-clone instructions, migration annotations and full-content digests change in this successor. The deterministic digest is recomputed by the unchanged routine and must remain identical. reproduction_update records the immediate predecessor file hash and observations_rerun:false. Exact preceding files are retained in the delivery evidence and parent 1a8275cbbeb5513011f06325c334e24f619c0ae7. No recorded measurement is claimed as newly executed.

Copy reproduction copies the displayed clean-clone recipe in live and recorded mode. Reproducing a target on this candidate is not proof of replay compatibility with an older recorded environment. Replay retains its existing identity checks and may refuse historical samples; it is not weakened here.

## Delivery-only regression

Set C2_DELIVERY_BUNDLE and C2_DELIVERY_IDENTITY to the absolute paths beside the bundle to execute the sealed clone regression during the suite. Without those artifacts the test explicitly reports SKIPPED / NOT_EXECUTED; it never counts a missing handoff as tested. C2_DELIVERY_HEAD and C2_DELIVERY_TREE replace the former D1 metadata override names. No exact commit is silently inferred from those overrides.

## Boundary

Local candidate only. Independent exact-head review and Owner acceptance are separate. No public URL, deployment, external outreach or release approval is implied. Profile, corpus, targets, isolation, HTTP hardening and replay behavior are unchanged. INTEGER_KEY_ORDER remains unresolved; Foundry and Corpus0 are separate.

## Exportable cleanliness gate (CLAUDE-068)

Before sealing a delivery package or handing off evidence from this app tree, run the Fair-path cleanliness check. Not part of `npm test` / product build / CI / Fair tip promote.

```sh
# From repo root (INTEGRATION-LANE worktree):
node scripts/artifact-sealing.mjs /path/to/sealed-package-dir
node scripts/evidence-handoff.mjs /path/to/evidence-or-handoff-dir
# Direct check:
node scripts/check-exportable-cleanliness.mjs [--allowlist FILE] <dir-or-file> [...]
```

Fails non-zero on absolute filesystem path strings (including `/private/tmp` and `/var/folders`, not only `/Users/`). Optional `--allowlist FILE`: exact offending string or prefix ending in `/`.
