# EXPORTED_FILE_MANIFEST — raven-worldsfair-2026 (Day-2 edition)

Generated: 2026-09-15 (Europe/Rome / CEST).
Strategy: PUBLIC_EXPOSURE_MANIFEST_V2 **Strategy A** (submodule link; PREEXISTING_REQUIRED copies = 0).
History: additive commit on public `main` atop Day-1 `feaa1fb` (no rewrite).

## Source tip

| Field | Value |
| --- | --- |
| Fair HEAD | `a5cd592b72d2da1ebf6f0c1e224d05489ff31524` |
| Fair TREE | `3e442f93529bdb5da876b54d484294032535e84a` |
| Branch | `billy/worldsfair-2026-day2-malformed-clock-repair-2026-09-14` |
| Worktree | `/Users/ROBY/raven-rnd-gauntlet-push/wf-day2-malformed-clock-repair` |
| Review | INTERNAL_ADVERSARIAL_NON_AUTHOR GO (Billy copy) — not EXTERNAL_INDEPENDENT |
| Verifier pin | `1b04356a275742752fb7afd8dfcc4269d462a778` |
| Submodule path | `vendor/raven-receipt-verifier` |
| Prior public Day-1 HEAD | `feaa1fb452b8e1307979dea7fd1c561fad82aa00` |

## FAIR_NEW / BUILD_SUPPORT files (this repo tree, excluding submodule contents)

| path | category |
| --- | --- |
| `.gitignore` | BUILD_SUPPORT |
| `.gitmodules` | BUILD_SUPPORT |
| `EXPORTED_FILE_MANIFEST.md` | BUILD_SUPPORT |
| `LICENSE` | BUILD_SUPPORT |
| `README.md` | BUILD_SUPPORT |
| `apps/worldsfair-agent-trust/PRODUCT.md` | FAIR_NEW |
| `apps/worldsfair-agent-trust/README.md` | FAIR_NEW |
| `apps/worldsfair-agent-trust/fixtures/bonk-tampered-receipt.json` | FAIR_NEW |
| `apps/worldsfair-agent-trust/fixtures/bonk-valid-receipt.json` | FAIR_NEW |
| `apps/worldsfair-agent-trust/fixtures/bonk-wrong-subject-claim.json` | FAIR_NEW |
| `apps/worldsfair-agent-trust/package.json` | FAIR_NEW |
| `apps/worldsfair-agent-trust/public/app.js` | FAIR_NEW |
| `apps/worldsfair-agent-trust/public/index.html` | FAIR_NEW |
| `apps/worldsfair-agent-trust/public/styles.css` | FAIR_NEW |
| `apps/worldsfair-agent-trust/src/lib/agentA.js` | FAIR_NEW |
| `apps/worldsfair-agent-trust/src/lib/agentB.js` | FAIR_NEW |
| `apps/worldsfair-agent-trust/src/lib/buildInfo.js` | FAIR_NEW |
| `apps/worldsfair-agent-trust/src/lib/protocol.js` | FAIR_NEW |
| `apps/worldsfair-agent-trust/src/lib/ravenVerify.js` | FAIR_NEW |
| `apps/worldsfair-agent-trust/src/lib/runSlice.js` | FAIR_NEW |
| `apps/worldsfair-agent-trust/src/server.js` | FAIR_NEW |
| `apps/worldsfair-agent-trust/src/write-build-info.js` | FAIR_NEW |
| `apps/worldsfair-agent-trust/test/build-info.test.js` | FAIR_NEW |
| `apps/worldsfair-agent-trust/test/machine-exchange.test.js` | FAIR_NEW |
| `apps/worldsfair-agent-trust/test/malformed-clock.test.js` | FAIR_NEW |
| `apps/worldsfair-agent-trust/test/truth-disclosure.test.js` | FAIR_NEW |
| `apps/worldsfair-agent-trust/test/vertical-slice.test.js` | FAIR_NEW |
| `docs/hackathon/worldsfair-2026/HACKATHON_CODE_BOUNDARY_DECISION.md` | FAIR_NEW |
| `docs/hackathon/worldsfair-2026/HACKATHON_START_BASELINE.md` | FAIR_NEW |
| `docs/hackathon/worldsfair-2026/JUDGE_QUICKSTART.md` | BUILD_SUPPORT |
| `docs/hackathon/worldsfair-2026/PUBLIC_EXPOSURE_MANIFEST.md` | FAIR_NEW |
| `docs/hackathon/worldsfair-2026/PUBLIC_EXPOSURE_MANIFEST_V2.md` | FAIR_NEW |
| `docs/hackathon/worldsfair-2026/SUBMISSION_CHECKLIST.md` | FAIR_NEW |

## Exposure patches (public Strategy A; still FAIR_NEW)

- `ravenVerify.js`: import retargeted to
  `../../../../vendor/raven-receipt-verifier/packages/verify-js/src/index.ts`
  with PRE-EXISTING foundation comment labels (Day-1 public style).
- `package.json` scripts: `NODE_OPTIONS=--experimental-strip-types` on
  start/dev/test/build (required for submodule `.ts`; private tip lacked this).

## Submodule (not copied foundation sources)

| path | identity |
| --- | --- |
| `vendor/raven-receipt-verifier` (gitlink) | PRE-EXISTING RAVEN FOUNDATION — NOT CRYPTO WORLD'S FAIR WORK; pin `1b04356a275742752fb7afd8dfcc4269d462a778` |
| `.gitmodules` | records URL + path |

## V2 checklist

- [x] apps/worldsfair-agent-trust/** from Day-2 tip a5cd592 (ravenVerify retargeted)
- [x] docs/hackathon/worldsfair-2026/** including MANIFEST V2 tip bump
- [x] Public README disclosures (not live Solana; liveAcquisition:false; deterministic fixture time; malformed clock fail-closed; review class honesty)
- [x] LICENSE (Apache-2.0; foundation LICENSE remains upstream)
- [x] .gitignore + .gitmodules
- [x] Submodule pin exact SHA (not floating branch)
- [x] PREEXISTING_REQUIRED file copies: **0**
- [x] Additive history on public main (parent feaa1fb); no force-push
- [x] No deploy / no npm publish

## Secret scan (pre-push)

No private PEM/OpenSSH keys, no .env, no cloud/GitHub/Slack token shapes on Fair surface.
No `-launchguard` private paths in published Fair app sources.
Fixtures contain public `signerPublicKey` only (expected).
