# COMPATIBILITY PROPOSAL — multi-profile support for apps/raven-conformance

**Routed as text. Not applied. Billy's engine and shared schema are unchanged.**

## Why this module is standalone

The MVP runner hardcodes its profile and corpus (`apps/raven-conformance/src/lib/runner.js:17-18`):

```js
const PROFILE_FILE = "raven-canonical-envelope-1.json";
const CORPUS_FILE = "raven-canonical-envelope-demo-corpus-1.json";
```

A second demo profile therefore cannot be run through `npm run conform` without editing the engine, which this lane must not do. This module ships its own harness (`harness/run.js`) that mirrors the MVP's spawn/restricted-env/timeout model and extends the comparison to `decision` AND `version`.

## Minimal compatible change (when Billy wants it)

1. `loadProfile(file)` / `loadCorpus(file)` take a filename argument, still defaulting to the current constants — zero behavior change for existing invocations.
2. `cli.js` accepts optional `--profile <file>` / `--corpus <file>`; `runConformance(targetId, opts)` forwards them.
3. `targets/manifests.json` entries gain an optional `corpus` field; targets without it resolve to the default corpus. (This module's targets live in their own directory today; moving them into `apps/raven-conformance/targets/` then works without harness changes.)
4. Optional: compare `expected.version` when present in a corpus vector (additive; existing corpus carries no `version` key, so current behavior is preserved).

No schema break: report schema `raven-conformance-report/1` unchanged for the default path.
