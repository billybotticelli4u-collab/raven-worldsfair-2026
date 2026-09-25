# CONTRACT r6 — Strict identity (Claude B1)

- ps: absolute path only (`/bin/ps` then `/usr/bin/ps`).
- Normalization: trim + collapse whitespace; exact equality for `lstart` and `command`.
- Missing/empty field at record or signal ⇒ refuse (never wildcard).
- Unreadable ≠ gone; cleanup must not report success when identity unreadable.
- Preserve orphan adapter cleanup after worker death once complete identities are recorded.
