# raven-replay-parser-sdk (milestone 1 — C1–C6 successor)

**Separate CLI module** for offline Replay adapter cases with a pinned `@solana/kit` transaction wire/message decoder.

- Not a production release.
- Digests = consistency of measured bytes, **not** publisher authentication.
- Bounded subprocess ≠ security sandbox.
- Kit = offline wire/message decode only (no signature verification, tx safety, RPC, confirmation).
- Accepted capture/saved-case **UI is not integrated** in this package.
- Requires **Node.js v22.18.0** exactly.

Predecessor tip `a8f2fa7c` (CODEX CHANGES). This tree repairs SDK-C1…C6 in one separately identified successor. Synthetic git import — not ancestry from accepted Replay.

See `CONTRACT.md`, `LIMITATIONS.md`, `TEST-MATRIX.md`.
