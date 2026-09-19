# C2 release-recipe candidate — local handoff

Use Node 22.18.0 or 24.20.0 for the measured reproduction. No dependency install or network fetch is needed for the application. Authenticate the external ZIP hash, then verify the packet manifest before execution. The extracted folder contains raven-c2-release-recipe-2026-09-19.bundle, DELIVERY-IDENTITY.json and AUTHOR-REPORT.md. These names must travel together. The final HEAD/TREE are outside source, avoiding a self-referential commit hash.

## Fresh reference run

Run this verbatim from the extracted delivery directory. Use a fresh directory: an existing raven-worldsfair-2026 destination should cause a refusal, not overwrite it.

```sh
# Verify the external ZIP hash and packet manifest before running these commands.
# Run from the extracted delivery folder containing the bundle and DELIVERY-IDENTITY.json.
set -e
git clone --branch codex/c2-release-recipe-2026-09-19 ./raven-c2-release-recipe-2026-09-19.bundle raven-worldsfair-2026
cd raven-worldsfair-2026
git rev-parse HEAD
git rev-parse 'HEAD^{tree}'
node -e 'const fs=require("node:fs"),cp=require("node:child_process"),id=JSON.parse(fs.readFileSync("../DELIVERY-IDENTITY.json","utf8"));const head=cp.execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),tree=cp.execFileSync("git",["rev-parse","HEAD^{tree}"],{encoding:"utf8"}).trim();if(id.head!==head||id.tree!==tree||id.branch!=="codex/c2-release-recipe-2026-09-19"||id.bundle!=="raven-c2-release-recipe-2026-09-19.bundle")throw Error("DELIVERY_IDENTITY_MISMATCH");'
# AUTHOR-REPORT.md beside the bundle records scope, checks and limitations.
cd apps/raven-conformance
npm test
npm run conform -- --target CONFORMANT_REFERENCE
# BROKEN_SUBTLE intentionally returns exit 1 for V07/V08 divergence; reference returns 0.
```

Expected: 12 PASS, CONFORMANT, exit 0. From the same app directory, run `npm run conform -- --target BROKEN_SUBTLE`: 10 PASS, only V07/V08 divergent, exit 1 is the expected observed divergence. V11/V12 both PASS.

## Recorded mode

All four sample reports keep their earlier observed results and timestamps. Clean-clone instructions and their full-content digests change. The two Challenge 1 samples also receive corrected deterministic digests from the unchanged digest routine: their prior stored digests already failed that routine. Measurement fields stay unchanged. The reproduction_update field records the previous file hash and states observations_rerun:false. The old exact files remain available from parent 24dbca45ef479fc843fef593365e4007dff75ed3 and in the delivery's historical evidence. These updated samples are successors, not byte-identical historical originals.

Copy reproduction copies the displayed clean-clone recipe in live and recorded mode. Reproducing a target on this candidate is not proof of replay compatibility with an older recorded environment. Replay retains its existing identity checks and may refuse historical samples; it is not weakened here.

## Delivery-only regression

Set C2_DELIVERY_BUNDLE and C2_DELIVERY_IDENTITY to the absolute paths beside the bundle to execute the sealed clone regression during the suite. Without those artifacts the test explicitly reports SKIPPED / NOT_EXECUTED; it never counts a missing handoff as tested. C2_DELIVERY_HEAD and C2_DELIVERY_TREE replace the former D1 metadata override names. No exact commit is silently inferred from those overrides.

## Boundary

Local candidate only. Independent exact-head review and Owner acceptance are separate. No public URL, deployment, external outreach or release approval is implied. Profile, corpus, targets, isolation, HTTP hardening and replay behavior are unchanged. INTEGER_KEY_ORDER remains unresolved; Foundry and Corpus0 are separate.
