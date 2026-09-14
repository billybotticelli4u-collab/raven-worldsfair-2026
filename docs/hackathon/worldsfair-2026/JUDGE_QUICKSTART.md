# Judge quickstart — raven-worldsfair-2026

1. Clone with submodule:
   ```bash
   git clone https://github.com/billybotticelli4u-collab/raven-worldsfair-2026
   cd raven-worldsfair-2026
   git submodule update --init --recursive
   ```
2. Confirm pin:
   ```bash
   git -C vendor/raven-receipt-verifier rev-parse HEAD
   # 1b04356a275742752fb7afd8dfcc4269d462a778
   ```
3. Run Fair tests (no npm registry package; no `dist/` build required):
   ```bash
   cd apps/worldsfair-agent-trust
   npm test
   npm start
   ```
4. Open http://127.0.0.1:8787

**PRE-EXISTING RAVEN FOUNDATION — NOT CRYPTO WORLD'S FAIR WORK:**
`vendor/raven-receipt-verifier` is a linked public foundation pin, not Fair invention.
