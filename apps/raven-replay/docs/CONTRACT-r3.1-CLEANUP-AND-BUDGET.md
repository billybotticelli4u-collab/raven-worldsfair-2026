# Contract addendum r3.1 — portable cleanup + WORK_BUDGET

Supplements `REPLAY-SDK-BACKEND-CONTRACT-r3`.

## WORK_BUDGET (restored)

Exact archive shape:

- HTTP **429**
- JSON `{ error, kind: 'WORK_BUDGET' }` with message prefix `Local work budget used:…`
- Header **`Retry-After`** (seconds)

Distinct from single-flight **`BUSY`** (also 429 + Retry-After, different kind/message).

## Supervisor (portable)

See `docs/SUPERVISOR.md`. Process-group ownership via `fork({detached:true})`; `kill(-pgid)` TERM→KILL; async `setTimeout` grace (no `/proc`, no sync spin on the HTTP thread).

**Limit:** `setsid` / nested `detached:true` escapes the owned group (SDK watchdog intentionally uses its own group).
