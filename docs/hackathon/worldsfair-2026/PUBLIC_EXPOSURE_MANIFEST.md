# PUBLIC EXPOSURE MANIFEST — Crypto World's Fair 2026

## Day-2 tip bump (Owner-authorized public successor)

| Field | Value |
| --- | --- |
| Status | Owner Glen authorized public update Day-1 → Day-2 (additive history) |
| Chosen product tip | **Day-2** malformed-clock repair |
| Branch | `billy/worldsfair-2026-day2-malformed-clock-repair-2026-09-14` |
| HEAD | `a5cd592b72d2da1ebf6f0c1e224d05489ff31524` |
| TREE | `3e442f93529bdb5da876b54d484294032535e84a` |
| Worktree | `<home>/raven-rnd-gauntlet-push/wf-day2-malformed-clock-repair` |
| Review | **INTERNAL_ADVERSARIAL_NON_AUTHOR** GO (Billy copy) — **not** EXTERNAL_INDEPENDENT |
| Public strategy | Strategy A (submodule pin unchanged `1b04356a275742752fb7afd8dfcc4269d462a778`) |
| Public parent | Day-1 public `feaa1fb452b8e1307979dea7fd1c561fad82aa00` (preserve history; no rewrite) |
| Deploy / npm | **HOLD** this pass — tip bump only |

Day-2 FAIR_NEW deltas vs Day-1 (app): `protocol.js`, machine-exchange + truth-disclosure +
malformed-clock tests; ravenVerify evaluation-time parse fail-closed; UI truth disclosure;
buildInfo Days 1–2 + Built during competition.

Historical Day-1 draft body retained below for provenance.

---

# PUBLIC EXPOSURE MANIFEST — Crypto World's Fair 2026 (Day-1 judge surface)

**Status:** DRAFT for Owner confirmation. **NOT** an authorization to create a public repo, deploy, push a public remote, or npm-publish.

**Authority:** Owner authorized Fair judge surface; this file is the explicit file-by-file manifest that must be confirmed **before** any public exposure.

**Tip inspected (do not change without re-manifest):**

| Field | Value |
| --- | --- |
| Worktree | `<home>/launchguard-billy-worldsfair-2026-day1` |
| Branch | `billy/worldsfair-2026-day1-agent-trust-2026-09-14` |
| HEAD | `1ba45d5a787172da648b9da4241f119bcc49e814` |
| TREE | `9205ca7901c0acd12663e628bd9936c1a8eb8c76` |
| Contest baseline HEAD | `18b1a13c601cc362404dc6306fd8f4d1cc3e046e` |
| Contest baseline TREE | `6bd7276fb71f8878bd9b3313d7200e56f447a0f3` |
| Manifest drafted (Europe/Rome) | 2026-09-14 ~23:20 CEST (UTC+2) |

**Categories:**

- `FAIR_NEW` — created during Fair 2026 Day-1 product / provenance work
- `PREEXISTING_FOUNDATION_PUBLIC_SAFE` — pre-contest Raven verifier foundation, public-safe to show judges
- `BUILD_SUPPORT` — minimal stubs so judges can build/run without the private monorepo

---

## Proposed public surface (after Owner confirm)

| Item | Proposal |
| --- | --- |
| Public repo name | `raven-worldsfair-2026` under `billybotticelli4u-collab` (alt: `worldsfair-agent-trust-2026`) |
| Repo visibility | **public**, Fair-only subset (not a mirror of `-launchguard`) |
| Exists today? | **No** (`billybotticelli4u-collab/raven-worldsfair-2026` unresolved) |
| Deploy target | `https://ravenattest.com/worldsfair` |
| Vercel project for `/worldsfair` | **Does not exist** in measured `frontline-web-solutions` project list (no `worldsfair*` project). Production `ravenattest.com` currently maps to existing project `raven-launch-console`. Path rewrite / new project **unknown until Owner chooses wiring**. |
| npm publish | **Not required** for judge demo (and not authorized by this manifest) |

### How to vendor / subset `verify-js` without npm publish

Day-1 app imports the verifier by **relative path** (no npm dependency):

