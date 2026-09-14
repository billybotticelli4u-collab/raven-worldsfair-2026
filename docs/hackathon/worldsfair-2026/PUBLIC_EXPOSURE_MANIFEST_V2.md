# PUBLIC EXPOSURE MANIFEST V2 — Crypto World's Fair 2026 (judge surface)

**Status:** REVISED DRAFT for **Owner final publication auth**.  
**Owner stance:** APPROVED IN PRINCIPLE with **revise-before-publication** (this file).  
**NOT** an authorization to create a public repo, deploy, push a public remote, or npm-publish.

**Revision goal vs V1:** Minimize copied pre-existing Raven implementation. Prefer **consume/link** the already-public `billybotticelli4u-collab/raven-receipt-verifier` rather than vendoring the prior 16-file `packages/verify-js` set for provenance convenience. Label any unavoidable pre-existing copy: **PRE-EXISTING RAVEN FOUNDATION — NOT CRYPTO WORLD'S FAIR WORK**.

**Manifest drafted (Europe/Rome):** 2026-09-14 ~23:35 CEST (UTC+2)

---

## 1. Exact source Fair HEAD / TREE / branch

| Field | Value | Notes |
| --- | --- | --- |
| **Chosen product tip** | **Day-1** | Day-2 exists but **lacks** measured non-author GO (see §1.1) |
| Worktree | `/Users/ROBY/launchguard-billy-worldsfair-2026-day1` | Fair Day-1 worktree |
| Branch | `billy/worldsfair-2026-day1-agent-trust-2026-09-14` | also on `origin` |
| **HEAD** | `1ba45d5a787172da648b9da4241f119bcc49e814` | matches mission Day-1 tip |
| **TREE** | `9205ca7901c0acd12663e628bd9936c1a8eb8c76` | matches mission Day-1 tree |
| Contest baseline HEAD | `18b1a13c601cc362404dc6306fd8f4d1cc3e046e` | pre-Fair `origin/main` freeze |
| Contest baseline TREE | `6bd7276fb71f8878bd9b3313d7200e56f447a0f3` | |
| Independent review of chosen tip | **GO** — `INTERNAL_ADVERSARIAL_NON_AUTHOR` | `raven-rnd-gauntlet-push/wf-day1-indep-review-1ba45d5a-NOTES/INDEPENDENT_REVIEW_A_S.md` (Billy copy-GO class; **not** EXTERNAL_INDEPENDENT; **not** Owner publish auth) |

### 1.1 Day-2 inspected — not chosen as publication tip

| Tip | Branch | HEAD | TREE | Non-author GO? |
| --- | --- | --- | --- | --- |
| Day-2 Billy tip (latest Fair product) | `billy/worldsfair-2026-day2-truth-disclosure-2026-09-14` (`origin` same) | `a10364771953a0af270833807e500a7cc12dfdd7` | `496a11635b9aab3fb18359148e2bc1c981fac33d` | **NO** — no `*-NOTES` / independent review GO found for `a103647` |
| Day-2 Codex ancestor | `codex/worldsfair-2026-day2-m2m-2026-09-14` | `56761aa75a1f5fcd0e46eef0ed9dd0d6d5d9de16` | `83cbb31d020f698f6f205a99ba4803fd2e53b082` | **NO** — worktree `wf-day2-truth-disclosure-56761aa` exists without review NOTES |

**Rule applied:** use Day-2 tip only if independently reviewed with non-author GO; else Day-1 `1ba45d5a` / `9205ca79`.  
**Day-2 delta (informational only; not in this manifest’s FAIR_NEW):** machine evidence exchange + fixture evaluation-time disclosure (`protocol.js`, `machine-exchange.test.js`, `truth-disclosure.test.js`, plus edits to agents/UI/ravenVerify). Hold Day-2 for a future tip bump **after** non-author GO + Owner re-auth.

---

## 2. Proposed public surface (after Owner **final** auth)

