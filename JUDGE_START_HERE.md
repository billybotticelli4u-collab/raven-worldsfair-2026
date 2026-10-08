# Raven — judge start

**This repository is public.** Reviews of its contents are internal and non-author; none is an external audit. Two separate workflows are included. Choose one below; their uses of “replay” are different.

Hosted pages, no install needed:

- Conformance: https://raven-worldsfair-2026.vercel.app/ runs Raven-owned demo targets from this repository. **Disclosure / Build Info** on the page shows the commit the platform asserts it was built from; that is an assertion, not proof of the served bytes.
- Raven Replay: https://raven-replay.vercel.app is a separate hosted application with three fixed decoders. Its [source at commit 51b60b7b](https://github.com/billybotticelli4u-collab/raven-worldsfair-2026/tree/51b60b7b9220d52f95ef747abc0ca5c97250b9e0/apps/raven-replay-hosted) is published on the unmerged branch `codex/hosted-replay-source-recovery-51b60b7-20261003`, **not on main** (checked 9 October 2026). The `apps/raven-replay` directory below is an earlier local prototype, not that hosted page. A loading page does not prove that cloud execution is available.

Neither hosted page runs code you upload. To run your own decoder, clone this repository and run Conformance locally.

## Start here: see a disagreement and reproduce it

Open the Conformance page linked above. No wallet, sign-in or transaction fetch is needed.

1. Select **Solana transaction versions** (Experimental). Check that the scope shows **30 vectors**, corpus **1.4**.
2. Select **SOL_BROKEN_SUBTLE**, then **Run Conformance (live)**. Expect **DIVERGENT**, with 27 matching rows and three divergences: `V03_valid_v1`, `V10_noncanonical_shortvec_sigcount`, and `V16_valid_v1_two_instructions`.
3. Inspect the first divergence. It compares a named profile's expected decision with the demo target's observed decision; it is not a security score.
4. Select **SOL_CONFORMANT_REFERENCE** and run again. Expect **CONFORMANT**, 30 matching rows and no divergence.
5. Under **Download & reproduce**, select **Replay report**. Expect **Replay matched**, with **bundle yes** and **semantics yes**. Download the report and keep it for local reproduction.

The deliberately broken reader is Raven's demonstration fixture. This does not establish a defect in a customer's decoder. The experimental profile is not a claim of universal transaction correctness.

If the hosted page is unavailable, reproduce the same corpus locally with the commands in **Named Conformance corpus** below. For a fixed released source, start in a new folder:

```sh
git clone https://github.com/billybotticelli4u-collab/raven-worldsfair-2026.git
cd raven-worldsfair-2026
git checkout --detach 2cb12875b2a0f65b8a59999ffa33807e35a81e43
```

Use Node **22.18.0**. The commands below must run from this checkout, not an older checkout that happens to have the same folder name. The pinned commit's old guide still says 27 rows; the corpus and expected results above are 30.

## Other workflows and source access

| Workflow | What to try | Location |
|---|---|---|
| Saved parser regression cases | Create → export → reload → import → rerun against a reference → inspect changes → download report | Raven Replay, local browser on port 8794 |
| Named Conformance corpus | Run the reference and deliberately broken target on the same 30 rows, inspect differing rows, replay the report | Conformance app, local browser on port 8791, or the hosted page above |

## 1. Saved parser cases

Use exactly Node22.18.0 and npm10.9.3. Confirm both versions; the Node installation's npm may have been replaced. From the repository root:

```sh
node --version
npm --version
cd apps/raven-replay
shasum -a 256 -c SHA256SUMS.txt
cd vendor/raven-replay-parser-sdk
npm ci
cd ../..
./bin/raven-replay --node "$(command -v node)" --port 8794
```

On Linux replace `shasum -a 256` with `sha256sum`. Open http://127.0.0.1:8794/cases. Use the synthetic example and the Solana Kit adapter. Export the case and keep its displayed canonical digest separately. Reload, import, enter that reference, and rerun. Expect MATCH. A changed reference produces INVALID_CASE / NOT_RUN. Import `apps/raven-replay/examples/cases/changed-expectation.json` for a labelled synthetic REGRESSION. Download the default report. The [full walkthrough](docs/hackathon/worldsfair-2026/REPLAY_JUDGE_WALKTHROUGH.md) explains each step.

Stop with Ctrl-C and wait for cleanup. A warning about possibly surviving processes is not a successful cleanup result. The known unreadable-identity case can exceed the normal cleanup bound.

## 2. Named Conformance corpus

In a second terminal, from the repository root:

```sh
cd apps/raven-conformance
node src/server.js
```

Open http://127.0.0.1:8791 and select **Solana transaction versions**. The reference should match 30/30. The intentionally broken subtle target passes 27 rows and differs at V03, V10 and V16: three rows covering two defect classes. Rows 28 to 30 were added in corpus 1.4; the original 27-row corpus file is preserved in the repository. These are Raven-owned offline demonstration targets, not evidence that a customer's SDK is defective.

For command-line reproduction:

```sh
node src/cli.js --profile solana --target SOL_CONFORMANT_REFERENCE --run-id judge-reference
node src/cli.js --profile solana --target SOL_BROKEN_SUBTLE --run-id judge-subtle
# The deliberately divergent run returns exit1.
node src/bin/replay.js --report reports/judge-reference.json
```

The reproduce commands printed by the app and packaged in each report clone this public repository and check out the commit the running instance asserts (`FAIR_BUILD_COMMIT`, shown by `/api/build-info`). No separately supplied packet is needed. The [source map](INTEGRATION_SOURCE_MAP.json) records where each component came from.

## Scope and delivery

Replay uses the legacy inspector and registered adapters from SDK dbcee545. It cannot save Solana version1 results. The separate reviewed version1 CLI successor is not integrated here. Conformance has its own version1 fixtures and policies; its result is not Replay version1 support. Customer parsers require scoped engineering.

Reports are unsigned. MATCH means the retained expectation reproduced, not that a transaction is safe. Exported cases contain input bytes; detailed reports can expose reconstructible input. Use synthetic or public, non-sensitive inputs. No wallet, signing or RPC is required for these examples. Installing dependencies requires registry access or a complete cache. A subprocess is not a sandbox.

This repository's main-branch Vercel configuration hosts Conformance, not the local Replay prototype in `apps/raven-replay`. To inspect hosted Replay, use the immutable source link above. In a **separate clone**, fetch and check out its recorded source:

```sh
git fetch origin codex/hosted-replay-source-recovery-51b60b7-20261003
git checkout --detach 51b60b7b9220d52f95ef747abc0ca5c97250b9e0
```

Then read `apps/raven-replay-hosted/README.md` and `DEPLOYMENT.md`. This checkout is source access, not a one-command hosted deployment: hosted runs also require an operator-provisioned execution snapshot and admission store. No service keys are needed to read the source. This guide does not claim current snapshot validity, deployed-source identity, hosted acceptance, or resolution of third-party distribution questions. If hosted Replay cannot execute, use Conformance or the local prototype within their own stated scopes; neither is a substitute measurement of hosted Replay.

A push to this repository may trigger hosting automation. SDK package metadata and the SDK-local LICENSE record Apache-2.0, matching the repository license. The existing pre-Fair foundation disclosure remains in README.md. This document does not certify contest eligibility, portal submission or final media readiness.
