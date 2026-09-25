# Limitations (honest)

- Digests establish installed-byte consistency, not publisher authentication.
- Subprocess containment (hard-deadline process-group SIGKILL) is not a security sandbox.
- `@solana/kit` adapter performs offline wire/message decode only — not signature verification, transaction safety, RPC, confirmation, or chain execution.
- This package is a **separate CLI module**; the accepted Replay UI is not integrated here.
- Platform: Darwin arm64 measured in successor evidence; **Linux UNMEASURED**.
- Author/regression tests ≠ independent PASS. No self-GO; CODEX rechecks before KIMI final integration.
- Regulatory / legal attachment (if present) is not customer-copy authority.
