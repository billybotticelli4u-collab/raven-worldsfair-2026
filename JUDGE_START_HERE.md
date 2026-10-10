# Raven — judge start

Raven helps Solana apps test transaction readers against stated rules and verify offline receipts before agents act.

## Two minutes, nothing to install

Open [Raven Conformance](https://raven-worldsfair-2026.vercel.app/). Select **Solana transaction versions** and **SOL_BROKEN_SUBTLE**; click **Run Conformance (live)**. Inspect three differences. Run **SOL_CONFORMANT_REFERENCE**, then **Replay report**.

## Agent Trust, offline

In a recursive clone (setup below), run this command; the second fixture changes one finding code without resigning:

```sh
NODE_OPTIONS=--experimental-strip-types node --input-type=module -e 'import {runMachineExchange} from "./apps/worldsfair-agent-trust/src/lib/runSlice.js"; for (const path of ["path_a_verified", "path_b_tampered"]) console.log(`${path}: ${(await runMachineExchange(path)).outcome}`)'
```

| Run | Expected output |
| --- | --- |
| Broken demo reader | DIVERGENT: 27 match, 3 differ — V03, V10, V16 |
| Reference demo reader | CONFORMANT: 30/30; report replay matches |
| Agent Trust valid fixture | `path_a_verified: PROCEED` |
| Agent Trust one-field tamper | `path_b_tampered: REFUSE` |

## Scope and limits

The hosted Conformance page runs Raven-owned demo targets. The experimental 30-vector profile is a finite stated rule set, not a universal correctness or safety verdict. Agent Trust uses a deterministic offline receipt fixture (`liveAcquisition:false`), not a live-chain fetch. Conformance and saved-case Replay reports are unsigned; MATCH means a retained result reproduced, not that a transaction is safe.

Reviews are internal and bounded, not external audits. Neither hosted page runs code a visitor uploads; a customer's decoder requires a local adapter and scoped engineering. **Disclosure / Build Info** asserts the hosted build commit but does not prove the served bytes.

### Conformance walkthrough

No wallet, sign-in or transaction fetch is needed.

1. Select **Solana transaction versions** (Experimental). Check that the scope shows **30 vectors**, corpus **1.4**.
2. Select **SOL_BROKEN_SUBTLE**, then **Run Conformance (live)**. Expect **DIVERGENT**, with 27 matching rows and three divergences: `V03_valid_v1`, `V10_noncanonical_shortvec_sigcount`, and `V16_valid_v1_two_instructions`.
3. Inspect the first divergence. It compares a named profile's expected decision with the demo target's observed decision; it is not a security score.
4. Select **SOL_CONFORMANT_REFERENCE** and run again. Expect **CONFORMANT**, 30 matching rows and no divergence.
5. Under **Download & reproduce**, select **Replay report**. Expect **Replay matched**, with **bundle yes** and **semantics yes**. Download the report and keep it for local reproduction.

The deliberately broken reader is Raven's demonstration fixture. This does not establish a defect in a customer's decoder. The experimental profile is not a claim of universal transaction correctness.

At the 10 October 2026 dry run, the hosted page asserted build `dba22af0006faa2be9c45268b33534e2d19a543c`; the reproduction pin `2cb12875b2a0f65b8a59999ffa33807e35a81e43` has identical product code because the intervening merge changed only `README.md` and `JUDGE_START_HERE.md`.

If the hosted page is unavailable, reproduce the same corpus locally with the commands below. This recursive clone also supplies Agent Trust's pinned verifier. Start in a new folder:

```sh
git clone --recurse-submodules https://github.com/billybotticelli4u-collab/raven-worldsfair-2026.git
cd raven-worldsfair-2026
git checkout --detach 2cb12875b2a0f65b8a59999ffa33807e35a81e43
git submodule update --init --recursive
```

Use Node **22.18.0** for the recorded reproduction. The pinned commit's old guide says 27 rows; corpus 1.4 and the retained results here have 30. From this repository root, the Agent Trust command on the first screen prints PROCEED then REFUSE. Its valid and tampered fixtures differ only at `findings[0].code`; the signature is unchanged. No npm install is required for Agent Trust or the Conformance CLI. The verifier is supplied by the submodule, not npm.

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

Open http://127.0.0.1:8791 and select **Solana transaction versions**. If port 8791 is busy, choose a free port with `PORT=<free-port> node src/server.js` and open that address instead. The reference should match 30/30. The intentionally broken subtle target passes 27 rows and differs at V03, V10 and V16: three rows covering two defect classes. Rows 28 to 30 were added in corpus 1.4; the original 27-row corpus file is preserved in the repository. These are Raven-owned offline demonstration targets, not evidence that a customer's SDK is defective.

For command-line reproduction:

```sh
node src/cli.js --profile solana --target SOL_CONFORMANT_REFERENCE --run-id judge-reference
node src/cli.js --profile solana --target SOL_BROKEN_SUBTLE --run-id judge-subtle
# The deliberately divergent run returns exit1.
node src/bin/replay.js --report reports/judge-reference.json
```

The reproduce commands printed by the app and packaged in each report clone this public repository and check out the commit the running instance asserts (`FAIR_BUILD_COMMIT`, shown by `/api/build-info`). No separately supplied packet is needed. The [source map](INTEGRATION_SOURCE_MAP.json) records where each component came from.

### Delivery details and provenance

Replay uses the legacy inspector and registered adapters from SDK dbcee545. It cannot save Solana version1 results. The separate reviewed version1 CLI successor is not integrated here. Conformance has its own version1 fixtures and policies; its result is not Replay version1 support. Customer parsers require scoped engineering.

Reports are unsigned. MATCH means the retained expectation reproduced, not that a transaction is safe. Exported cases contain input bytes; detailed reports can expose reconstructible input. Use synthetic or public, non-sensitive inputs. No wallet, signing or RPC is required for these examples. Installing dependencies requires registry access or a complete cache. A subprocess is not a sandbox.

This repository's main-branch Vercel configuration hosts Conformance, not the local Replay prototype in `apps/raven-replay`. To inspect hosted Replay, use the immutable source link above. In a **separate clone**, fetch and check out its recorded source:

```sh
git fetch origin codex/hosted-replay-source-recovery-51b60b7-20261003
git checkout --detach 51b60b7b9220d52f95ef747abc0ca5c97250b9e0
```

Then read `apps/raven-replay-hosted/README.md` and `DEPLOYMENT.md`. This checkout is source access, not a one-command hosted deployment: hosted runs also require an operator-provisioned execution snapshot and admission store. No service keys are needed to read the source. This guide does not claim current snapshot validity, deployed-source identity, hosted acceptance, or resolution of third-party distribution questions. If hosted Replay cannot execute, use Conformance or the local prototype within their own stated scopes; neither is a substitute measurement of hosted Replay.

A push to this repository may trigger hosting automation. SDK package metadata and the SDK-local LICENSE record Apache-2.0, matching the repository license. The existing pre-Fair foundation disclosure remains in README.md. This document does not certify contest eligibility, portal submission or final media readiness.

**Third-party decoder result:** pending. The 30-row demonstration above has not been represented as a result against an unmodified third-party decoder.
