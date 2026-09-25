# Raven Replay — local working prototype

Version 0.0.2. Author: CODEX. Independent review pending. Not a production release.

Inspect local Solana transaction bytes, capture the real tool output, replay it, and challenge changed evidence. The bundled inspector is Raven's unchanged experimental parser. This is **not** a transaction safety check, signature verification of the transaction, or evidence of an on-chain action.

## Start

Requires exactly **Node.js 22.18.0**. No dependency installation or account is needed.

```sh
node --version
node --test test/*.test.mjs
node src/server.mjs
```

Open `http://127.0.0.1:8794`. Paste transaction bytes encoded as base64, load your file, or use the explicitly labeled synthetic example. Inspect, replay, download, then challenge a copy. The server listens only on loopback. Stop it with Ctrl-C.

The example is Raven-owned, generated offline with synthetic keys. It is not a real chain observation. Your own input is supported; its provenance is not automatically established.

## Agent/tool path

A local agent can call the same implementation without the browser:

```sh
node src/cli.mjs capture examples/legacy-transaction.base64 evidence.json
node src/cli.mjs verify evidence.json
```

Capture prints a body digest and temporary signer fingerprint. To compare against an independently obtained reference:

```sh
node src/cli.mjs verify evidence.json EXPECTED_BODY_SHA256 TRUSTED_SIGNER_FINGERPRINT
```

Supply actual 64-character lowercase hexadecimal values instead of those names. The output file must not already exist. The capture is the actual subprocess invocation, not a fabricated UI result. The caller's label is self-declared and never treated as established identity.

## Read the axes, not one green badge

- Integrity: does the evidence body match its declared digest?
- Signature: is that digest validly signed under the embedded key?
- Reference: does the body match the digest you supplied separately?
- Signing key: does it match the separately supplied fingerprint? This alone does not identify an organization.
- Replay: did the pinned tool reproduce the complete execution/output record?
- Caller identity: not established by this prototype.
- Chain anchor: not checked or created.

CLI verify exits zero for a successful replay with no check failures. It can do so with no external reference or trusted signer configured; the output explicitly says NOT_PROVIDED / NOT_ESTABLISHED. It is not an authorization decision.

All example signatures use ephemeral keys held only in memory. No private key is written, no wallet is opened, and no RPC or transaction submission is performed. A new capture uses a new key. The existing session's reference is useful for the local challenge demonstration; distributing evidence and a replaceable reference together does not establish authenticity.

## What replay cannot prove

A different genuine input can be inspected, re-hashed and signed by someone else and reproduce correctly. Without an independently retained reference or trusted signer it cannot be identified as replacement of an earlier capture. Replay also cannot prove a claimed timestamp or caller identity. It demonstrates current reproducibility of recorded tool output, not historical execution by a named person or agent.

The parent runs only the fixed allowlisted tool, with a Node permission limit on filesystem access, a timeout and output cap. Node permission flags are not an OS network sandbox. The bundled tool makes no network call. Do not use this prototype to execute arbitrary uploaded code.

## Package checks and portability

Before extraction, verify the ZIP SHA-256 against the separately supplied value. After extraction, `SHA256SUMS.txt` covers the shipped files. Those checks prove consistency with the reference you trust, not origin by themselves. No Git history, local evidence, credentials or private signing material is included in the ZIP.

Author checks: 27/27 automated controls on macOS, Node 22.18.0. The local browser capture → replay → altered-copy refusal was exercised. Chrome downloaded the evidence and detached reference; the downloaded pair also reproduced through the CLI. Version 0.0.2 labels the evidence selected for verification and keeps its raw view aligned with those results. Capture exports and challenges remain explicitly scoped to the browser capture. Linux execution, full accessibility audit, and independent stranger reproduction are not yet established. SOURCE.json binds the unchanged parser and example provenance. See LIMITATIONS.md before using the results.
