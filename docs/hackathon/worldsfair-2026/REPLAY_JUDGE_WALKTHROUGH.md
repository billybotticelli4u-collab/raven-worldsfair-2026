# Raven Replay — local judge walkthrough

This is a prepared submission candidate, not a published release. Save an observed parser result, retain its reference, then reproduce it. MATCH means reproduction, not transaction safety. An expected parser REJECT can MATCH.

## Start

Use exactly Node v22.18.0 and npm 10.9.3. From this repository:

```sh
cd apps/raven-replay
shasum -a 256 -c SHA256SUMS.txt
node --version
npm --version
cd vendor/raven-replay-parser-sdk
npm ci
cd ../..
./bin/raven-replay --node "$(command -v node)" --port 8794
```

On Linux use `sha256sum` instead of `shasum -a 256`. Use a clean shell without Node preload overrides or RAVEN_TEST_* variables. Open http://127.0.0.1:8794/cases. No wallet or RPC is needed; installation requires npm access or a complete cache. Stop with Ctrl-C and wait for cleanup. Heed warnings about possibly surviving processes.

## Demonstrate

1. Load the synthetic example, name a case, choose the Solana Kit adapter and create. ACCEPT means the decoder completed.
2. Export the case JSON and retain its displayed canonical digest separately. This is not the raw download's SHA-256.
3. Reload to clear memory. Import the downloaded case, enter the retained reference, rerun and inspect MATCH, reference and execution separately.
4. Change one character in the reference and rerun: expect INVALID_CASE and NOT_RUN. Restore the original reference.
5. Import `examples/cases/changed-expectation.json` from the Replay app directory. This labelled legacy-inspector control deliberately changes an expectation; rerun to see REGRESSION and changed fields. It is not a discovered SDK defect.
6. Download the default report. Detailed SDK reports are opt-in and may contain reconstructible input; exported cases already contain input bytes.

## Boundaries

The browser includes the legacy inspector and registered adapters from SDK dbcee545. Customer integration requires engineering. This browser cannot save Solana version-1 results; the separate v1 CLI successor and customer prototypes are not included. The public Conformance app's replay workflow is separate. No new Vercel route is configured.

Reports are unsigned. Hashes bind bytes, not publisher authenticity. Subprocesses are not a sandbox. Windows is unmeasured. Prior browser reviews cover unchanged source; this new repository placement and documentation require independent delivery review. See REPLAY_SOURCE_RECORD.json and the app's REVIEW-STATUS.md.

Before publication/submission, resolve source-access authorization, the portal's actual required fields, final video, and competition-work disclosure. Existing foundation disclosures remain applicable. The source record is not an organizer eligibility decision.