`apps/worldsfair-agent-trust/src/lib/ravenVerify.js` → `packages/verify-js/src/index.ts`

**Recommended (Fair-only public repo):**

1. Preserve monorepo-relative layout so the import path stays valid:
   - `apps/worldsfair-agent-trust/**`
   - `packages/verify-js/**` (minimal subset below)
   - `docs/hackathon/worldsfair-2026/**`
2. Copy only the **Solana receipt-v1 kernel** source reachable from `src/index.ts` (11 `.ts` files) + package identity docs (`LICENSE`, `README.md`, `SECURITY.md`, `package.json`).
3. Optionally copy provenance fixture `packages/verify-js/fixtures/receipt-v1/production-receipt-v1-bonk-2026-07-03.json` (demo runtime uses **app-local** fixtures; this file is honesty/provenance).
4. Optionally include `tsconfig.build.json` + `scripts/clean-dist.mjs` and **prebuild `dist/`** into the public tree so Node 22.18 judges do not need TypeScript type-stripping. Current tip imports `.ts` directly (works on measured Node 25; Node 22.18 may need `--experimental-strip-types` unless `dist/` is vendored and the import is pointed at compiled ESM at exposure time).
5. **Do not** npm-publish for Fair. Existing public historyless repo `billybotticelli4u-collab/raven-receipt-verifier` may be cited as related foundation source, but Fair judge repo should remain self-contained via vendored subset (avoids npm + avoids pulling private monorepo).

**Not recommended for Fair judge repo:** root `package.json` / workspaces from `-launchguard` (pulls unrelated apps, husky, express stack). App has zero runtime npm deps.

---

## Proposed public README disclosures (draft text for Owner)

Paste into public root `README.md` only after Owner confirms this manifest.

### PRE-EXISTING RAVEN FOUNDATION vs CRYPTO WORLD'S FAIR WORK

- **Pre-existing (not Fair-created):** Raven `receipt-v1` offline verifier (`packages/verify-js` / package name `raven-receipt-verifier`), production trust-anchor public key material, and the production-shaped BONK receipt vector. Broader Raven monorepo evidence/apps predate contest start and are **out of scope** for this Fair-only repo.
- **Fair 2026 work:** Agent A / Agent B orchestration, fail-closed PROCEED/REFUSE decision surface, judge-facing web UI + About/Build Info honesty, Fair app tests, and provenance docs under `docs/hackathon/worldsfair-2026/`.
- **Uses pre-existing receipt/verifier foundation.** Fair does **not** invent a toy verifier.
- **Agent orchestration/UX built during Fair 2026** (after official contest start `2026-09-14T06:00:00-07:00` America/Los_Angeles).

### Fixture / demo clock pinning (not live Solana acquisition)

- Demo PATH A/B uses **offline fixtures** under `apps/worldsfair-agent-trust/fixtures/` (valid / tampered / wrong-subject claim metadata).
- Verification clock is pinned via `BONK_FIXTURE_NOW` (`2026-06-26T11:46:31.000Z`) so freshness is not falsely stale against the fixture receipt. This is **not** a live Solana RPC acquisition at judge runtime.
- Valid fixture content matches the pre-existing production BONK receipt JSON object used for provenance (byte formatting may differ; semantic identity preserved).

### Independent review status

- Day-1 vertical slice received **`INTERNAL_ADVERSARIAL_NON_AUTHOR` GO** (re-measurement report dated 2026-09-14; tip HEAD/TREE matched).
- Status is **`NOT EXTERNAL_INDEPENDENT`**.
- This surface does **not** claim external validation, Owner publish authorization, merge-to-main, production deploy authorization, or npm release authorization.

### Judge quickstart (intended)

```bash
# Node >= 22.18 (Node 25 verified in-house). If importing .ts fails on 22.x:
#   export NODE_OPTIONS=--experimental-strip-types
cd apps/worldsfair-agent-trust
npm test
npm start   # http://127.0.0.1:8787
```

---

## INCLUDE — explicit file manifest

