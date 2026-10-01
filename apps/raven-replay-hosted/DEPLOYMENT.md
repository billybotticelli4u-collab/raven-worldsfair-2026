# Public host preparation — not deployed

Separate Vercel project rooted at apps/raven-replay-hosted. Do not change the
released Fair project's routing or root directory. Native /api Web handlers use
the public/ static assets. src/dev-server.mjs is local only and is deliberately
not named server.mjs, which Vercel otherwise auto-detects as an entrypoint.

Required server-only settings (no defaults that enable public spending):
- RAVEN_REPLAY_ORIGIN: exact HTTPS origin, no path or trailing slash.
- RAVEN_REPLAY_SNAPSHOT_ID and RAVEN_REPLAY_ENGINE_PIN_SHA256: provisioned pair.
- RAVEN_REPLAY_BUDGET_URL and RAVEN_REPLAY_BUDGET_TOKEN: writable Upstash REST store.
- RAVEN_REPLAY_BUDGET_NAMESPACE: stable across all production instances/deploys.
- RAVEN_REPLAY_RUNS_PER_MINUTE / RUNS_PER_DAY: explicit positive admission caps.
- RAVEN_REPLAY_FETCHES_PER_MINUTE / FETCHES_PER_DAY: separate retrieval caps.
- RAVEN_REPLAY_RPC_URL: optional fixed supported server-selected RPC endpoint.

Sandbox uses Vercel OIDC; no developer CLI credential belongs in production.
The snapshot is checked through the provider before each execution reservation.
Unavailable, mismatched, non-created or less-than-two-minutes-remaining snapshots
refuse execution. Non-expiring snapshots are allowed when the provider explicitly
returns no expiry. Refresh snapshots through the operator provisioning process,
review the new pin and expiry, then update the pair together. No cron was created.

The budget uses a single atomic Redis EVAL with Redis time and two rolling
windows (60 seconds / 24 hours). All regions must use the same writable store.
Requests reserve before RPC/VM execution. Failed attempts consume their admission;
no retry after an ambiguous store response. Missing/broken budget refuses work.
Only random attempt ids and admission timestamps are stored, never case payloads,
transaction signatures, IPs, reports or RPC credentials. Expiry is at most one day.
Use a dedicated non-evicting database: eviction, flush or manual deletion resets
these limits. This is an admission cap, not a dollar-accurate invoice cap or a
concurrent-VM semaphore. It does not cap costs of incoming HTTP requests themselves.
Provider spend controls and perimeter abuse protection are additional requirements.

Suggested initial limits for Owner review: 3 executions/minute, 300/24h;
20 fetches/minute, 2000/24h. These are proposals, not configured allowances.
Do not change namespace during a release to reset its budget. Previews require a
separate deliberately budgeted namespace; unconfigured previews fail closed.

Verified so far: local boundary tests. Real shared-store concurrent enforcement,
Vercel build output and actual hosted-origin journey remain unverified. No shared
store was provisioned, no credentials configured and no deployment created.

References checked 2 October 2026:
- https://vercel.com/docs/functions/runtimes/node-js
- https://upstash.com/docs/redis/features/restapi
