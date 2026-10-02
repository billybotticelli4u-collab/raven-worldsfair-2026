# Raven — judge start

**This repository is public.** Reviews of its contents are internal and non-author; none is an external audit. Two separate workflows are included. Choose one below; their uses of “replay” are different.

Hosted pages, no install needed:

- Conformance: https://raven-worldsfair-2026.vercel.app/ runs Raven-owned demo targets from this repository. **Disclosure / Build Info** on the page shows the commit the platform asserts it was built from; that is an assertion, not proof of the served bytes.
- Raven Replay: https://raven-replay.vercel.app is a separate hosted application that runs three fixed decoders. **Its source is not in this repository.** The `apps/raven-replay` directory below is an earlier local prototype, not that hosted page.

Neither hosted page runs code you upload. To run your own decoder, clone this repository and run Conformance locally.

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

This repository's Vercel configuration hosts Conformance, not the local Replay prototype in `apps/raven-replay`. The hosted Raven Replay page is deployed from separate source that is not published here, so it cannot be rebuilt from this repository. A push to this repository may trigger hosting automation. SDK package metadata and the SDK-local LICENSE now record Apache-2.0, matching the repository license. The existing pre-Fair foundation disclosure remains in README.md. This document does not certify contest eligibility, portal submission or final media readiness.
