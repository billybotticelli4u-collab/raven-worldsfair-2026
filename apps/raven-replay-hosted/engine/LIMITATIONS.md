# Limitations (honest)

- Digests establish installed-byte consistency, not publisher authentication.
- Subprocess containment (hard-deadline process-group SIGKILL) is not a security sandbox.
- The closure guard (DCB-2 S1) bounds module loads to the inventoried closure; it does not see `fs`+`vm`/`eval` code, native addons loaded by path, or children that replace their environment or whose failure the adapter ignores. Exit 126 is a reserved convention, not provenance. `module.registerHooks` is experimental on the pinned Node 22.18.0.
- Four SDK child-runtime files are byte-bound: the watchdog, closure guard, adapter observer hook and process-identity helper. Parent-side SDK code (runner/cases/binding/cli) is the verifier and is identified only by the `tool` string. Hash-then-execute leaves a TOCTOU window for every inventoried file.
- Cases bound to execution policy `/1` are refused (`INVALID_CASE`) under `/2`; there is no automatic migration (`docs/MIGRATION-POLICY-2.md`).
- `@solana/kit` adapter performs offline wire/message decode only — not signature verification, transaction safety, RPC, confirmation, or chain execution.
- This package is a **separate CLI module**; the accepted Replay UI is not integrated here.
- Platform: Darwin arm64 measured in successor evidence; **Linux UNMEASURED**.
- Author/regression tests ≠ independent PASS. No self-GO; CODEX rechecks before KIMI final integration.
- Regulatory / legal attachment (if present) is not customer-copy authority.
