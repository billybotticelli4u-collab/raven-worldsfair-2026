# PRODUCT — World's Fair Agent Trust (Days 1-2)

## Day-2 improvement

The Day-1 vertical slice is now an explicit deterministic machine exchange using
`raven-agent-trust/1`. Agent A emits subject-bound evidence requirements, Agent B
responds with evidence or an explicit unavailability status, Raven returns a
correlated verification response, and Agent A's independent policy consumes that
response to produce `PROCEED` or `REFUSE`.

Message identifiers and correlation are deterministic. A response with a changed
claim, request, or Solana subject fails closed. Raven still uses the pre-existing
offline receipt-v1 verifier and does not emit the downstream decision.

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

Verifier, trust anchor, and BONK fixture are **pre-existing**. Fair work is the A/B orchestration, `raven-agent-trust/1` exchange, fail-closed decision policy surface, UI, and tests in this app.


## Public Fair truth disclosures (Owner)

- **Not live Solana** for PATH A/B; evidence is offline fixture-based with
  `liveAcquisition: false`.
- Evaluation time is the disclosed **deterministic fixture/demo** clock
  (`BONK_FIXTURE_NOW`) — the same instant verification uses — **not** wall-clock
  freshness / current Solana freshness.
- **Malformed evaluation time fails closed** (`invalid_evaluation_time` → Agent A REFUSE).
- BONK fixture + Raven verifier foundation are **pre-existing** (not Fair-created).
  Public consumption is via submodule
  `vendor/raven-receipt-verifier` @ `1b04356a275742752fb7afd8dfcc4269d462a778`.
- Review class for Day-2 tip `a5cd592` / tree `3e442f93`:
  **INTERNAL_ADVERSARIAL_NON_AUTHOR** GO — **not** EXTERNAL_INDEPENDENT.
