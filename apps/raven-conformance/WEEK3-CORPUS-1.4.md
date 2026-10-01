# Week 3: three additional header witnesses

Local candidate based on public Fair b9f0aaf9. This document does not describe a deployment.
Corpus 1.4 adds three synthetic witnesses to corpus 1.3, without changing any of its 27 rows.
The original 1.3 file remains byte-identical for historical audit. The selected corpus has 30 rows;
the canonical-envelope profile and the three Raven-owned Solana targets are unchanged.

The additions follow the existing experimental profile R6 and R13. They are not independently
established Solana specification conformance, valid signed transactions, or safety tests.

| Added witness | Rule exercised | Why it matters |
| --- | --- | --- |
| LAB01_legacy_unsigned_overflow | legacy required=1, readonly-signed=0, readonly-unsigned=3 against 3 accounts | Removing only the legacy overflow guard passes the original27 but accepts this invalid header. |
| LAB02_v1_unsigned_overflow | v1 required=1, readonly-signed=0, readonly-unsigned=3 against 3 accounts | Removing only the v1 overflow guard passes original27 but accepts this header. |
| LAB03_v1_required_accounts | v1 requires4 signatures with3 accounts; readonly-signed3 avoids the other guard | The old V18 rejection was masked by another condition. This witness isolates the missing account-count guard. |

LAB03 appends three 64-byte zero signatures to preserve the structural signature-tail length;
these are synthetic bytes, not valid signatures. Original lab provenance and expected reasons are
retained in the new corpus. The provenance's INCLUDE FOR REVIEW remains a historical lab recommendation,
not a release approval for this successor.

The checker still compares decision and version, not reason. Reason-only errors can survive.
Crashes, timeouts and malformed output remain separate row classifications; they are not credited
as behavioral catches. The mutation tests exercise three deliberately faulty Raven-owned copies,
not external customer decoders or real vulnerabilities.

## Reproduce from the candidate checkout

Use Node22.18.0 and its bundled npm10.9.3. In apps/raven-conformance:

```sh
npm ci --ignore-scripts
node --test test/solana-header-coverage.test.js
node src/cli.js --profile solana --target SOL_CONFORMANT_REFERENCE
```

The CLI writes an unsigned report. Use the existing replay command for a report produced by these
same bytes. Old 27-row reports bind a different corpus; use their original pinned checkout to replay
them. Do not rewrite old report digests to make them fit the new corpus. Customer adapters remain a
supervised local pilot workflow; this change does not add hosted uploads.

The transferable patch and exact staged tree are provided outside the repository in the Week3
candidate packet. Until committed and released, a public Git clone does not contain this delta.
Historical released-build metadata or a checkout HEAD alone does not attest this working tree.