| path | category | reason | risk notes |
| --- | --- | --- | --- |
| `apps/worldsfair-agent-trust/package.json` | FAIR_NEW | App identity, engines, scripts (`start`/`test`/`build`) | No secrets; private:true OK to keep or drop for public |
| `apps/worldsfair-agent-trust/README.md` | FAIR_NEW | App-local run instructions | Expand via root README disclosures above |
| `apps/worldsfair-agent-trust/PRODUCT.md` | FAIR_NEW | Claim / PATH A+B / foundation vs Fair honesty | References monorepo fixture path — keep or retarget wording at exposure |
| `apps/worldsfair-agent-trust/src/server.js` | FAIR_NEW | HTTP demo server | Binds `HOST`/`PORT` env only; default `127.0.0.1:8787` |
| `apps/worldsfair-agent-trust/src/write-build-info.js` | FAIR_NEW | Build-info generator for About panel | Reads git/env; no secrets |
| `apps/worldsfair-agent-trust/src/lib/agentA.js` | FAIR_NEW | Agent A fail-closed decision | Pins demo `now` via `BONK_FIXTURE_NOW` — disclose |
| `apps/worldsfair-agent-trust/src/lib/agentB.js` | FAIR_NEW | Agent B claim + fixture evidence | Offline fixtures only |
| `apps/worldsfair-agent-trust/src/lib/ravenVerify.js` | FAIR_NEW | Loads pre-existing verifier; clock pin constant | Relative import to `packages/verify-js` must remain valid after vendor |
| `apps/worldsfair-agent-trust/src/lib/runSlice.js` | FAIR_NEW | PATH A/B orchestration | — |
| `apps/worldsfair-agent-trust/src/lib/buildInfo.js` | FAIR_NEW | Foundation vs Fair labels for UI | Honesty-critical |
| `apps/worldsfair-agent-trust/public/index.html` | FAIR_NEW | Judge UI shell | — |
| `apps/worldsfair-agent-trust/public/app.js` | FAIR_NEW | Judge UI client | — |
| `apps/worldsfair-agent-trust/public/styles.css` | FAIR_NEW | Judge UI styles | — |
| `apps/worldsfair-agent-trust/fixtures/bonk-valid-receipt.json` | FAIR_NEW | PATH A offline evidence | Public receipt bytes + **public** signer SPKI; no private key |
| `apps/worldsfair-agent-trust/fixtures/bonk-tampered-receipt.json` | FAIR_NEW | PATH B controlled defect | Intentionally invalid |
| `apps/worldsfair-agent-trust/fixtures/bonk-wrong-subject-claim.json` | FAIR_NEW | Wrong-subject scenario metadata | — |
| `apps/worldsfair-agent-trust/test/vertical-slice.test.js` | FAIR_NEW | Verified/refused/missing/exception tests | — |
| `apps/worldsfair-agent-trust/test/build-info.test.js` | FAIR_NEW | Build-info honesty tests | — |
| `docs/hackathon/worldsfair-2026/HACKATHON_START_BASELINE.md` | FAIR_NEW | Contest start vs baseline freeze | Contains private monorepo remote URL — OK as provenance; do not expand into other private paths |
| `docs/hackathon/worldsfair-2026/HACKATHON_CODE_BOUNDARY_DECISION.md` | FAIR_NEW | Option A boundary | Mentions sibling private apps by name only |
| `docs/hackathon/worldsfair-2026/SUBMISSION_CHECKLIST.md` | FAIR_NEW | Submission targets | Update independent-review checkbox language to INTERNAL_ADVERSARIAL_NON_AUTHOR at exposure |
| `docs/hackathon/worldsfair-2026/PUBLIC_EXPOSURE_MANIFEST.md` | FAIR_NEW | This manifest | Keep in public Fair repo as transparency artifact |
| `packages/verify-js/src/index.ts` | PREEXISTING_FOUNDATION_PUBLIC_SAFE | Frozen public Solana kernel export map | Do not re-export proposed EVM/manifest APIs |
| `packages/verify-js/src/verifyReceiptV1.ts` | PREEXISTING_FOUNDATION_PUBLIC_SAFE | Core offline verify | Public crypto verify only |
| `packages/verify-js/src/verifyReceiptV1ForSubject.ts` | PREEXISTING_FOUNDATION_PUBLIC_SAFE | Subject binding used by Fair app | Required by `ravenVerify.js` |
| `packages/verify-js/src/trustAnchor.ts` | PREEXISTING_FOUNDATION_PUBLIC_SAFE | `ravenProductionTrustedKeys()` | Embeds **public** Ed25519 SPKI only (not a signing private key) |
| `packages/verify-js/src/receiptV1.ts` | PREEXISTING_FOUNDATION_PUBLIC_SAFE | Receipt-v1 constants/types | — |
| `packages/verify-js/src/receiptRules.ts` | PREEXISTING_FOUNDATION_PUBLIC_SAFE | Rules evaluation | — |
| `packages/verify-js/src/canonicalJson.ts` | PREEXISTING_FOUNDATION_PUBLIC_SAFE | Canonical JSON | — |
| `packages/verify-js/src/canonicalDataSnapshot.ts` | PREEXISTING_FOUNDATION_PUBLIC_SAFE | Reachable from kernel graph | — |
| `packages/verify-js/src/solanaAddress.ts` | PREEXISTING_FOUNDATION_PUBLIC_SAFE | Address canonicality | — |
| `packages/verify-js/src/detect.ts` | PREEXISTING_FOUNDATION_PUBLIC_SAFE | Namespace detect (exported) | — |
| `packages/verify-js/src/outcomeProjection.ts` | PREEXISTING_FOUNDATION_PUBLIC_SAFE | Finding outcome projection (exported) | — |
| `packages/verify-js/package.json` | PREEXISTING_FOUNDATION_PUBLIC_SAFE | Package name `raven-receipt-verifier@0.1.0` | README already discloses unpublished-on-npm status |
| `packages/verify-js/LICENSE` | PREEXISTING_FOUNDATION_PUBLIC_SAFE | Apache-2.0 | Required |
| `packages/verify-js/README.md` | PREEXISTING_FOUNDATION_PUBLIC_SAFE | Verifier public docs / trust bootstrap | Align Fair README so Fair does not claim verifier invention |
| `packages/verify-js/SECURITY.md` | PREEXISTING_FOUNDATION_PUBLIC_SAFE | Security contact / policy | — |
| `packages/verify-js/fixtures/receipt-v1/production-receipt-v1-bonk-2026-07-03.json` | PREEXISTING_FOUNDATION_PUBLIC_SAFE | Provenance source for BONK vector | Not runtime-imported by Fair app (app has own copy); include for honesty |
| `packages/verify-js/tsconfig.build.json` | BUILD_SUPPORT | Optional: build `dist/` for judges without type-stripping | Include if exposure chooses prebuild path |
| `packages/verify-js/scripts/clean-dist.mjs` | BUILD_SUPPORT | Optional: clean step for `npm run build` in verify-js | Include only with tsconfig.build.json |
| `README.md` (public repo root; **create at exposure**) | BUILD_SUPPORT | Fair disclosures + quickstart | Content drafted above; not yet a tip file |
| `.gitignore` (public repo root; **create at exposure**) | BUILD_SUPPORT | Ignore `node_modules/`, `.env*`, `dist` locals, OS junk | Prevent accidental secret commit |

