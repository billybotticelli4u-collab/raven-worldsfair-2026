# Process-group supervisor (portable) — R6

## SDK process shape

- Worker forked `{detached:true}` → leads PGID.
- Vendored `runner.mjs` `spawnSync(watchdog)` → **same PGID** as worker (env `PATH:''`).
- Vendored `watchdog-exec.mjs` `spawn(adapter, {detached:true})` → **own PGID**.

## R6 identity (closes Claude B1)

1. Capture via **absolute** `/bin/ps` or `/usr/bin/ps` (never PATH).
2. Record only **complete** `{pid,pgid,lstart,command}`; incomplete refuse at record and signal time.
3. Match: **exact** normalized equality (trim + collapse whitespace) on all four fields — **no** substring, **no** empty wildcards.
4. **Unreadable** ps (exec/parse failure) ≠ **gone** (ESRCH). Cleanup reports `ok:false` / `unknown`, never success-as-gone.
5. Registry still reaps owned detached adapters after worker death (orphan path).

## Residual risk (honest)

TOCTOU between last check and `process.kill`. `lstart` is 1-second granularity; same-second PID reuse with matching pgid+command can still pass.
