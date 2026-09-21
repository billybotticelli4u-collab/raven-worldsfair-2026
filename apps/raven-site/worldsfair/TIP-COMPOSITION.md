# WorldsFair tip composition (Billy)

Fix tip after CODEX CHANGES_REQUESTED on `7390574`. **Not deployed. Not pushed. Not a promote ask.**

## Included
1. CODEX live download repair kit (helper-verified bytes) → `download/`
2. GROK page-copy changes (ledger/note `689184e8…`) on `index.html` + `REVIEW-SIDECAR-MEDIA.md`
3. Trust docs **IN** as **historical bytes only** (exact reviewed bytes; MANIFEST `2dfae0d0…`). Presence here does **not** transfer GROK trust GO.
4. I-1 / I-3 remain on companion tip `fa205f8580ac29a72188698a27974a8e63975a1c` (unchanged by this composition fix)
5. **NEW (this fix):** full deployable `apps/raven-site/` static root from CODEX static deploy input `ab2a33fc…` (`vercel.json` outputDirectory `.`, agents/contact/logo, `/worldsfair` redirect). Tip-preserved repaired `worldsfair/` overlaid on that root.

## Download files
- `DOWNLOAD-NOTES.md` `0649da09b18ad389b30b159cbae2bbe137731ed37e2d0cdb04d8cf20b84e3066`
- `SHA256SUMS.txt` `f40b6fd4617884c19e0d9f56e23d07156686d40a19fe12a94f0d5f3f1ed21ad9`
- `raven-conformance-fair-developer-notes.zip` `35168a947febd81d8b64fcad81af579f96cdfd13c907ab05d18e349e815fc44c`
- `raven-conformance-judge-package-2026-09-20-34453300.zip` `34453300504b703b4c62de6ff5a885e80f8892c0217d66e1fb031716df3efe1e`

## Decision: trust docs
Trust docs remain **IN** as byte continuity for the page. **GROK GO_BOUNDED_COPY (`0dd431a7…`) does NOT transfer to this tip** (GROK bound it to an earlier HEAD/TREE). Do not cite that GO as tip-bound approval.

## Deploy surface
Worldsfair public surface is meant to publish from `apps/raven-site` as its own Vercel root. Root-repo `vercel.json` still builds raven-conformance and is not the worldsfair publisher. Owner-gated deploy only after CODEX re-review PASS + Owner YES.

## Explicit non-actions
No push. No deploy. No Vercel settings change. No Owner promote ask in this note.