| Item | Proposal |
| --- | --- |
| Public repo | `billybotticelli4u-collab/raven-worldsfair-2026` |
| Exists today? | **No** (API 404) |
| Visibility | **public**, Fair-only subset — **never** flip `-launchguard` public |
| Judge URL (prefer) | `https://ravenattest.com/worldsfair` |
| Deploy | **HOLD** until exact product head passes non-author review **and** Owner final auth (Day-1 already has Billy copy GO; deploy still Owner-gated) |
| npm publish | **Not required**; **not authorized** |

Primary contents (post-auth only):

1. `apps/worldsfair-agent-trust/**` Fair work (from chosen tip)
2. `docs/hackathon/worldsfair-2026/**` (incl. this V2 manifest)
3. Public root `README.md` + `LICENSE` / build support
4. Public-safe Fair fixtures (app-local)
5. **Verifier:** link/consume public foundation — **do not** auto-expose the prior 16-file verify-js copy set

---

## 3. How Fair imports verify-js today (exact)

`apps/worldsfair-agent-trust/src/lib/ravenVerify.js` dynamically imports:

```text
../../../../packages/verify-js/src/index.ts
```

and calls:

- `verifyReceiptV1ForSubject(receipt, expectedSubject, { trustedKeys, now? })`
- `ravenProductionTrustedKeys()`

No npm dependency today (`package.json` has zero runtime deps). Relative monorepo path must be **retargeted at exposure** if verify-js is not copied.

---

## 4. Public `raven-receipt-verifier` options (measured 2026-09-14)

| Probe | Result |
| --- | --- |
| `npm view raven-receipt-verifier` | **404** — not on npm registry (unchanged historically) |
| Public repo | **Exists:** `https://github.com/billybotticelli4u-collab/raven-receipt-verifier` (public, Apache-2.0) |
| Default branch tip | `main` @ `1b04356a275742752fb7afd8dfcc4269d462a778` (2026-09-02 historyless 0.1.0 release source) |
| Layout | Monorepo-shaped; package lives at `packages/verify-js/` |
| `dist/` on tip | **Absent** — `package.json` `exports` point at `./dist/*` but compiled artifacts are not in the public tree |
| Exports Fair needs | **Present** in `packages/verify-js/src/index.ts`: `verifyReceiptV1ForSubject`, `ravenProductionTrustedKeys`, `RAVEN_PRODUCTION_TRUST_ANCHOR` |
| Kernel blob match vs Day-1 monorepo `packages/verify-js` | **9/11 MATCH**; **DIFF** on `verifyReceiptV1.ts` + `verifyReceiptV1ForSubject.ts` (monorepo trust-axis successor after public snapshot: e.g. `trust_config_missing` vs older `trust_config_invalid` wording) |
| Fair call-path adequacy | **ADEQUATE for Day-1 PATH A/B** — Fair always supplies `trustedKeys: ravenProductionTrustedKeys()` and pins `now` via `BONK_FIXTURE_NOW`; required symbols exist on public tip |
| Older sibling `raven-receipt-verify` | Public root package exists but is a different/older surface — **do not** use for Fair; stick to `raven-receipt-verifier` |

---

## 5. MINIMAL dependency strategy (Owner-facing decision)

### Strategy A — **PREFERRED** (no pre-existing source copy)

**Do not** copy the V1 16-file `packages/verify-js` set into the Fair public repo.

At Owner-authorized exposure time only:

1. Add a **git submodule** (or documented sparse checkout) of  
   `https://github.com/billybotticelli4u-collab/raven-receipt-verifier`  
   pinned to `1b04356a275742752fb7afd8dfcc4269d462a778`  
   at e.g. `third_party/raven-receipt-verifier/`.
2. One Fair-only import retarget in `ravenVerify.js` (exposure patch, still FAIR_NEW):

   ```js
   // PRE-EXISTING RAVEN FOUNDATION — NOT CRYPTO WORLD'S FAIR WORK
   // Linked from public billybotticelli4u-collab/raven-receipt-verifier@1b04356a
   const VERIFY_JS_ENTRY = fileURLToPath(
     new URL(
       "../../../third_party/raven-receipt-verifier/packages/verify-js/src/index.ts",
       import.meta.url,
     ),
   );
   ```

   (Exact relative path may vary with chosen submodule location; keep comment label mandatory.)
