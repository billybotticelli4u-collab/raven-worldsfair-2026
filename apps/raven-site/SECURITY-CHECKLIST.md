# Raven Site + Hosted Verifier — Security & Abuse Checklist

Status as of 2026-06-05. Re-verify on every meaningful change (run test.mjs +
scripts/site-smoke.mjs).

## Hosted verifier (Render)
- [x] Strict request schema: validateSolanaVerifyTokenRequest; additionalProperties rejected
- [x] rpcUrl / issuerIdentity from callers: REJECTED with 400 (tested)
- [x] Fail-closed signer: cannot sign -> 503, never an unsigned verdict
- [x] Rate limits: 10/min per key, burst 4; per-IP 30/min
- [x] Quality Ledger sanitizer: allowlisted fields only; "NO SECRETS" test
      proves api keys / private keys / signatures / secret env never serialize
- [x] API keys only via env (RAVEN_API_KEYS / RAVEN_HOLDERS_BETA_KEYS); never logged

## Static site (Vercel)
- [x] No API keys, signing keys, or RPC URLs in any static file (test.mjs scans)
- [x] No live verify proxy => no per-IP throttle needed on Vercel (N/A by design;
      revisit if a live demo route is ever added — then add middleware throttle
      + graceful request-access fallback on 429/5xx)
- [x] Forms post via mailto / prefilled GitHub issue — no backend, no stored PII
- [x] GitHub path omits email (public repo); private path is email
- [x] Leads tracker (PII) is gitignored; only the blank template is committed
- [x] Analytics: Vercel Web Analytics + named intent events only; no third-party
      trackers, no fingerprinting, no PII in events

## Blackbox smoke (scripts/site-smoke.mjs)
Checks /, /request-access.html, /agents.json, /openapi.json, /security.html,
/receipts.html, verifier /healthz + /pubkey (and /verify only when
RAVEN_SMOKE_API_KEY is exported by the operator — never committed).

## Recurring obligation — security.txt Expires renewal (intentional hard gate)

`.well-known/security.txt` carries an RFC 9116 `Expires:` field (currently
`2027-08-19T00:00:00.000Z`). The test.mjs pin "vulnerability reporting route
exists and is linked (RFC 9116)" fails the site suite when `Expires` is
within 30 days — so with the current value, CI is expected to begin failing
around **2027-07-20** and to stay red until the date is renewed.

This is intentional expiry enforcement, not an error: an expired security.txt
is RFC-invalid, and a silently dangling disclosure route is the failure this
gate exists to prevent. The red CI is the reminder; it cannot be ignored.

To renew: edit `Expires:` in `.well-known/security.txt` to a new date (keep
it a valid RFC 9116 timestamp — ISO 8601; offsets and missing milliseconds
are accepted), confirm `Contact:` still points at the current ratified
security mailbox, and re-run `node test.mjs`. Renewal is an operator chore —
no separate role is defined, so whoever runs the release/deploy cycle owns
it. Do not weaken the 30-day threshold to silence the failure.
