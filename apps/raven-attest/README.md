# raven-attest

Standalone checker for Raven Conformance evidence reports.

It answers one question: **does this report refer to exactly the target, profile,
corpus and run the reader thinks it does?**

It is *not* a second conformance runner. It never decides whether a target is
conformant — it decides whether a conformance report is talking about what it
says it is talking about.

## Boundaries

- Does **not** import, edit, or depend on `apps/raven-conformance`. Every digest
  is re-derived here, so "the digest matches" is never produced by the same code
  that produced the digest.
- Does **not** modify the engine, the shared report schema, the corpus, the
  profile, or the manifests. Proposed engine changes are routed as text in
  `FINDINGS.md`, not applied.
- Establishes **byte binding only**. It does not establish signer trust,
  authorization, deployment, or successful on-chain execution, and it says so in
  every result it emits.

## Verified subject

| | |
|---|---|
| repo | `github.com/billybotticelli4u-collab/raven-worldsfair-2026` |
| branch | `billy/fair-conformance-mvp-2026-09-16` |
| HEAD | `53360df071872a29447993e879add2be9406b7b5` |
| TREE | `468b0397c89165160337a53597e8b6533f1f1dec` |

Identity was re-derived from a fresh clone, not taken from the handoff.

## Run it

```bash
cd apps/raven-attest

# 1. Full substitution pack: 28 cases, expectations frozen in the source.
#    Exit 0 = every case behaved exactly as frozen.
node harness/substitution.js

# 2. Machine-readable
node harness/substitution.js --json > results/SUBSTITUTION_RESULTS.json

# 3. Check one report by hand
cd ../raven-conformance && node src/cli.js --target CONFORMANT_REFERENCE >/dev/null
cd ../raven-attest && node src/attest.js \
  --report ../raven-conformance/reports/<run_id>.json \
  --bundle ../.. \
  --pins pins/bundle-pins-53360df.json
```

Requires Node ≥ 22. No dependencies, no network, no credentials.

Exit codes for `src/attest.js`: `0` all executed checks passed, `1` at least one
FAIL, `2` usage/IO error.

## Verdict vocabulary

| Verdict | Meaning |
|---|---|
| `PASS` | The check executed and the property held. |
| `FAIL` | The check executed and the property did not hold. |
| `UNDERSPECIFIED` | The check executed but no contract exists to judge against; classified, not rejected. |
| `SKIPPED` | The check did not execute (missing input). **Never reported as PASS.** |
| `INFO` | The row computes a value and asserts nothing. Excluded from the tally. |
| `ERROR` | The check could not run (bad input, missing file). |

`ACCEPTED` means every **executed** check passed for that report against that
bundle. It is not a conformance verdict and not a security verdict.

## The pin, and why it matters

A conformance report is self-consistent with whatever bundle was present when it
ran. Swap the corpus and re-run, and every internal digest still agrees — because
they were all computed *from* the swapped corpus. Case `S16` demonstrates exactly
this: the same attack that `S03` rejects is **ACCEPTED** when `--pins` is omitted.

`pins/bundle-pins-53360df.json` is the out-of-band anchor, frozen from the
verified HEAD above.

**Limitation, stated plainly:** a pin file committed to the same branch an
attacker can edit is not an out-of-band anchor. For the pin to do its job, the
report consumer must obtain it independently of the bundle being checked.

## Layout

```
src/attest.js            the checker (22 rows: A1–A7, B1–B7, C1, D1, E1, F1, G1–G2)
src/lib/bundle.js        digest re-derivation, independent of the engine
src/lib/oracle.js        profile → expected-decision oracle (reads no target)
src/lib/stable.js        deterministic / variable partition of a report
harness/substitution.js  28 frozen cases: 3 positive controls + 25 attacks
pins/                    out-of-band anchor
results/                 machine-readable pack output
THREAT_MODEL.md          what each field covers, what is merely descriptive
FINDINGS.md              gaps, minimal fixes, owner decisions, what I did not verify
```
