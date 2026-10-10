# Raven — judge start

Raven checks how Solana transaction readers handle tricky bytes, and lets an agent verify a signed receipt offline before it acts.

## Two minutes, nothing to install

Open [Raven Conformance](https://raven-worldsfair-2026.vercel.app/). Select **Solana transaction versions** and **SOL_BROKEN_SUBTLE**; click **Run Conformance (live)**. The three differences are V03 and V16 (new v1 transactions), and V10 (a non-canonical length). Run **SOL_CONFORMANT_REFERENCE**, then **Replay report**.

## Agent Trust, offline

From this guide's recursive checkout (setup below):

```sh
npm run demo
```

| Run | Expected output |
| --- | --- |
| Broken demo reader | DIVERGENT: 27 match, 3 differ — V03/V16 v1; V10 non-canonical length |
| Reference demo reader | CONFORMANT: 30/30; report replay matches |
| Agent Trust valid fixture | `Valid receipt: PROCEED` |
| Agent Trust one-field tamper | `One-field tamper: REFUSE` |

## Scope and limits

The hosted Conformance page runs Raven-owned demo targets. The experimental 30-vector profile is a finite stated rule set, not a universal correctness or safety verdict. Agent Trust uses a deterministic offline receipt fixture (`liveAcquisition:false`), not a live-chain fetch. Conformance and saved-case Replay reports are unsigned; MATCH means a retained result reproduced, not that a transaction is safe.

Reviews are internal and bounded, not external audits. Neither hosted page runs code a visitor uploads; a customer's decoder requires a local adapter and scoped engineering. **Disclosure / Build Info** asserts the hosted build commit but does not prove the served bytes.

### Agent Trust setup

Use Node **22.18.0**. Clone recursively into a new folder, then run the first-screen command from the repository root:

```sh
git clone --recurse-submodules https://github.com/billybotticelli4u-collab/raven-worldsfair-2026.git
cd raven-worldsfair-2026
npm run demo
```

Use the checkout containing this guide and `scripts/agent-trust-demo.mjs`; the older corpus pin below predates this convenience command. No npm install is needed. The command runs the actual pinned verifier on both retained fixtures and fails without printing the success pair if either expected outcome is absent. The fixtures differ only at `findings[0].code`, without a new signature. PROCEED is Agent A's fixture policy outcome, not permission to transact or proof of current token state.

### Conformance walkthrough

No wallet, sign-in or transaction fetch is needed.

1. Select **Solana transaction versions** (Experimental). Check that the scope shows **30 vectors**, corpus **1.4**.
2. Select **SOL_BROKEN_SUBTLE**, then **Run Conformance (live)**. Expect **DIVERGENT**, with 27 matching rows and three divergences: `V03_valid_v1`, [`V10_noncanonical_shortvec_sigcount`](docs/hackathon/worldsfair-2026/THIRD_PARTY_DECODER_RESULTS.md#v10-and-the-separate-non-minimal-length-finding), and `V16_valid_v1_two_instructions`. V03/V16 are new v1 transactions; V10 is a non-canonical length.
3. Inspect the first divergence. It compares a named profile's expected decision with the demo target's observed decision; it is not a security score.
4. Select **SOL_CONFORMANT_REFERENCE** and run again. Expect **CONFORMANT**, 30 matching rows and no divergence.
5. Under **Download & reproduce**, select **Replay report**. Expect **Replay matched**, with **bundle yes** and **semantics yes**. Download the report and keep it for local reproduction.

The deliberately broken reader is Raven's demonstration fixture. This does not establish a defect in a customer's decoder. The experimental profile is not a claim of universal transaction correctness.

At the 10 October 2026 dry run, the hosted page asserted build `dba22af0006faa2be9c45268b33534e2d19a543c`; the reproduction pin `2cb12875b2a0f65b8a59999ffa33807e35a81e43` has identical product code because the intervening merge changed only `README.md` and `JUDGE_START_HERE.md`.

If the hosted page is unavailable, reproduce the same corpus locally in a **separate** checkout. This older pin reproduces Conformance; it does not contain the new Agent Trust convenience command:

```sh
git clone --recurse-submodules https://github.com/billybotticelli4u-collab/raven-worldsfair-2026.git raven-conformance-reproduction
cd raven-conformance-reproduction
git checkout --detach 2cb12875b2a0f65b8a59999ffa33807e35a81e43
git submodule update --init --recursive
```

Use Node **22.18.0** for the recorded reproduction. No npm install is required for the Conformance CLI. Continue with [Conformance corpus](#conformance-corpus) below.

### Other workflows and source access

| Workflow | What to try | Location |
|---|---|---|
| Local saved-case Replay | Create → export → reload → import → rerun against a reference → inspect changes → download report | `apps/raven-replay`, local browser on port 8794 |
| Conformance report replay | Run the reference and deliberately broken target on the same 30 rows, inspect differing rows, replay the report | Conformance app, local browser on port 8791, or the hosted page above |

### Local saved-case Replay

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

### Conformance corpus

In a second terminal, from the repository root:

```sh
cd apps/raven-conformance
node src/server.js
```

Open http://127.0.0.1:8791 and select **Solana transaction versions**. If port 8791 is busy, choose a free port with `PORT=<free-port> node src/server.js` and open that address instead. The reference should match 30/30. The intentionally broken subtle target passes 27 rows and differs at V03, V10 and V16: three rows covering two defect classes. These are Raven-owned offline demonstration targets, not evidence that a customer's SDK is defective.

For command-line reproduction:

```sh
node src/cli.js --profile solana --target SOL_CONFORMANT_REFERENCE --run-id judge-reference
node src/cli.js --profile solana --target SOL_BROKEN_SUBTLE --run-id judge-subtle
# The deliberately divergent run returns exit1.
node src/bin/replay.js --report reports/judge-reference.json
```

The reproduce commands printed by the app and packaged in each report clone this public repository and check out the commit the running instance asserts (`FAIR_BUILD_COMMIT`, shown by `/api/build-info`). No separately supplied packet is needed. The [source map](INTEGRATION_SOURCE_MAP.json) records where each component came from.

### Delivery details and provenance

Local saved-case Replay cannot save Solana v1 results. Conformance has separate v1 fixtures and policies; its results do not establish v1 support in saved-case Replay. Customer parsers require scoped engineering. Technical lineage and review history are in the [provenance appendix](docs/hackathon/worldsfair-2026/JUDGE_PROVENANCE_APPENDIX.md).

Reports are unsigned. MATCH means the retained expectation reproduced, not that a transaction is safe. Exported cases contain input bytes; detailed reports can expose reconstructible input. Use synthetic or public, non-sensitive inputs. No wallet, signing or RPC is required for these examples. Installing dependencies requires registry access or a complete cache. A subprocess is not a sandbox.

This repository's main-branch Vercel configuration hosts Conformance, not the local Replay prototype in `apps/raven-replay`. To inspect hosted Replay, use the [public hosted Replay source](https://github.com/billybotticelli4u-collab/raven-worldsfair-2026/tree/51b60b7b9220d52f95ef747abc0ca5c97250b9e0/apps/raven-replay-hosted). In a **separate clone**, fetch and check out its recorded source:

```sh
git fetch origin codex/hosted-replay-source-recovery-51b60b7-20261003
git checkout --detach 51b60b7b9220d52f95ef747abc0ca5c97250b9e0
```

Then read `apps/raven-replay-hosted/README.md` and `DEPLOYMENT.md`. This checkout is source access, not a one-command hosted deployment: hosted runs also require an operator-provisioned execution snapshot and admission store. No service keys are needed to read the source. This guide does not claim current snapshot validity, deployed-source identity, hosted acceptance, or resolution of third-party distribution questions. If hosted Replay cannot execute, use Conformance or the local prototype within their own stated scopes; neither is a substitute measurement of hosted Replay.

A push to this repository may trigger hosting automation. SDK package metadata and the SDK-local LICENSE record Apache-2.0, matching the repository license. The existing pre-Fair foundation disclosure remains in README.md. This document does not certify contest eligibility, portal submission or final media readiness.

### Third-party decoder measurements

On the **13 structural rows** of Raven's 30-vector experimental corpus, unmodified published decoders matched as follows: Kit 8.4.0 and 8.3.0 each 11/13; Kit 4.0.0 9/13; Kit 3.0.3 8/13; web3.js 1.99.0 (`VersionedTransaction.deserialize`) 12/13; solders 0.29.0 11/13. The Node adapters ran in Raven's official sandboxed runner; solders used a separate harness. These are not quality rankings: three other rows test adapter JSON/base64 handling and fourteen test sanitize/policy rules the decoders do not claim to enforce. Older Kit versions can score higher overall merely by refusing every v1 transaction. Structural differences concern unsupported v1 layouts, a version check fixed in Kit 4.0.0, and trailing-byte tolerance. A separate standalone check showed Kit 3.0.3, 4.0.0, 8.3.0 and 8.4.0, and web3.js 1.99.0 accepting a non-minimal account-count encoding (`82 00` for 2), while solders rejected it. Impact is unassessed. V10 hints at this only on older versions; **no current corpus row isolates that behavior**. Both valid v1 vectors were made with Kit 8.3.0 and accepted by web3.js and solders, supporting rather than proving the experimental layout.

Read the [full measured results and V10/standalone-reproducer distinction](docs/hackathon/worldsfair-2026/THIRD_PARTY_DECODER_RESULTS.md). KIMI confirmed the summary against retained evidence; the decoder campaign itself remains Billy's executed evidence.