### Optional INCLUDE (Owner may approve; not required for Day-1 demo run)

| path | category | reason | risk notes |
| --- | --- | --- | --- |
| `packages/verify-js/dist/**` (generated at exposure) | BUILD_SUPPORT | Prebuilt ESM for Node 22.18 without strip-types | Must be regenerated from listed `src/` only; do not pull unrelated monorepo build artifacts |
| Sanitized one-page review status note under `docs/hackathon/worldsfair-2026/` | FAIR_NEW | States INTERNAL_ADVERSARIAL_NON_AUTHOR GO; NOT EXTERNAL_INDEPENDENT | Do **not** dump private NOTES worktrees wholesale |

---

## EXCLUDE — must not appear on Fair public surface

| path / class | why excluded |
| --- | --- |
| Secrets, `.env*`, credentials, API tokens, SSH keys, signing **private** keys | Credential exposure |
| `docs/hackathon/prestart-governance/**` (Owner ceremony, CEC, trust-root bootstrap) | Private governance / Owner ceremony |
| Ed25519 governance **profile acceptance** / Owner-acceptance branches beyond Fair disclosure of public trust-anchor SPKI | Private governance acceptance lane |
| Unpublished security research / `raven-rnd*` / gauntlet hostile corpora | Research surface, not Fair demo |
| Unrelated monorepo apps (`apps/launchguard-acp`, `apps/raven-site`, Solana scanners, CRM, Telegram bots, etc.) | Out of Fair scope; may contain private ops |
| ACP private / customer / CRM materials | Private |
| Root `-launchguard` `package.json` workspaces / husky / express app | Unnecessary; expands blast radius |
| `packages/verify-js/src/keyManifest.ts`, `proposed.ts`, `receiptEvmV1.ts`, `verifyReceiptEvmV1.ts` | Not on Day-1 import graph; proposed/non-frozen surface — omit from minimal Fair subset |
| `packages/verify-js/fixtures/receipt-evm-v1/**` and non-BONK receipt-v1 vector farms | Not required for offline Day-1 demo |
| `packages/verify-js/test/**` (unless Owner wants extra judge confidence) | Minimize; tests generate ephemeral keypairs only — still optional |
| Full private review NOTES tree under `<home>/raven-rnd-gauntlet-push/*-NOTES` | Local review artifacts; disclose status, do not bulk-publish |
| Any `gh repo create` / Vercel deploy / npm publish artifacts created without Owner confirm | Process exclusion |

