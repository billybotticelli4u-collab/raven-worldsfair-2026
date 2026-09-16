# Challenge 2 Judge UI — Handoff

## Identity used
- Repo: billybotticelli4u-collab/raven-worldsfair-2026
- Baseline reported: billy/fair-conformance-mvp-2026-09-16 @ 53360df / TREE 468b039
- Product-line tip used: Challenge 1 `billy/fair-challenge1-bounded-runner-2026-09-16` @ bd063b7565a0f35332596c35cf21e195ddc13013
- Working branch: `billy/fair-conformance-challenge2-judge-ui-2026-09-16`

## Authoritative local tip (box clone — complete product)
- HEAD: fad60a4a2fc0a353f81af1e9e3ad20d85bf71a13 (re-run git rev-parse after pull)
- TREE: a39075faddaf2853f56e59bb65b68d39fd05f05c
- Canonical lock: `/workspace/challenge2-judge-ui-lock/` (+ `challenge2-judge-ui-artifacts.tgz`)

## Remote tip (partial MCP sync)
- See `git ls-remote` for `billy/fair-conformance-challenge2-judge-ui-2026-09-16`
- Copilot assist PR: https://github.com/billybotticelli4u-collab/raven-worldsfair-2026/pull/1
- Box lacks HTTPS push credentials; MCP used for smaller files. If remote `src/server.js` / `public/app.js` still MVP, sync from local tip or lock tarball.

## Startup
```bash
cd apps/raven-conformance
npm test    # author box: 39/39 PASS
npm start   # http://127.0.0.1:8791
# optional: npm install --no-save puppeteer-core@24 && npm run verify:browser
```

## Engine / UI seam
- UI consumes Challenge 1 contract `interface/raven-conformance-ui-contract-v1.{md,json}`
- Display-only adapter: `src/lib/displayAdapter.js` (no verdict recalculation)
- Live progress: `GET /api/run-stream` → runner `onProgress`
- Demo targets only via `loadDemoTargets()`; probes excluded from UI

## Browser verification (author evidence)
- Report: `apps/raven-conformance/evidence/challenge2-judge-ui/browser-verify-report.json`
- Also: `/workspace/challenge2-judge-ui-lock/evidence/`
- Summary: **12 PASS / 0 FAIL / 0 unverified**
- Screenshots: desktop-first-screen, desktop-result-{CONFORMANT_REFERENCE,BROKEN_OBVIOUS,BROKEN_SUBTLE}, desktop-recorded-fallback, desktop-retry-after-recorded, desktop-focus, mobile-first-screen, mobile-result-BROKEN_SUBTLE

### Scripted BROKEN_SUBTLE journey (not user research)
- elapsed_ms: **1386**
- Actions (t_ms): load_first_screen 1013 → select 1030 → click_run 1047 → result_visible 1328 → progress_events 1337 → inspect_evidence 1349 → download 1370 → copy_repro 1384

## Failed / skipped / unverified
- None in author browser-verify (do not label unexecuted PASS).

## Owner decisions (≤3)
1. Confirm product-line tip = Challenge 1 engine tip (not MVP 53360df) — done in this lane.
2. Whether PNG evidence must be on the public remote branch or lock/handoff-only is enough.
3. Whether runner BRANCH_NAME string should be updated for Challenge 2 (engine-owned; UI did not change it).

## Evidence classification
- **Author evidence:** this lane (UI + local verify 12/12 + unit 39/39)
- **Independent review:** not done
- **Owner acceptance:** not done

## Constraints honored
Hackathon product only; no governance/Ed25519/npm publish/production signing; public-safe; isolated branch; did not rewrite shared engine (adapter + SSE only).
