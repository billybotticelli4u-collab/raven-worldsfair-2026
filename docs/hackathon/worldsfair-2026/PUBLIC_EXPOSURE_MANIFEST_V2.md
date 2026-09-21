# PUBLIC EXPOSURE MANIFEST V2 — Crypto World's Fair 2026 (judge surface)

**Status:** Owner Glen authorized **Day-2 public tip bump** (Strategy A additive history).  
**NOT** an authorization to deploy, touch ravenattest.com DNS, or npm-publish.

**Revision goal vs V1:** Minimize copied pre-existing Raven implementation. Prefer **consume/link** the already-public `billybotticelli4u-collab/raven-receipt-verifier` rather than vendoring the prior 16-file `packages/verify-js` set for provenance convenience. Label any unavoidable pre-existing copy: **PRE-EXISTING RAVEN FOUNDATION — NOT CRYPTO WORLD'S FAIR WORK**.

**Manifest tip-bump (Europe/Rome):** 2026-09-15 ~00:05 CEST (UTC+2)

---

## 1. Exact source Fair HEAD / TREE / branch

| Field | Value | Notes |
| --- | --- | --- |
| **Chosen product tip** | **Day-2** | Owner-authorized public successor to Day-1 |
| Worktree | `<home>/raven-rnd-gauntlet-push/wf-day2-malformed-clock-repair` | Fair Day-2 worktree |
| Branch | `billy/worldsfair-2026-day2-malformed-clock-repair-2026-09-14` | |
| **HEAD** | `a5cd592b72d2da1ebf6f0c1e224d05489ff31524` | malformed-clock fail-closed tip |
| **TREE** | `3e442f93529bdb5da876b54d484294032535e84a` | |
| Contest baseline HEAD | `18b1a13c601cc362404dc6306fd8f4d1cc3e046e` | pre-Fair `origin/main` freeze |
| Contest baseline TREE | `6bd7276fb71f8878bd9b3313d7200e56f447a0f3` | |
| Independent review of chosen tip | **GO** — `INTERNAL_ADVERSARIAL_NON_AUTHOR` | Billy copy-GO class; **not** EXTERNAL_INDEPENDENT; deploy still Owner-gated |
| Prior public Day-1 HEAD | `feaa1fb452b8e1307979dea7fd1c561fad82aa00` | preserved parent; no history rewrite |
| Verifier submodule pin | `1b04356a275742752fb7afd8dfcc4269d462a778` | unchanged |

### 1.1 Day-1 public baseline (superseded as tip; history retained)

| Tip | Branch | HEAD | TREE | Notes |
| --- | --- | --- | --- | --- |
| Day-1 Strategy A export (public main parent) | public `main` @ feaa1fb | `feaa1fb452b8e1307979dea7fd1c561fad82aa00` | `94957c86e8d36a86012c3fed198d7a576fe3cdfa` | Day-1 product tip was `1ba45d5a` / `9205ca79` |

**Rule applied:** Day-2 tip published only after INTERNAL_ADVERSARIAL_NON_AUTHOR GO + Owner re-auth. Deploy / DNS / npm remain HOLD.

---

## 2. Proposed public surface (after Owner **final** auth)

| Item | Proposal |
| --- | --- |
| Public repo | `billybotticelli4u-collab/raven-worldsfair-2026` |
| Exists today? | **Yes** — `billybotticelli4u-collab/raven-worldsfair-2026` (Day-1 public; tip-bump to Day-2) |
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

## 6. FAIR_NEW files (complete list — Day-2 tip `a5cd592`)

All created during Fair 2026 Day-1 product / provenance work (after contest start). Count = **22** tip paths + **1** this V2 file written in worktree (uncommitted) = **23** for exposure set.

### App (`apps/worldsfair-agent-trust/`) — 22 (Day-2)

