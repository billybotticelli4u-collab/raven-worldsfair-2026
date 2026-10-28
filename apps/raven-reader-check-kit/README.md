# Raven reader-check kit — getting started

Check your transaction reader against Raven's pinned Solana transaction-version
profile, see exactly where it differs, and export the result. Local only: no
account, no network, no installation.

> Status: AUTHOR DELIVERED kit (Billy 1, 2026-10-28), not independently approved.
> Reports are **unsigned** and use **fixture** test cases (`liveAcquisition:false`).
> Results are "checked against Raven's pinned profile and corpus", never
> "verified on-chain".

## 1. Prerequisites

- A recursive clone of this repository (the verifier submodule is not needed by this kit).
- Node.js **22 or newer** on your PATH (`node --version`). The repository pins 22.x;
  this kit was rehearsed on Node 26.9.0 and 24.21.0 (macOS arm64) because the Node 22
  on the rehearsal machine would not start. Node 22 itself was not executed for this kit.
- macOS (`sandbox-exec` available) or Linux (Node `--permission` support). If neither
  isolation works, the kit refuses to run your reader (exit 2) rather than run it unconfined.
- `git` (only to stamp the kit commit into the report).
- No `npm install`. Nothing is downloaded.

All commands below run from the **repository root**.

## 2. Try the two examples (about 5 seconds each)

Working reference reader:

```sh
node apps/raven-reader-check-kit/check-reader.mjs \
  --reader apps/raven-reader-check-kit/readers/reference-reader.mjs \
  --out reference.json --explain reference.md
echo "exit $?"
```

Expected: `verdict: ALL_MATCHED  (PASS=30)`, exit `0`.

Deliberately faulty reader (the v1 4096-byte size limit was removed):

```sh
node apps/raven-reader-check-kit/check-reader.mjs \
  --reader apps/raven-reader-check-kit/readers/faulty-reader-no-size-cap.mjs \
  --out faulty.json --explain faulty.md
echo "exit $?"
```

Expected, exit `1`:

```
verdict: DIVERGENT  (PASS=29 BEHAVIORAL_DIVERGENCE=1)
  BEHAVIORAL_DIVERGENCE V21_v1_size_cap_exceeded: expected REJECT/null, got ACCEPT/1
```