---

## Counts (INCLUDE required rows)

| category | file count |
| --- | --- |
| FAIR_NEW | **22** (18 app + 3 prior docs + this manifest) |
| PREEXISTING_FOUNDATION_PUBLIC_SAFE | **16** (11 kernel `.ts` + 4 package docs/meta + 1 production BONK fixture) |
| BUILD_SUPPORT (in-repo today) | **2** (`tsconfig.build.json`, `scripts/clean-dist.mjs`) |
| BUILD_SUPPORT (create at exposure) | **2** (root `README.md`, `.gitignore`) — not on tip yet |
| **TOTAL required on tip paths** | **40** |
| **TOTAL after exposure stubs** | **42** (+ optional `dist/**`) |

---

## Secrets / blockers found during inspection

| finding | severity | notes |
| --- | --- | --- |
| No `.env` / credential files under Fair app, Fair docs, or `packages/verify-js` runtime paths | OK | Regex scan clean for private PEM / obvious tokens in Fair surface |
| Trust anchor carries **public** SPKI only (44-byte Ed25519 SPKI) | OK | Not a blocker; must not be confused with private signing key |
| `verify-js` tests (excluded) generate ephemeral `privateKey` in-process | N/A if excluded | Do not include test helpers that could confuse reviewers if misread as production keys |
| Node import of `.ts` | Process note | Judges on Node 22.18 may need `--experimental-strip-types` or vendored `dist/` |
| No Vercel `worldsfair` project | Process blocker for deploy-only | Repo exposure can proceed without deploy; `/worldsfair` path wiring needs Owner choice |
| Private monorepo remains private | Intentional | Fair public repo must be a **subset copy**, not `gh repo edit --visibility public` on `-launchguard` |

---

## Recommended next step

1. **Owner confirms this manifest** (include/exclude, repo name, deploy wiring yes/no).
2. Only then: create public `billybotticelli4u-collab/raven-worldsfair-2026`, copy listed files (vendor verify-js subset), add root README disclosures + `.gitignore`.
3. Optionally deploy to `ravenattest.com/worldsfair` via new Vercel project or rewrite on existing `raven-launch-console` / `raven-site` — **Owner chooses**; project does not exist today.
4. **STOP** — no public repo create, no deploy, no npm publish, no public push performed by this manifest pass.

---

## Executor attestation

- Inspected tip HEAD/TREE match mission.
- Day-1 tests re-run in worktree: `apps/worldsfair-agent-trust` vertical-slice **8/8 pass**.
- No `gh repo create`, no Vercel deploy, no npm publish, no push to a new public remote in this pass.
- File written locally only: `docs/hackathon/worldsfair-2026/PUBLIC_EXPOSURE_MANIFEST.md`.
