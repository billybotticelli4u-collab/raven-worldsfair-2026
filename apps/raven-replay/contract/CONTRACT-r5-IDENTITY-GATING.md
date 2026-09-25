# CONTRACT r5 — Identity-gated signaling (closes R4-C1)

## Requirement

Every production signal (SIGTERM, SIGKILL escalation, per-pid, deprecated group helpers)
MUST re-check ownership identity at the moment of signalling. Mismatch or unavailable
proof aborts that target with **no** escalation and **no** raw `process.kill` fallback.

## Identity record

`{ pid, pgid, lstart, command }` captured at spawn (observe hook) and/or live snapshot
via `ps -o pid=,pgid=,lstart=,command= -p` (Linux + Darwin).

## API

- `captureIdentity(pid)`
- `identitiesMatch(recorded, live)`
- `safeSignalIdentity(identity, sig)` — refuse on mismatch
- `killOwnedIdentity(identity, {termMs,killMs})` — TERM then conditional KILL; each gated
- `cleanupOwnedSession(rootPid, {registryPath, extraIdentities})` — registry ∪ snapshot only

## Explicitly removed

- Unguarded `process.kill(-pgid|'SIGKILL')` after a refused `safeSignalGroup`
- Raw PID cleanup loops after guarded cleanup

## Residual risk (honest)

TOCTOU between the last successful identity check and `process.kill` remains. PID/PGID
equality alone does **not** prevent reuse; lstart+command narrow but do not close the
window on a preemptive kernel.

## Tests

Mismatch control (target survives) · four paths · GET latency · finally reap · post-suite ps clean
