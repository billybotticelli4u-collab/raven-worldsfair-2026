# Contract addendum r3.2 — adapter group cleanup (C1)

Supersedes the R2/r3.1 claim that a detached SDK watchdog remains armed after outer `kill(-workerPgid)`.

**Fact (Darwin + Linux):** watchdog shares the worker PGID; only the adapter is detached. Outer worker-group kill reaps the watchdog; the adapter survives.

**Required behaviour:** `cleanupOwnedSession(workerPid)` snapshots PPID descendants’ PGIDs via portable `ps`, then kills **all** those groups (async). Applies on normal completion, deadline, and server shutdown.
