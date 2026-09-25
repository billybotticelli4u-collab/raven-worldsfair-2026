# Raven — local judge candidate

**Unpublished candidate. Independent delivery review is pending.** Two separate workflows are included. Choose one below; their uses of “replay” are different.

| Workflow | What to try | Location |
|---|---|---|
| Saved parser regression cases | Create → export → reload → import → rerun against a reference → inspect changes → download report | Raven Replay, local browser on port 8794 |
| Named Conformance corpus | Run the reference and deliberately broken target on the same 27 rows, inspect differing rows, replay the report | Conformance app, local browser on port 8791 |

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

Open http://127.0.0.1:8791 and select **Solana transaction versions**. The reference should match27/27. The intentionally broken subtle target differs at V03, V10 and V16: three rows covering two defect classes. These are Raven-owned offline demonstration targets, not evidence that a customer's SDK is defective.

For command-line reproduction:

```sh
node src/cli.js --profile solana --target SOL_CONFORMANT_REFERENCE --run-id judge-reference
node src/cli.js --profile solana --target SOL_BROKEN_SUBTLE --run-id judge-subtle
# The deliberately divergent run returns exit1.
node src/bin/replay.js --report reports/judge-reference.json
```

The report's packaged clean-clone recipe refers to the separately supplied `solana-reproduction/` packet. That packet reproduces these exact Conformance app bytes at its own source commit; it does not claim the whole integrated repository has that commit. The [source map](INTEGRATION_SOURCE_MAP.json) binds both components.

## Scope and delivery

Replay uses the legacy inspector and registered adapters from SDK dbcee545. It cannot save Solana version1 results. The separate reviewed version1 CLI successor is not integrated here. Conformance has its own version1 fixtures and policies; its result is not Replay version1 support. Customer parsers require scoped engineering.

Reports are unsigned. MATCH means the retained expectation reproduced, not that a transaction is safe. Exported cases contain input bytes; detailed reports can expose reconstructible input. Use synthetic or public, non-sensitive inputs. No wallet, signing or RPC is required for these examples. Installing dependencies requires registry access or a complete cache. A subprocess is not a sandbox.

The existing Vercel configuration hosts Conformance, not this local Replay app. The remote repository has recorded Preview and Production deployments; a push may trigger hosting automation. No publication or deployment is part of this local packet. SDK package metadata still says UNLICENSED while the outer project has Apache2.0 text; ownership/license intent must be resolved before public-source distribution. The existing pre-Fair foundation disclosure remains in README.md. This document does not certify contest eligibility, portal submission or final media readiness.
