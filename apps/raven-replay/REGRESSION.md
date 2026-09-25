# Saved Replay cases — local development candidate

CODEX authored this addition. Independent review pending. The original Replay V2 archive and trial archive are unchanged. This candidate adds a CLI and library; it does not yet add browser controls.

A case records a supported input and its complete expected tool execution. Run saved cases again to check whether the pinned inspector still produces those exact results. An expected parser REJECT can MATCH: MATCH means the saved expectation reproduced, never that the transaction is safe.

## Try it

Use exactly Node.js 22.18.0. No dependency installation, account, RPC or wallet is needed.

```sh
node src/cases-cli.mjs save examples/legacy-transaction.base64 my-case.json my-case
node src/cases-cli.mjs run my-case.json
node src/cases-cli.mjs run examples/cases/legacy-accept.json examples/cases/truncated-reject.json
```

Save never overwrites an existing file. Case names must be unique in a batch. At most ten cases run sequentially, each with the existing bounded subprocess policy. Only the bundled unchanged legacy transaction-byte inspector is supported. Cases are data and cannot choose code, commands, filesystem paths or network destinations.

This first increment checks repeatability with the current pinned tool and runtime. A different tool/runtime version is refused rather than compared. Comparing two supported software versions needs a separate explicit version-binding design; it is not implemented here. The regression control in the author tests changes the saved expected output; it does not demonstrate an actual new parser bug.

Save returns `case_content_sha256`: SHA-256 of the case's canonical JSON, with recursively sorted object keys and no whitespace. This is **not the hash of the pretty-printed file**. Keep that digest separately to detect replacement:

```sh
node src/cases-cli.mjs run --expect-sha256 YOUR_RETAINED_CONTENT_DIGEST my-case.json
```

Supply the actual 64-character lowercase digest. Without a supplied digest the report says `NOT_PROVIDED`; the result compares against whatever expectation is in the local case. A reference changed together with the case cannot authenticate it. These are user-controlled expectations, not signed attestations or independent proof that the expected answer is correct. Case files include the original input; use synthetic/public non-sensitive input for examples or sharing.

## Stable outcomes

| Exit | Outcome | Meaning |
|---|---|---|
| 0 | MATCH | All expected complete executions reproduced, including any expected parser refusal. |
| 1 | REGRESSION | Tool completed but its full execution/output differs from the saved expectation. |
| 2 | INVALID_CASE | Malformed/unsupported case, mismatched supplied reference, or invalid invocation. |
| 3 | RUN_ERROR | Wrong installed runtime, missing/changed local tool, incomplete execution or file/runner error. |

Batch exit precedence is 3, then 2, then 1, then 0. An execution failure never passes because it resembles an expected failure. JSON reports retain expected and actual parser decisions separately, plus field paths and value digests for changed fields. Inputs and raw transcripts are omitted from reports. No automatic baseline update occurs.

## Interface contract for the separate UI author

`src/cases.mjs` exports `createCase(inputBase64, {name})`, `parseCase(jsonText)`, `runCase(case, {expectedCaseSha256})`, and `runCases(cases, {expectedCaseSha256s})`. Creation returns `{case, case_content_sha256, limits}`. Batch runs return `{schema, exit_code, counts, results, limits}`. Functions are synchronous. A local HTTP wrapper must impose request-size, origin, loopback, concurrency and total-work limits; the library is not an HTTP security boundary. Never accept paths or uploaded executable code through that wrapper.

UI labels should show the comparison result and parser decision separately. Show whether a reference was provided. The browser is not an independently trusted reference source. Keep the original capture/replay/challenge flow intact in its separate files.

## Frozen base record

Inherited README and SOURCE describe the earlier V2 prototype, including historical review-status text. They are preserved byte-for-byte, not a claim that this addition has their approval. Inherited SHA256SUMS covers the original 16 files only. The complete successor file inventory and review identity are in the separately produced delivery pack; do not treat the old checksum list as covering these new files.
