# Raven reader-check kit — getting started

Check your transaction reader against Raven's pinned Solana transaction-version
profile, see exactly where it differs, and export the result. The kit runs locally,
needs no account or package installation, and makes no provider calls. A reader's
access to other data depends on the actual execution controls described below.

> Status: local CODEX correction of Billy 1's kit, pending non-author acceptance.
> Reports are **unsigned** and use **fixture** test cases (`liveAcquisition:false`).
> Results are "checked against Raven's pinned profile and corpus", never
> "verified on-chain".

## 1. Prerequisites

- A recursive clone of this repository (the verifier submodule is not needed by this kit).
- Use genuine **Node.js 22.18.0** for the repository's pinned reproduction path.
  Check `node -p 'JSON.stringify({node:process.versions.node,electron:process.versions.electron??null})'`:
  `electron` must be null. An app's embedded runtime is not a substitute for Node;
  a version string alone does not identify it. The original author used other
  runtimes because one local Node install was broken; the completed acceptance
  review subsequently ran its eight tests on a working standalone Node 22.18.0.
- macOS or Linux with a working, probed isolation mode. macOS prefers
  `sandbox-exec` and falls back to Node permissions if that probe fails. If neither
  isolation works, the kit refuses to run your reader (exit 2) rather than run it unconfined.
- A writable `apps/raven-conformance` directory for the temporary captured reader.
  It is removed after a normal run; failed setup refuses without returning a passing report.
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
   dependencies into it first. Its contract excludes child processes, workers,
   file writes, network and external config. Each case has 3 seconds, 256 KiB stdout
   and 64 KiB stderr. These requirements are distinct from the controls actually
   enforced by the selected mode (see below).
4. Run:

```sh
node apps/raven-reader-check-kit/check-reader.mjs \
  --reader apps/raven-reader-check-kit/readers/my-reader.mjs \
  --out my-reader.json --explain my-reader.md
```

Running the unedited template is safe: it reports `NOT_PASSED` with 27 `TARGET_CRASH`
cases and the hint `the template reader is not connected yet`. (Three malformed-input
cases already pass because the template's input boundary rejects them.)

**Captured reader.** Each run captures the input once and executes that exact copy
for every case. Changes to the original file during the run do not change the
tested code or its recorded SHA-256. The copy lives under the Conformance app root,
which the existing Seatbelt profile explicitly denies writing even for a checkout
under `/tmp`; Node permissions also deny writes. It is checked around each case
and normally removed afterwards. Relative imports, resources beside the original
file, and assumptions about `import.meta.url` are unsupported: the copy is a `.mjs`
file at a different path. If capture fails or its bytes change, no full pass is
returned. A hard process kill can leave a temporary copy; this is not a guarantee
against a privileged or concurrently hostile host.

**Execution environment.** The actual mode and controls are in the report:

- Seatbelt denies network and writes to the captured reader/app root, but allows
  broad file reads, child processes, workers and writes to temporary areas.
- Node permissions restrict reads to the captured entry and deny writes, child
  processes and workers. They do **not** deny network.

Use reviewed readers in an approved environment without credentials. An environment
allowlist or a network block does not prove that the machine contains no secrets.
This kit is not permission to run unknown customer code on a personal workstation.

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
commit/tree, captured reader SHA-256, profile file SHA-256, isolation mode and controls,
Node version and every case's expected and observed answer. The corpus `sha256`
field is its **canonical content digest**, kept for compatibility; `digest_kind`
names that meaning and `file_sha256` separately identifies the file bytes.

JSON, Markdown and reader-input paths must identify different files. The CLI checks
paths in filesystem order (including symlinks followed by `..`) and existing hardlinks
before executing and before writing. A collision detected then refuses with exit 2
and preserves existing files. After creating JSON, the CLI checks again before writing
Markdown: a case- or Unicode-folded alias of a previously nonexistent filename may
only become detectable then. That refusal leaves the new JSON intact, writes no
Markdown and prints no success/report line. Choose distinct names and rerun. This is
an accidental alias guard, not an atomic export or protection against a hostile
concurrent filesystem race.

Rerun the comparison with the same captured reader bytes, profile, corpus and runtime
to compare case outcomes. Complete report files include run IDs, timestamps and durations,
so a rerun does **not** promise the same whole-file hash. The printed checksum identifies
the particular exported artifact, not an authenticated signature. This kit's JSON format
does not support the Conformance engine's registered-target report replay command.

## 6. Common errors and recovery

| You see | Cause | Fix |
| --- | --- | --- |
| `error: reader file not found` (exit 2) | Wrong path | Paths are relative to where you run the command; run from the repo root. |
| `output_path_collision` (exit 2) | Reader, JSON or Markdown paths identify the same file | Choose distinct destinations. Pre-write refusals preserve existing files; a newly detected case/Unicode alias leaves JSON intact and skips Markdown. |
| `reader must be a single .mjs/.js file` | Directory or other file type | Point `--reader` at your bundled `.mjs`. |
| `isolation unavailable, refusing to run` (exit 2) | No `sandbox-exec` (macOS) / Node permission model (Linux) | Use Node 22+ on macOS or Linux; the kit will not run your code unconfined. |
| `CORPUS_DIGEST_MISMATCH` / `PROFILE_*` error | The pinned corpus/profile files were edited | `git checkout -- apps/raven-conformance` to restore them. Never edit them to make a reader pass. |
| Every case `TARGET_CRASH`, hint "not connected" | Unedited template | Edit `classifyTransaction()`. |
| `TARGET_CRASH` with `ERR_ACCESS_DENIED` in report `stderr` | Reader imports other files, spawns processes or writes files | Bundle into one file; remove process/file/network use. |
| `INVALID_OUTPUT missing_version` | Answer lacks `version` | Always print `version` (use `null` for REJECT). |
| `TIMEOUT` | More than 3 s for one case | Move slow start-up work out; one process runs per case. |
| Runtime errors or repeated target crashes | Wrong runtime, unsupported code or unavailable controls | Check the genuine Node identity and report details; do not infer the cause from the version string alone. |

## 7. Self-test

```sh
node --test apps/raven-reader-check-kit/test/*.test.mjs
```

The original eight tests check examples, exports and outcome equivalence with the
unchanged Conformance engine for its three registered Solana targets. The additional
tests cover captured reader identity, change-back, write denial, export aliases and
reported controls. Two marker-based tests are Mac-only; Linux skips are explicit
and do not substitute for an independent Linux acceptance run.
Physical-path tests cover symlink/`..` aliases and distinct-file controls. Case and
Unicode alias tests probe the test volume and explicitly skip if it does not fold
those names; they do not infer filesystem behavior from the operating system.
