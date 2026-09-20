# Integration: local Conformance revalidation

Bounded local CLI that re-runs the **same** approved Conformance suite for a
baseline target vs a proposed target, preserves both immutable reports, and
emits a comparison (improvements / regressions / unchanged / incomparable).

Evaluator: `runConformance` in `src/lib/runner.js` only — **no second evaluator**.

## Targets: registered ids only (D1 pattern)

`--baseline` and `--proposed` accept **registered target ids** only (for example
`CONFORMANT_REFERENCE`, `BROKEN_SUBTLE`). Filesystem paths are **refused** with
`TARGET_NOT_REGISTERED` (CLI exit 2).

To revalidate a new subject:

1. Add an entry under `targets/manifests.json` (same D1 registration pattern used
   by the ordinary conformance runner).
2. Place the entry module under `targets/` as referenced by the manifest.
3. Invoke revalidate with the **id**, not a path.

Revalidate reports are **ordinary conformance reports**. They replay with the
normal replay CLI (`npm run replay -- --report <path>`) — same bundle/semantic
checks as any other `runConformance` report.

## Commands

```bash
# From apps/raven-conformance (Node >= 22; Fair pin 22.18.0)
npm run revalidate -- --baseline CONFORMANT_REFERENCE --proposed BROKEN_SUBTLE

# Reuse a prior immutable baseline report (fail-closed if missing/tampered)
npm run revalidate -- \
  --baseline-report reports/<run_id>.json \
  --proposed CONFORMANT_REFERENCE \
  --out-dir evidence/revalidate/my-session \
  --json

# Replay a revalidate-produced report (ordinary report)
npm run replay -- --report evidence/revalidate/<session>/proposed_<run_id>.json
```

Approved demo ids: `CONFORMANT_REFERENCE` | `BROKEN_OBVIOUS` | `BROKEN_SUBTLE`.

## Outputs

Each session under `evidence/revalidate/<session_id>/` contains:

- `baseline_<run_id>.json` — immutable baseline trial report (copy)
- `proposed_<run_id>.json` — immutable proposed trial report (copy)
- `comparison.json` — machine-readable comparison + identity pins
- `comparison.txt` — human summary

Runner also writes unique `reports/<run_id>.json` files. A later pass **never**
overwrites a prior failure report (new `run_id` each time).

## Identity recorded

Per side: target entry sha256, runner/revalidate source sha256, package.json
(+ lock if present), Node/platform, profile + corpus pins, report deterministic
digest, binding.

## Fail-closed

| Condition | Exit |
|-----------|------|
| Path-like or unregistered target id | 2 (`TARGET_NOT_REGISTERED`) |
| Missing `--baseline-report` path | 2 |
| Tampered baseline (deterministic digest mismatch) | 2 |
| Usage / write failure | 2 |
| Verdict REGRESSED / MIXED / INCOMPARABLE | 1 |
| Verdict UNCHANGED / IMPROVED | 0 |

Success is never manufactured when baseline evidence is absent or altered.

## Probabilistic note

This tool **preserves trials**. It does **not** promise that an identical
re-invocation yields bit-identical vector statuses under nondeterministic
isolation backends or flaky targets. Compare preserved reports; do not assume
replay equality.

Corpus 0 remains frozen. No customer endpoints. No CI workflow/schedule/webhook
is added by this change.

## Future authorized CI trigger (documentation only)

If a future **authorized** CI owner decides to invoke this locally-equivalent
gate, the intended call shape is:

```bash
node apps/raven-conformance/src/bin/revalidate.js \
  --baseline-report "$BASELINE_REPORT_PATH" \
  --proposed "$PROPOSED_TARGET_ID" \
  --out-dir "$EVIDENCE_DIR" \
  --json
```

Requirements for any such future trigger (not implemented here):

1. Explicit human authorization / workflow dispatch — no silent schedules.
2. Baseline report artifact must already exist and pass digest verification.
3. Fail-closed on missing/tampered baseline (exit 2).
4. Proposed target must be a registered id (D1); no path mode.
5. Upload both reports + `comparison.json` as immutable evidence artifacts.
6. Do not add a second evaluator; call this CLI (or `revalidate()` API) only.
7. Do not mutate Corpus 0; pin profile/corpus digests in the comparison identity.

This document is **not** a CI workflow. No `.github/workflows` entry, schedule,
or webhook is created by this worktree change.
