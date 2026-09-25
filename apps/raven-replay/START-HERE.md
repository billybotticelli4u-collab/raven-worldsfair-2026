# Raven Replay — local browser handover

This is a documentation and checksum successor of browser candidate e647ef2e. Product code is unchanged. The predecessor has bounded review evidence; this delivery correction requires an independent check. See REVIEW-STATUS.md. No publication or deployment is authorized.

## Install and start

Use exactly Node.js v22.18.0. Put that runtime on PATH and check `node --version` before installation. Use npm 10.9.3 to reproduce the Linux binding environment; other npm installation behaviour is not claimed equivalent. Obtain runtimes from official sources and verify their published checksums.

Before extraction, check the archive against the separately retained delivery digest. From the extracted `raven-replay` directory, before installing dependencies:

```sh
shasum -a 256 -c SHA256SUMS.txt
node --version
npm --version
cd vendor/raven-replay-parser-sdk
npm ci
cd ../..
./bin/raven-replay --node "$(command -v node)" --port 8794
```

On Linux use `sha256sum -c SHA256SUMS.txt` for the first command. The expected versions are v22.18.0 and 10.9.3. Stop if a check fails. `npm ci` requires registry access or a complete local cache. Do not replace the lockfile or use npm install. The source checksum list intentionally excludes newly installed node_modules.

Use a clean environment without RAVEN_TEST_* variables, NODE_OPTIONS, NODE_PATH, LD_PRELOAD or other preload overrides. Open http://127.0.0.1:8794/cases. Use 127.0.0.1 rather than localhost. Choose a free port if 8794 is occupied. Stop with Ctrl-C and wait for the process to exit. An unreadable process identity is an error, not proof of successful cleanup; heed any possibly-still-running diagnostic.

## Demonstrate the saved-case journey

1. Load the synthetic example, name a case and select the bundled legacy inspector or the registered Solana Kit decoder. Create the case.
2. Export its case JSON. Retain the displayed case digest separately; it is the canonical case digest, not a hash of the formatted download.
3. Reload the page, import the downloaded case and enter the separately retained reference.
4. Rerun. MATCH means the expected result reproduced. It does not mean transaction safety. An expected parser REJECT can also MATCH.
5. For the legacy-only labelled changed-expectation control, import examples/cases/changed-expectation.json. Its deliberate expectation change should produce REGRESSION. This is synthetic, not a discovered SDK defect.
6. Download the default report. Check the case name, reference status, execution status and comparison outcome. Detailed SDK output requires explicit opt-in and can contain reconstructible bytes and arbitrary field names.

Cases live in the browser tab until exported. Case files contain the transaction bytes: use synthetic or public, non-sensitive input. Reports are unsigned. No wallet or RPC is required and no transaction is sent.

## Scope and evidence

The browser includes registered SDK adapters as well as the legacy inspector. Customer-specific integration still requires engineering. The vendored SDK remains dbcee545; it cannot save Solana version-1 results. The separate v1 successor is not included and its review does not transfer here. This browser journey is not a customer decoder-upgrade comparison.

The predecessor was exercised on macOS arm64 and Linux x86_64. Its reviewed Linux harness binding passed 129 checks; Mac runs remained INCOMPLETE because the harness lacked a declared Darwin browser payload digest. Those records are predecessor evidence, not automatic approval of this repackaging.

Subprocesses are not a sandbox. SIGKILL, power loss and processes escaping their sessions remain outside cleanup guarantees. Process identity has second-resolution and check-to-signal race limits. Windows and other browser engines are unmeasured. Internal hashes show consistency, not publisher authenticity.
