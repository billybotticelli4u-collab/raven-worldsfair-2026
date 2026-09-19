# Vercel entry for apps/raven-conformance

Authored by the Claude deploy-path agent on 2026-09-19 on top of the reviewed
C2 release successor `1641d46bbbee502644e0d113100add3b3f0a1ab9`. Independent
review by CODEX or KIMI (never Claude) is required before any push, merge or
deploy. This commit changes no file under `apps/`, `scripts/verify-public-build.mjs`
or `BUILD-IDENTITY.md`; it only adds root-level deployment wiring.

## Files

| File | Purpose |
|---|---|
| `api/index.js` | Vercel Function entry. Relocates `apps/raven-conformance` to a writable directory (functions are read-only except `/tmp`; the runner writes `reports/<run_id>.json`) and imports the unchanged `src/server.js`, whose `http.createServer(...).listen()` the Vercel Node.js runtime captures and proxies to. No route is re-implemented. |
| `vercel.json` | Framework `null`; install skipped; build = `cd apps/raven-conformance && npm run build`; static output = `apps/raven-conformance/public`; `ignoreCommand: exit 1` (always build; the project's dashboard rule only builds `fair-day2-vercel`); `api/index.js` gets `maxDuration 300` and `includeFiles apps/raven-conformance/**`; rewrite `/api/(.*)` -> `/api/index`. |
| `package.json` | Root `"type": "module"` so `api/index.js` runs as native ESM (same reason as the earlier agent-trust adapter), Node `22.x`. |
| `scripts/vercel-adapter-smoke.mjs` | Local end-to-end check that emulates the runtime's server capture and exercises the judge-facing HTTP surface through the wrapper. |

## What it deliberately does not do

- No change to corpus, profiles, targets, runner, isolation, replay,
  `buildIdentity.js`, `httpBoundary.js`, `server.js`, or the public UI files.
- No env var is read except `RAVEN_CONFORMANCE_RUNTIME_ROOT` (optional override
  of the writable directory; unset on Vercel).
- No deployment, project setting, environment variable or domain is changed by
  this commit. The dashboard settings for Build/Install/Output are overridden
  by `vercel.json` only for deployments that contain this commit.

## Local check

```sh
node scripts/vercel-adapter-smoke.mjs      # Node 22.18.0 or 24.20.0; exit 0 = pass
```

## After any deployment that contains this commit

```sh
curl -sS https://raven-worldsfair-2026.vercel.app/api/build-info | python3 -m json.tool
node scripts/verify-public-build.mjs https://raven-worldsfair-2026.vercel.app
```

Expected: `product` = `raven-conformance`, `fairBuildCommit` = the deployed
commit, `commitSource` = `platform_asserted`, `identityStatus` =
`UNVERIFIED_ASSERTION`, `identityWarnings` = `[]`, and `PUBLIC_FILES_MATCH`.
`identityStatus: CONFLICT` with `COMMIT_CLAIMS_DISAGREE` means the stale
`WORLDSFAIR_BUILD_COMMIT` Production environment variable is still set on the
project; `commitSource: unavailable` means system environment variables are not
exposed to the function.
