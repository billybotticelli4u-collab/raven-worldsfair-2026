# EXPORTED_FILE_MANIFEST — raven-worldsfair-2026

Generated: 2026-09-14 (Europe/Rome / CEST).
Strategy: PUBLIC_EXPOSURE_MANIFEST_V2 **Strategy A** (submodule link; PREEXISTING_REQUIRED copies = 0).

## Source tip

| Field | Value |
| --- | --- |
| Fair HEAD | `1ba45d5a787172da648b9da4241f119bcc49e814` |
| Fair TREE | `9205ca7901c0acd12663e628bd9936c1a8eb8c76` |
| Branch | `billy/worldsfair-2026-day1-agent-trust-2026-09-14` |
| Verifier pin | `1b04356a275742752fb7afd8dfcc4269d462a778` |
| Submodule path | `vendor/raven-receipt-verifier` |

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
| `apps/worldsfair-agent-trust/src/lib/ravenVerify.js` | FAIR_NEW |
| `apps/worldsfair-agent-trust/src/lib/runSlice.js` | FAIR_NEW |
| `apps/worldsfair-agent-trust/src/server.js` | FAIR_NEW |
| `apps/worldsfair-agent-trust/src/write-build-info.js` | FAIR_NEW |
| `apps/worldsfair-agent-trust/test/build-info.test.js` | FAIR_NEW |
| `apps/worldsfair-agent-trust/test/vertical-slice.test.js` | FAIR_NEW |
| `docs/hackathon/worldsfair-2026/HACKATHON_CODE_BOUNDARY_DECISION.md` | FAIR_NEW |
| `docs/hackathon/worldsfair-2026/HACKATHON_START_BASELINE.md` | FAIR_NEW |
| `docs/hackathon/worldsfair-2026/JUDGE_QUICKSTART.md` | BUILD_SUPPORT |
| `docs/hackathon/worldsfair-2026/PUBLIC_EXPOSURE_MANIFEST.md` | FAIR_NEW |
| `docs/hackathon/worldsfair-2026/PUBLIC_EXPOSURE_MANIFEST_V2.md` | FAIR_NEW |
| `docs/hackathon/worldsfair-2026/SUBMISSION_CHECKLIST.md` | FAIR_NEW |

## Submodule (not copied foundation sources)

| path | identity |
| --- | --- |
| `vendor/raven-receipt-verifier` (gitlink) | PRE-EXISTING RAVEN FOUNDATION — NOT CRYPTO WORLD'S FAIR WORK; pin `1b04356a275742752fb7afd8dfcc4269d462a778` |
| `.gitmodules` | records URL + path |

## V2 checklist

- [x] apps/worldsfair-agent-trust/** from Fair tip (ravenVerify retargeted)
- [x] docs/hackathon/worldsfair-2026/** including MANIFEST V2
- [x] Public README disclosures 1–7
- [x] LICENSE (Apache-2.0; foundation LICENSE remains upstream)
- [x] .gitignore + .gitmodules
- [x] Submodule pin exact SHA (not floating branch)
- [x] PREEXISTING_REQUIRED file copies: **0**
- [x] No deploy / no npm publish

## Secret scan (pre-push)

No private PEM/OpenSSH keys, no .env, no cloud/GitHub/Slack token shapes on Fair surface.
Fixtures contain public `signerPublicKey` only (expected).
