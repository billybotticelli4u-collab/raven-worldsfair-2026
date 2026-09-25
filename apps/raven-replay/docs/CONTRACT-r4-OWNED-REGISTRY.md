# Contract addendum r4 — supervisor-owned spawn registry

## Problem

PPID-walk cleanup fails when the worker is killed first: the detached adapter is reparented to init and becomes invisible.

## Mechanism (no vendor edits)

1. Per-session `RAVEN_OWNED_REGISTRY` jsonl created by `cases-server`.
2. Worker forked with `NODE_OPTIONS=--import src/adapter-observe-hook.mjs`.
3. Hook patches CJS `child_process`; forwards itself **only** into Node children running `watchdog-exec.mjs`.
4. Watchdog’s detached adapter spawn is appended as `raven-owned-group/1 {pgid, leaderPid}`.
5. `cleanupOwnedSession` kills snapshot ∪ registry PGIDs with a **PID-reuse guard** (`ps` must show leader still has recorded pgid before signal).

## Four paths

normal completion · forced deadline · worker failure (SIGKILL worker → registry cleanup) · server shutdown
