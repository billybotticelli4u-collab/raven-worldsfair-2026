# PRODUCT — World's Fair Agent Trust (Day 1)

## Claim chosen

**Agent B claims:** Solana mainnet mint `DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263` (BONK) under SPL Token program `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` has a **valid Raven receipt-v1** covering measured properties in scope (`freeze_authority`, `mint_authority`, `token_program_tier`).

## Why this claim

1. A **production BONK receipt** already ships in `packages/verify-js/fixtures/receipt-v1/production-receipt-v1-bonk-2026-07-03.json`.
2. Offline verification already succeeds with `verifyReceiptV1ForSubject` + `ravenProductionTrustedKeys()` (no toy verifier, no network).
3. Subject binding (chain + mint + token program) is exactly what Agent A must check before PROCEED.
4. Controlled defects (tamper / wrong subject / missing evidence) exercise fail-closed REFUSE without inventing new crypto.

## Roles

| Role | Behavior |
| --- | --- |
| **Agent B (claim)** | Emits one Solana-grounded claim and optionally supplies Raven receipt evidence. |
| **Agent A (decision)** | Never trusts B blindly. Requests Raven evidence. PROCEED only if verify succeeds under trust + integrity + subject rules. REFUSE on missing/malformed/stale/untrusted/tampered/unsupported/error. |
| **Raven** | Independent offline verify via pre-existing `raven-receipt-verifier` (`packages/verify-js`). |

## Paths

- **PATH A VERIFIED:** valid BONK evidence → Raven VERIFIED → Agent A **PROCEED**
- **PATH B REFUSED:** tampered receipt (or wrong subject / missing / exception) → fail closed → Agent A **REFUSE**

## Foundation vs Fair

Verifier, trust anchor, and BONK fixture are **pre-existing**. Fair work is the A/B orchestration, fail-closed decision policy surface, UI, and tests in this app.