Meaning: given a 4,202-byte v1 transaction (over the profile's 4,096-byte limit),
the faulty reader accepted it; the profile says it must be rejected.

## 3. Connect your own reader (the one path)

1. `cp apps/raven-reader-check-kit/readers/TEMPLATE-connect-your-reader.mjs apps/raven-reader-check-kit/readers/my-reader.mjs`
2. In `my-reader.mjs`, edit only `classifyTransaction(txBytes)` so it calls your reader and returns
   `{"decision":"ACCEPT"|"REJECT","version":"legacy"|0|1|null,"reason":"..."}`.
   Rejections use `version: null`.
3. Your reader must be **one self-contained JavaScript (ESM) file**: bundle any
   dependencies into it first. It may not start child processes, workers, write files,
   or (macOS) use the network; on Linux it may read only its own file. Each case has
   3 seconds and 256 KiB of output.
4. Run:

```sh
node apps/raven-reader-check-kit/check-reader.mjs \
  --reader apps/raven-reader-check-kit/readers/my-reader.mjs \
  --out my-reader.json --explain my-reader.md
```

Running the unedited template is safe: it reports `NOT_PASSED` with 27 `TARGET_CRASH`
cases and the hint `the template reader is not connected yet`. (Three malformed-input
cases already pass because the template's input boundary rejects them.)

## 4. Reading the result

| Verdict | Plain meaning | Exit |
| --- | --- | --- |
| `ALL_MATCHED` | Every case gave the expected decision and version. | 0 |
| `DIVERGENT` | At least one case gave a **different answer** from the profile. Each such case is listed as `BEHAVIORAL_DIVERGENCE`. This is a difference in behaviour on a named test case — not a claim of exploitability or of anything on-chain. | 1 |
| `NOT_PASSED` | No answer differed, but some cases had no usable answer (crash, timeout, invalid output, too much output) or were skipped. These are **not passes**. | 1 |
| `INCOMPLETE` | No cases ran. | 1 |

Do not read the pass count as a score. Most cases are invalid transactions that must be
rejected, so a reader that rejects everything still matches 24 of 30 cases (rehearsed); it
diverges only on the six valid transactions. Look at which cases differ, not at the total.

Per-case outcomes: `PASS`, `BEHAVIORAL_DIVERGENCE` (different answer), `TARGET_CRASH`
(non-zero exit), `TIMEOUT`, `INVALID_OUTPUT` (not one JSON answer, or `version` missing),
`OUTPUT_FLOOD`, `RUNNER_FAILURE`, `SKIPPED_VECTOR`.

**Skipped / unsupported.** The current corpus (1.4, 30 cases) marks no case as skipped.
If a future corpus skips a case, the kit lists it under `skipped_vector_ids` and the verdict
cannot be `ALL_MATCHED` (the underlying engine's raw summary would count all-skipped as
CONFORMANT; the kit deliberately does not). Formats outside the profile (for example
transaction version 2, message version 3) are expected to be **rejected**; a reader that
accepts them diverges.

**Profile scope.** `raven-solana-txversion-experimental/0` v0.2.0 checks only whether bytes
are admitted as a well-formed legacy, v0 or proposed v1 (SIMD-0385) transaction envelope
under Raven's local profile rules, and which version is reported. It does **not** check
signatures, signer trust, fees, execution, chain state or safety, and reason text is not
scored. Passing all 30 cases is not proof of full Solana correctness.

## 5. Export

`--out` writes the machine-readable report (`raven-reader-check-kit-report/0`); the
command prints its SHA-256. `--explain` writes the plain-language summary generated from the
same report. Default output (no `--out`) goes to
`apps/raven-reader-check-kit/reader-check-results/` (git-ignored). The report records the kit
commit/tree, reader SHA-256, profile and corpus SHA-256, isolation mode, Node version and
every case's expected and observed answer.

## 6. Common errors and recovery

| You see | Cause | Fix |
| --- | --- | --- |
| `error: reader file not found` (exit 2) | Wrong path | Paths are relative to where you run the command; run from the repo root. |
| `reader must be a single .mjs/.js file` | Directory or other file type | Point `--reader` at your bundled `.mjs`. |
| `isolation unavailable, refusing to run` (exit 2) | No `sandbox-exec` (macOS) / Node permission model (Linux) | Use Node 22+ on macOS or Linux; the kit will not run your code unconfined. |
| `CORPUS_DIGEST_MISMATCH` / `PROFILE_*` error | The pinned corpus/profile files were edited | `git checkout -- apps/raven-conformance` to restore them. Never edit them to make a reader pass. |
| Every case `TARGET_CRASH`, hint "not connected" | Unedited template | Edit `classifyTransaction()`. |
| `TARGET_CRASH` with `ERR_ACCESS_DENIED` in report `stderr` | Reader imports other files, spawns processes or writes files | Bundle into one file; remove process/file/network use. |
| `INVALID_OUTPUT missing_version` | Answer lacks `version` | Always print `version` (use `null` for REJECT). |
| `TIMEOUT` | More than 3 s for one case | Move slow start-up work out; one process runs per case. |
| `SyntaxError` / `ERR_UNKNOWN_FILE_EXTENSION` running the kit | Node older than 22 | Upgrade Node. |

## 7. Self-test

```sh
node --test apps/raven-reader-check-kit/test/*.test.mjs
```

Expected: 8 pass, 0 fail. This also checks that the kit's per-case outcomes equal the
unchanged Conformance engine for its three registered Solana targets.