3. Judges run with Node `>=22.18` and, when importing `.ts`,  
   `NODE_OPTIONS=--experimental-strip-types` (or Node 25+ as measured in-house).
4. Optional later: build `packages/verify-js` `dist/` **inside the submodule working tree** and switch import to compiled ESM — still without copying monorepo sources into Fair tree.
5. Root README discloses submodule pin + “PRE-EXISTING RAVEN FOUNDATION — NOT CRYPTO WORLD'S FAIR WORK”.

**PREEXISTING_REQUIRED file copies: none (empty).**

**Why not npm git dependency alone?** Public repo root is not the npm package root (`packages/verify-js/`); npm cannot install that subdirectory as `raven-receipt-verifier` without a packed tarball or npm publish (both out of scope / unauthorized). Submodule + path import is the minimal reproducible link.

### Strategy B — **FALLBACK only if Owner rejects A**

Copy the minimal Solana kernel with per-file necessity (each labeled **PRE-EXISTING RAVEN FOUNDATION — NOT CRYPTO WORLD'S FAIR WORK**). Prefer copying from **public** `raven-receipt-verifier@1b04356a` (not private monorepo) so publication does not invent a new private→public channel.

| path (under Fair repo) | necessity |
| --- | --- |
| `packages/verify-js/src/index.ts` | Export map; Fair dynamic import entry |
| `packages/verify-js/src/verifyReceiptV1ForSubject.ts` | **Required API** used by `ravenVerify.js` |
| `packages/verify-js/src/verifyReceiptV1.ts` | Integrity/freshness/key trust kernel called by subject wrapper |
| `packages/verify-js/src/trustAnchor.ts` | `ravenProductionTrustedKeys()` — **required API** |
| `packages/verify-js/src/receiptV1.ts` | Receipt-v1 constants/types reachable from kernel |
| `packages/verify-js/src/receiptRules.ts` | Reachable from kernel / export map |
| `packages/verify-js/src/canonicalJson.ts` | Canonicalization used by verify |
| `packages/verify-js/src/canonicalDataSnapshot.ts` | Reachable from kernel graph |
| `packages/verify-js/src/solanaAddress.ts` | Subject address canonicality |
| `packages/verify-js/src/detect.ts` | Exported; on frozen public surface |
| `packages/verify-js/src/outcomeProjection.ts` | Exported; on frozen public surface |
| `packages/verify-js/package.json` | Package identity `raven-receipt-verifier@0.1.0` |
| `packages/verify-js/LICENSE` | Apache-2.0 license file |
| `packages/verify-js/README.md` | Trust-bootstrap / non-invention honesty |
| `packages/verify-js/SECURITY.md` | Security contact policy |
| `packages/verify-js/fixtures/receipt-v1/production-receipt-v1-bonk-2026-07-03.json` | **Optional** provenance only — **not** runtime-imported by Fair app |

**Explicitly do NOT auto-include** for Fair convenience: `keyManifest.ts`, `proposed.ts`, `receiptEvmV1.ts`, `verifyReceiptEvmV1.ts`, EVM fixtures, ACP fixture farms, verify-js `test/**`.

**This V2 default remains Strategy A** unless Owner explicitly selects B.

---

## 6. FAIR_NEW files (complete list — Day-1 tip `1ba45d5a`)

All created during Fair 2026 Day-1 product / provenance work (after contest start). Count = **22** tip paths + **1** this V2 file written in worktree (uncommitted) = **23** for exposure set.

### App (`apps/worldsfair-agent-trust/`) — 18

| path | role |
| --- | --- |
| `apps/worldsfair-agent-trust/package.json` | App identity / engines / scripts |
| `apps/worldsfair-agent-trust/README.md` | App-local run instructions |
| `apps/worldsfair-agent-trust/PRODUCT.md` | Claim / PATH A+B / foundation vs Fair honesty |
| `apps/worldsfair-agent-trust/src/server.js` | HTTP demo server |
| `apps/worldsfair-agent-trust/src/write-build-info.js` | Build-info generator |
| `apps/worldsfair-agent-trust/src/lib/agentA.js` | Agent A fail-closed decision |
| `apps/worldsfair-agent-trust/src/lib/agentB.js` | Agent B claim + fixture evidence |
| `apps/worldsfair-agent-trust/src/lib/ravenVerify.js` | Loads Raven verifier; clock pin |
| `apps/worldsfair-agent-trust/src/lib/runSlice.js` | PATH A/B orchestration |
| `apps/worldsfair-agent-trust/src/lib/buildInfo.js` | Foundation vs Fair UI labels |
| `apps/worldsfair-agent-trust/public/index.html` | Judge UI shell |
| `apps/worldsfair-agent-trust/public/app.js` | Judge UI client |
| `apps/worldsfair-agent-trust/public/styles.css` | Judge UI styles |
| `apps/worldsfair-agent-trust/fixtures/bonk-valid-receipt.json` | PATH A offline evidence |
| `apps/worldsfair-agent-trust/fixtures/bonk-tampered-receipt.json` | PATH B controlled defect |
| `apps/worldsfair-agent-trust/fixtures/bonk-wrong-subject-claim.json` | Wrong-subject scenario metadata |
| `apps/worldsfair-agent-trust/test/vertical-slice.test.js` | Verified/refused/missing/exception |
| `apps/worldsfair-agent-trust/test/build-info.test.js` | Build-info honesty |

### Docs (`docs/hackathon/worldsfair-2026/`) — 5 (3 on tip + V1 + V2)

| path | role |
| --- | --- |
| `docs/hackathon/worldsfair-2026/HACKATHON_START_BASELINE.md` | Contest start vs baseline freeze |
| `docs/hackathon/worldsfair-2026/HACKATHON_CODE_BOUNDARY_DECISION.md` | Option A boundary |
| `docs/hackathon/worldsfair-2026/SUBMISSION_CHECKLIST.md` | Submission targets |
| `docs/hackathon/worldsfair-2026/PUBLIC_EXPOSURE_MANIFEST.md` | V1 (superseded by V2 for auth; keep for audit trail) |
| `docs/hackathon/worldsfair-2026/PUBLIC_EXPOSURE_MANIFEST_V2.md` | **This file** — Owner final-auth surface |

**Exposure-time Fair-only edits (still FAIR_NEW, not tip today):**

- Retarget `ravenVerify.js` import under Strategy A
- Root `README.md` / `.gitignore` / root `LICENSE` (see BUILD_SUPPORT)
- Optional `.gitmodules` pin

---

## 7. PREEXISTING_REQUIRED

| Strategy | PREEXISTING_REQUIRED |
| --- | --- |
| **A (default)** | **Empty** — package/repo **link** via submodule pin `raven-receipt-verifier@1b04356a`; no foundation source files copied into Fair tree |
| B (Owner override) | See §5 Strategy B table (≤16 labeled files; prefer public tip bytes) |

Any linked or copied foundation file/path must carry the judge-visible label:

> **PRE-EXISTING RAVEN FOUNDATION — NOT CRYPTO WORLD'S FAIR WORK**

---

## 8. BUILD_SUPPORT

| artifact | category | notes |
| --- | --- | --- |
| Root `README.md` (create at exposure) | BUILD_SUPPORT | Disclosures in §10 + quickstart + submodule pin |
| Root `LICENSE` (create at exposure) | BUILD_SUPPORT | Apache-2.0 (align with Fair app + verifier) |
| Root `.gitignore` (create at exposure) | BUILD_SUPPORT | Ignore `node_modules/`, `.env*`, OS junk, local secrets |
| `.gitmodules` + `third_party/raven-receipt-verifier` (Strategy A) | BUILD_SUPPORT | Pin public verifier; **not** a copy of private monorepo |
| Optional: short `docs/hackathon/worldsfair-2026/JUDGE_QUICKSTART.md` | BUILD_SUPPORT | `git submodule update --init`, `NODE_OPTIONS`, `npm test` / `npm start` |

**Not included:** root `-launchguard` workspaces/`package.json`, husky, unrelated apps, Vercel project files, npm publish workflow.

---

## 9. Fixture provenance

| fixture | provenance | notes |
| --- | --- | --- |
| `fixtures/bonk-valid-receipt.json` | **Production-derived** | Sorted-JSON-equal to `packages/verify-js/fixtures/receipt-v1/production-receipt-v1-bonk-2026-07-03.json`; Day-1 tip pretty-printed (byte length differs; content equal under sorted JSON) |
| `fixtures/bonk-tampered-receipt.json` | **Fair-local** | Controlled integrity defect derived from valid vector |
| `fixtures/bonk-wrong-subject-claim.json` | **Fair-local** | Claim metadata for wrong-subject path — not a live chain fetch |
| Demo clock `BONK_FIXTURE_NOW` | **Fair demo pin** | `2026-06-26T11:46:31.000Z` — **not** wall clock; **not** live Solana acquisition |

Disclose in README: offline fixtures; no live RPC required for PATH A/B.

---

## 10. Exclusions (must not appear on Fair public surface)

| excluded | why |
| --- | --- |
| Secrets, `.env*`, credentials, API tokens, SSH keys, signing **private** keys | Credential exposure |
| Private monorepo `-launchguard` as a whole / flipping visibility | Out of scope; blast radius |
| `docs/hackathon/prestart-governance/**`, Owner ceremony / CEC / trust-root bootstrap | Private governance |
| Ed25519 governance Owner-acceptance lanes beyond public trust-anchor SPKI disclosure | Private governance |
| `raven-rnd*`, gauntlet hostile corpora, unpublished research NOTES trees | Research, not Fair demo |
| Unrelated apps (ACP, scanners, site, Telegram, CRM, etc.) | Out of Fair scope |
| Auto-expose of prior **16-file verify-js convenience set** when Strategy A works | Owner revise goal |
| Proposed/non-frozen verify-js modules (`keyManifest`, EVM receipt drafts) | Not on Fair import path |
| `gh repo create` / Vercel deploy / npm publish without Owner **final** auth | Process |
| Day-2 tip `a103647` until non-author GO + Owner tip bump | Review gate |

---

## 11. Secret scan result (chosen tip Fair surface)

Scanned `apps/worldsfair-agent-trust/**` + `docs/hackathon/worldsfair-2026/**` at `1ba45d5a` for private PEM/OpenSSH headers, obvious cloud/GitHub/Slack token shapes.

| finding | severity |
| --- | --- |
| No private key / credential matches on Fair app + Fair docs paths | **OK** |
| Trust anchor embeds **public** Ed25519 SPKI only (`rvk_c2997e90215279c2`) | **OK** — not a signing private key; label as public trust material |
| Fixtures contain public receipt bytes + public `signerPublicKey` | **OK** |

---

## 12. Disclosure text judges will see (verbatim draft README snippets)

Paste into public root `README.md` only after Owner **final** auth.

```markdown
# Raven × Crypto World's Fair 2026 — Agent Trust demo

Judge demo: Agent A refuses blind trust, requires Raven-verified Solana
receipt-v1 evidence from Agent B, then PROCEED / REFUSE fail-closed.

**Preferred live URL (when Owner authorizes deploy):**
https://ravenattest.com/worldsfair

## PRE-EXISTING RAVEN FOUNDATION — NOT CRYPTO WORLD'S FAIR WORK

- Raven `receipt-v1` offline verifier (`raven-receipt-verifier` /
  historically `packages/verify-js` in the private monorepo), production
  trust-anchor **public** key material, and the production-shaped BONK
  receipt vector predate contest start.
- This Fair repo **links** the already-public foundation repository
  `billybotticelli4u-collab/raven-receipt-verifier` (pinned commit
  `1b04356a…`) instead of re-publishing private monorepo history.
- Fair does **not** invent a toy verifier.

## CRYPTO WORLD'S FAIR 2026 WORK

- Agent A / Agent B orchestration, fail-closed PROCEED/REFUSE,
  judge-facing web UI + About/Build Info honesty, Fair app tests, and
  provenance docs under `docs/hackathon/worldsfair-2026/`.
- Built after official contest start
  `2026-09-14T06:00:00-07:00` (America/Los_Angeles).

## Fixtures / clock (not live Solana acquisition)

- PATH A/B use **offline fixtures** under
  `apps/worldsfair-agent-trust/fixtures/`.
- Verification clock is pinned (`BONK_FIXTURE_NOW`) so freshness is not
  falsely stale — deterministic demo time, not wall clock.

## Quickstart

```bash
git clone https://github.com/billybotticelli4u-collab/raven-worldsfair-2026
cd raven-worldsfair-2026
git submodule update --init --recursive
export NODE_OPTIONS=--experimental-strip-types   # if importing .ts on Node 22.x
cd apps/worldsfair-agent-trust
npm test
npm start   # http://127.0.0.1:8787
```

## Review / deploy honesty

- Day-1 product tip `1ba45d5a` / tree `9205ca79` carries
  INTERNAL_ADVERSARIAL_NON_AUTHOR GO (not EXTERNAL_INDEPENDENT).
- This repository is **not** Owner production-publish authorization by itself.
- Deploy to `/worldsfair` remains held until Owner final auth on the exact
  product head.
```

---

## 13. Deploy note

- **HOLD deploy** until Owner **final** publication auth on the exact product head.
- Day-1 already has Billy-class copy GO (`INTERNAL_ADVERSARIAL_NON_AUTHOR`); that is **necessary but not sufficient** for deploy.
- Prefer judge URL path **`/worldsfair`** on `ravenattest.com`.
- No Vercel `worldsfair*` project was assumed created by this pass; wiring is Owner choice after auth.
- **This pass:** no `gh repo create`, no Vercel deploy, no npm publish, no public push.

---

## 14. Counts (V2 vs V1)

| category | V1 | V2 (Strategy A default) |
| --- | --- | --- |
| FAIR_NEW (tip app+docs) | 22 | **22** tip + **V2 manifest** (worktree) |
| PREEXISTING_REQUIRED copies | 16 | **0** (link public repo instead) |
| BUILD_SUPPORT create-at-exposure | 2+ | Root README, LICENSE, `.gitignore`, `.gitmodules` / submodule |
| Auto-expose verify-js convenience set | yes | **no** |

---

## 15. Blockers / residuals for Owner

1. **Final auth** required before public repo create / push / deploy.
2. Day-2 `a103647` product improvements exist but **block tip bump** until non-author GO.
3. Public verifier tip ≠ monorepo verify-js tip on 2 kernel files — Adequacy OK for Fair PATH A/B with explicit trustedKeys; disclose pin `1b04356a`.
4. Public verifier has **no `dist/`** — judges need strip-types **or** a documented build-in-submodule step.
5. npm package still **404** — do not tell judges to `npm install raven-receipt-verifier` from registry.
6. Import retarget + submodule are **exposure-time** Fair edits (not on `1ba45d5a` tip yet).

---

## 16. Ready-for-Owner-final-auth summary

- Revised manifest written: `docs/hackathon/worldsfair-2026/PUBLIC_EXPOSURE_MANIFEST_V2.md`
- Tip chosen: **Day-1** `1ba45d5a` / `9205ca79` (Day-2 lacks non-author GO)
- Dependency strategy: **A — link public `raven-receipt-verifier@1b04356a` via submodule; PREEXISTING_REQUIRED = 0**
- FAIR_NEW: 18 app + 3 tip docs + V1/V2 manifests; no 16-file foundation copy by default
- Secret scan: clean on Fair surface
- Deploy: hold; prefer `/worldsfair`
- **STOP** — awaiting Owner final publication authorization

---

## Executor attestation

- Searched Day-2 branches/commits under `/Users/ROBY` + remotes (`billy/worldsfair*`, `codex/worldsfair*`).
- Inspected Fair `ravenVerify.js` imports and public verifier adequacy.
- Verified `npm view raven-receipt-verifier` → 404; public GitHub repo exists.
- Wrote V2 only; **no** `gh repo create`, **no** Vercel deploy, **no** npm publish, **no** public push.