| path | role |
| --- | --- |
| `apps/worldsfair-agent-trust/package.json` | App identity / engines / scripts |
| `apps/worldsfair-agent-trust/README.md` | App-local run instructions |
| `apps/worldsfair-agent-trust/PRODUCT.md` | Claim / PATH A+B / foundation vs Fair honesty |
| `apps/worldsfair-agent-trust/src/server.js` | HTTP demo server |
| `apps/worldsfair-agent-trust/src/write-build-info.js` | Build-info generator |
| `apps/worldsfair-agent-trust/src/lib/agentA.js` | Agent A fail-closed decision |
| `apps/worldsfair-agent-trust/src/lib/agentB.js` | Agent B claim + fixture evidence |
| `apps/worldsfair-agent-trust/src/lib/ravenVerify.js` | Loads Raven verifier; clock pin; malformed eval-time fail-closed; disclosure |
| `apps/worldsfair-agent-trust/src/lib/protocol.js` | `raven-agent-trust/1` message helpers |
| `apps/worldsfair-agent-trust/src/lib/runSlice.js` | PATH A/B orchestration / machine exchange |
| `apps/worldsfair-agent-trust/src/lib/buildInfo.js` | Foundation vs Fair UI labels; Built during competition |
| `apps/worldsfair-agent-trust/public/index.html` | Judge UI shell |
| `apps/worldsfair-agent-trust/public/app.js` | Judge UI client |
| `apps/worldsfair-agent-trust/public/styles.css` | Judge UI styles |
| `apps/worldsfair-agent-trust/fixtures/bonk-valid-receipt.json` | PATH A offline evidence |
| `apps/worldsfair-agent-trust/fixtures/bonk-tampered-receipt.json` | PATH B controlled defect |
| `apps/worldsfair-agent-trust/fixtures/bonk-wrong-subject-claim.json` | Wrong-subject scenario metadata |
| `apps/worldsfair-agent-trust/test/vertical-slice.test.js` | Verified/refused/missing/exception |
| `apps/worldsfair-agent-trust/test/build-info.test.js` | Build-info honesty |
| `apps/worldsfair-agent-trust/test/machine-exchange.test.js` | Deterministic machine exchange |
| `apps/worldsfair-agent-trust/test/truth-disclosure.test.js` | liveAcquisition / evaluationTime disclosure |
| `apps/worldsfair-agent-trust/test/malformed-clock.test.js` | invalid_evaluation_time fail-closed |

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
| Superseded intermediate Day-2 tip `a103647` (not publication tip; accepted tip is `a5cd592`) | Historical — do not treat as current Fair tip |

---

## 11. Secret scan result (chosen tip Fair surface)

Scanned `apps/worldsfair-agent-trust/**` + `docs/hackathon/worldsfair-2026/**` at Day-2 tip `a5cd592` (public Strategy A export) for private PEM/OpenSSH headers, obvious cloud/GitHub/Slack token shapes.

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
| FAIR_NEW (tip app+docs) | 22 | **Day-2 app+docs** (incl. protocol + 3 new tests) + **V2 manifest** |
| PREEXISTING_REQUIRED copies | 16 | **0** (link public repo instead) |
| BUILD_SUPPORT create-at-exposure | 2+ | Root README, LICENSE, `.gitignore`, `.gitmodules` / submodule |
| Auto-expose verify-js convenience set | yes | **no** |

---

## 15. Blockers / residuals for Owner

1. **Deploy / DNS / npm remain HOLD** — Day-2 public tip bump is Owner-authorized; live `/worldsfair` deploy is not.
2. Intermediate Day-2 tip `a103647` is **not** the publication tip. Accepted reviewed tip is `a5cd592` / tree `3e442f93` (malformed-clock fail-closed) after INTERNAL_ADVERSARIAL_NON_AUTHOR GO + Owner re-auth.
3. Public verifier tip ≠ monorepo verify-js tip on 2 kernel files — Adequacy OK for Fair PATH A/B with explicit trustedKeys; disclose pin `1b04356a`.
4. Public verifier has **no `dist/`** — judges need `NODE_OPTIONS=--experimental-strip-types` (documented in app scripts) **or** a documented build-in-submodule step.
5. npm package still **404** — do not tell judges to `npm install raven-receipt-verifier` from registry.
6. Import retarget + submodule pin are **public Strategy A exposure edits** (retarget to `vendor/raven-receipt-verifier/...`; pin `1b04356a`).

---

## 16. Day-2 tip-bump summary (Owner-authorized)

- Manifest: `docs/hackathon/worldsfair-2026/PUBLIC_EXPOSURE_MANIFEST_V2.md` (Day-2 edition)
- Tip chosen: **Day-2** `a5cd592b72d2da1ebf6f0c1e224d05489ff31524` / `3e442f93529bdb5da876b54d484294032535e84a` (**not** `a103647`)
- Prior public Day-1 HEAD preserved: `feaa1fb452b8e1307979dea7fd1c561fad82aa00` (additive history; no rewrite)
- Dependency strategy: **A — link public `raven-receipt-verifier@1b04356a` via submodule; PREEXISTING_REQUIRED = 0; no verify-js dump**
- FAIR_NEW: Day-2 app (incl. protocol/machine-exchange/truth-disclosure/malformed-clock) + Fair docs; no 16-file foundation copy
- Disclosures: not live Solana; `liveAcquisition:false`; deterministic fixture/demo evaluation time; malformed eval time REFUSE; review class INTERNAL_ADVERSARIAL_NON_AUTHOR (not EXTERNAL_INDEPENDENT)
- Secret scan: clean on Fair surface
- Deploy: **HOLD**; prefer `/worldsfair` when separately authorized
- **STOP** — no deploy / no npm publish in this pass

---

## Executor attestation

- Searched Day-2 branches/commits under `<home>` + remotes (`billy/worldsfair*`, `codex/worldsfair*`).
- Inspected Fair `ravenVerify.js` imports and public verifier adequacy.
- Verified `npm view raven-receipt-verifier` → 404; public GitHub repo exists.
- Wrote V2 only; **no** `gh repo create`, **no** Vercel deploy, **no** npm publish, **no** public push.
