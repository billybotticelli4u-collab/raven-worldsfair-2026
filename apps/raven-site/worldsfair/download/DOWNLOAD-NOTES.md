# Raven Conformance — public judge download

This download surface is for Crypto World's Fair judges and developers who want to run the Raven Conformance demo locally.

## Current public surfaces

- Fair landing: https://ravenattest.com/worldsfair/
- Public Judge UI: https://raven-worldsfair-2026.vercel.app/
- Public Judge UI build-info: https://raven-worldsfair-2026.vercel.app/api/build-info

The public Judge UI currently reports `identityStatus: UNKNOWN`. Treat that as an explicit limitation: the live build-info is not git-commit proof and not proof that the served bytes correspond to a particular local HEAD.

## Downloaded package

- File: `raven-conformance-judge-package-2026-09-20-34453300.zip`
- SHA-256: `34453300504b703b4c62de6ff5a885e80f8892c0217d66e1fb031716df3efe1e`

Verify the package before using it:

```bash
shasum -a 256 raven-conformance-judge-package-2026-09-20-34453300.zip
```

Expected output begins with:

```text
34453300504b703b4c62de6ff5a885e80f8892c0217d66e1fb031716df3efe1e  raven-conformance-judge-package-2026-09-20-34453300.zip
```

## Fresh local run

Unzip the package outside Downloads and follow only the included `DEVELOPER.md`.

The current sealed package's local server uses the URL printed by the server. In current rehearsals that is `http://127.0.0.1:8791/`. If a future package prints another local URL, use the printed URL rather than an older README value.

## Expected demo behavior

- `CONFORMANT_REFERENCE`: all 12 Raven-owned demo vectors match the expected profile and the result is CONFORMANT.
- `BROKEN_SUBTLE`: only V07 and V08 diverge; the result is DIVERGENT.
- Crash, timeout, invalid output, and output flood cases do not become PASS.

## Scope and limitations

- This is Raven Conformance's Fair demo runner, not a general safe/unsafe oracle.
- CONFORMANT means expected-vs-observed agreement on this Raven-owned 12-vector demo corpus.
- This is not an RFC 8032 verdict, not Corpus 0, not Solana-chain verification, not a third-party vulnerability claim, not a certificate, and not a signed receipt.
- Demo targets are Raven-owned fixtures.
- Production deploy, Vercel settings, required checks, and Colosseum submission remain Owner-controlled decisions.

## Exportable cleanliness before reseal

When resealing or composing a judge package for this download surface, run from the Fair INTEGRATION-LANE worktree root:

```sh
node scripts/artifact-sealing.mjs /path/to/unpacked-package
```

Absolute path leaks (including `/private/tmp` and `/var/folders`) must fail closed. See `scripts/check-exportable-cleanliness.mjs` (CLAUDE-068).
