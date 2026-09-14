# Judge quickstart — raven-worldsfair-2026 (Day-2)

1. Clone with submodule:
   ```bash
   git clone --recurse-submodules https://github.com/billybotticelli4u-collab/raven-worldsfair-2026
   cd raven-worldsfair-2026
   ```
2. Confirm pin:
   ```bash
   git -C vendor/raven-receipt-verifier rev-parse HEAD
   # 1b04356a275742752fb7afd8dfcc4269d462a778
   ```
3. Run Fair tests (no npm registry package; no `dist/` build required):
   ```bash
   cd apps/worldsfair-agent-trust
   npm test   # expect 32/32
   npm start
   ```
4. Open http://127.0.0.1:8787 — UI shows **Crypto World's Fair 2026**;
   About/Build Info lists PRE-EXISTING vs FAIR WORK and **Built during competition**.

**Truth / clock honesty:**
- Not live Solana; `liveAcquisition:false`; deterministic fixture/demo evaluation time
  (`BONK_FIXTURE_NOW`) used by verification — not wall-clock freshness.
- Malformed evaluation time → `invalid_evaluation_time` / REFUSE (fail-closed).

**Review class:** INTERNAL_ADVERSARIAL_NON_AUTHOR GO (Billy copy) for tip
`a5cd592b72d2da1ebf6f0c1e224d05489ff31524` / tree `3e442f93529bdb5da876b54d484294032535e84a`
— **not** EXTERNAL_INDEPENDENT.

**PRE-EXISTING RAVEN FOUNDATION — NOT CRYPTO WORLD'S FAIR WORK:**
`vendor/raven-receipt-verifier` is a linked public foundation pin, not Fair invention.
