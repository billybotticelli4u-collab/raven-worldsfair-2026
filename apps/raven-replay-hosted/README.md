# Raven Replay — hosted implementation in progress

This is a separate application under development. It is not a deployment of the
local Replay app and does not change the released Conformance routes.

The implemented journey is a Solana signature → retained mainnet transaction bytes
and provider-reported provenance → a saved SDK case → export → fresh import using
a separately retained digest → offline replay in a fresh cloud sandbox.
Raw-byte files and an explicitly synthetic example are also available.

## Current boundary

- Three fixed adapters are registered: pinned `@solana/kit` 8.3.0 and published
  3.0.3/4.0.0 decoder bundles. Upgrade comparison requires an existing case and
  its separately retained digest. It does not silently create a fresh baseline.
  The comparison backend and fresh-import browser flow have author measurements
  against an assembled cloud snapshot. Non-author review remains required.
- Legacy and v0 can become saved cases. Actual v1 transaction bytes can be fetched
  and exported, but case creation refuses them with `UNSUPPORTED_DECODER_VERSION`.
- `finalized`, slot, block time and network are provider-reported. Matching the
  requested signature to the wire's first signature is not cryptographic signature
  verification or independent proof of inclusion.
- Digests check retained bytes, not their origin. Reports are unsigned. A decoder
  ACCEPT or a replay MATCH is not a safety verdict.
- Case and transaction exports contain transaction bytes. The default replay
  report minimizes parsed content. Nothing is stored in a shared customer database.
- The fetch service knows the RPC endpoint. The decoder VM receives no RPC key,
  user-supplied code, endpoint, module path or environment.

## Execution

`ENGINE-SOURCE.json` preserves the original 44-file S2 source inventory at
`564cba333d27e6ee69ab7e98b39cb0a051ebe611`. `ENGINE-ASSEMBLY.json` describes this
assembly: 43 original files unchanged, one registry addition, six adapter files
added. SDK core code is unchanged. The old review does not cover this assembly.
The historical bundle imports were relocated inside each adapter’s own bound
directory; bundle bytes were not changed. See `ADAPTER-PROVENANCE.md`.

An operator constructs a snapshot through `scripts/provision.mjs`, which checks
source hashes, verifies the official Node 22.18.0 Linux archive, installs the
engine's locked dependencies without lifecycle scripts, runs its suite, switches
network policy to deny-all, and snapshots it. The returned snapshot ID and engine
pin digest are deployment configuration, never request parameters.

For each job `src/sandbox.mjs` starts a fresh, non-persistent sandbox with deny-all
network policy, no exposed ports, a 60-second VM lifetime and a 20-second command
deadline. The uploaded bootstrap checks the pinned engine source before importing
it. Success is withheld if sandbox shutdown is not confirmed. This relies on the
cloud provider's VM and firewall boundary; the SDK's module guard alone is not an
OS sandbox.

## Local development

Use Node 22.18.0. Run `npm ci --ignore-scripts`, then install the engine's locked
dependencies with `cd engine && npm ci --ignore-scripts`. Run `npm test` from this
directory. The tests exercise actual SDK processes and mock host boundaries;
separate cloud and browser evidence is required for an integrated claim.

The operator supplies `RAVEN_REPLAY_SNAPSHOT_ID` and
`RAVEN_REPLAY_ENGINE_PIN_SHA256`, plus Vercel OIDC authentication for the Sandbox
SDK, and runs `node src/server.mjs`. It binds only `127.0.0.1:8797`.
The server's 20-request/minute budget and two-job concurrency limit are explicitly
local-process limits. They are not adequate shared limits for a public deployment.
The generic API refuses execution if its deployment adapter supplies no budget
control.

## Before public release

Finish public deployment wiring and shared abuse
and spend controls, review the assembled source and dependency identity, obtain a
distinct non-author review, and repeat the browser journey on the actual hosted
origin. No public-release or customer-acceptance claim is made by this directory.
