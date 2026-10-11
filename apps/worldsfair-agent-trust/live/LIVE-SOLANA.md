# LIVE-SOLANA: one real Raven receipt, checked on your own machine

`npm run demo:live-solana` asks the hosted Raven API for **one fresh signed
receipt** about a Solana token (BONK by default), then checks that receipt
**offline on your computer** with the same pinned verifier the offline demo
uses, and lets Agent A decide **PROCEED** or **REFUSE**. Then it changes one
field of that same receipt locally and shows that Agent A **REFUSES** it,
just like the offline demo.

> Status: built and tested **against a local stub server only**. The author
> never called the real hosted API and never handled a real key. Your first
> run is the first real run.

## The command (Glen)

From the repo folder, on Node 22.18 or newer:

```sh
read -rs RAVEN_API_KEY && export RAVEN_API_KEY   # paste your key, press Enter (nothing is shown)
npm run demo:live-solana
```

The one-line form also works, but it puts your key in your shell history:

```sh
RAVEN_API_KEY=... npm run demo:live-solana
```

Other token: `npm run demo:live-solana -- --mint <mint address>`
(add `--token-program TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` for a Token-2022 mint;
the default is the SPL Token program). Slow first answer (hosted service waking up):
`-- --timeout-ms 45000`. More calls for this run (default 3, at most 20):
`-- --max-calls 5`.

## What you should see

```
Live receipt from Raven API: VERIFIED -> PROCEED
  receiptId:   raven-receipt-v1:sha256:...
  ...
Same receipt, one field changed (slot N -> N+1): REFUSE  (reason: integrity_or_malformed)
HTTP calls used: 1 of 3 (budget; hard cap 20).
Run report (unsigned): apps/worldsfair-agent-trust/live/runs/live-solana-....json
```

Exit codes: `0` PROCEED and the tamper was refused · `2` refused before any
call (key not set, bad flag) · `3` a receipt arrived but Agent A REFUSED it
(the reason is printed) · `4` no receipt (HTTP error, timeout, network) ·
`5` self-check failed or internal error.

## What it checks before PROCEED

Agent A's existing policy (unchanged) on the repo's pinned verifier, **plus**
these live checks, each shown as OK / FAIL:

- signature verifies against the **pinned** Raven key `rvk_c2997e90215279c2`
  (taken from `vendor/raven-receipt-verifier`, never fetched live; `/pubkey`
  is not called);
- payload hash and receipt id recomputed locally; rules profile supported;
- the receipt is for the **mint and token program you asked for**, on solana-mainnet;
- **fresh**: issued at most `min(300 s, receipt.maxAgeSeconds)` ago and not
  more than 60 s in the future. The observed slot is printed, but not compared
  to the chain tip (that would need a Solana RPC, which this never calls).

## Hard limits (in code, tested)

- Key from the `RAVEN_API_KEY` environment variable only; sent only as the
  `x-api-key` header; never printed, logged or written (all output and the
  report are redacted). Arguments are never echoed.
- Exactly one endpoint: `POST https://raven-hosted-verifier.onrender.com/receipt/v1`
  with body `{"mintAddress","tokenProgramAddress"}` (the API's optional `commitment`
  defaults to `finalized` per its public OpenAPI schema). Nothing else: no liquidity
  or other endpoints, no Solana RPC, no wallet, no signing, no SOL spent.
- **Call budget: 3 HTTP calls per run by default** (a normal run makes 1, or 2
  with the single retry). `--max-calls N` may raise it up to the **hard cap of
  20**; any value above 20 (or 0, or not a whole number) is refused before
  any call — it is never silently clamped. One retry at most, only after a
  timeout, network error or HTTP 5xx. Per-request timeout (20 s default, 60 s
  max). Redirects are not followed. Programmatic callers that share a budget
  (`budget:` option) must pass one made by `createCallBudget`; any other object
  is refused (`call_budget_not_authentic`) before any call (call-budget authenticity regression).
- **API base allowlist.** `--api-base` (or `RAVEN_API_BASE`; the flag wins)
  accepts only `https://raven-hosted-verifier.onrender.com` (the default) or
  plain `http://` to a local stub on `127.0.0.1`, `localhost` or `[::1]`
  (which is how the tests run). Any other host — including lookalikes such as
  `raven-hosted-verifier.onrender.com.evil.tld`, other ports, `http://` to the
  real host, and user-info tricks like `https://raven-hosted-verifier.onrender.com@evil.tld`
  — is refused with a clear message before any request, so the key is never
  sent. The output says when an override is in use.

## Limits of what the result means

- The run report is **unsigned**: a local note, not evidence.
- A valid signature is **evidence, not authorization** to act.
- One token's measured scope at one slot, **not a safety verdict**; read the
  receipt's `coverageGaps` and `scopeChecksNotPerformed`.
- The Raven API is **alpha** (invite keys, rate limit ~15 requests/min per key).

## For developers

- Module: `live/liveSolana.js` — `fetchAndVerifyLiveReceipt({ apiKey, apiBase?, mint?, tokenProgram?, timeoutMs?, maxCalls?, clock?, fetchImpl?, budget? })`
  returns `{ ok, decision, reason, receipt, verification, tamperControl, report, error, httpCalls }`.
- Live-local hooks (`../INTERFACE.md`): `live/agentHooks.js` —
  `createLiveEvidenceProvider({ apiKey, apiBase?, timeoutMs?, maxCalls?, budget? })` (default budget 3, shared by all requests it serves) for
  `startAgentB(config, { evidenceProvider })`, and `liveVerifyEvidence` for
  `createAgentA({ verifyEvidence })`.
- Tests: `live/test/*.test.js` (registered via `test/live-solana.test.js`, so
  `npm --prefix apps/worldsfair-agent-trust test` runs them). Red controls:
  `node --experimental-strip-types apps/worldsfair-agent-trust/live/test/red-controls.mjs`.
- `live/test/testOnlySigner.js` generates an in-memory TEST-ONLY key; product
  code never imports it and the product path refuses what it signs.
