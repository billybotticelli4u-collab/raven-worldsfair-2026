
## Conformance receipt → Solana DEVNET (ugly bridge)

New kind `raven-conformance-receipt/1` (receipt-v1 untouched). Digests only on-chain.

```bash
export RAVEN_CONFORMANCE_RECEIPT_KEYPAIR="$HOME/.raven/fair-conformance-devnet.json"
# key = Solana JSON secret-key array; never commit

npm run conform -- --target CONFORMANT_REFERENCE
npm run receipt:issue -- --report reports/run_<id>.json
npm run receipt:anchor -- --receipt receipts/run_<id>.conformance-receipt.json
npm run receipt:verify -- --report reports/run_<id>.json \
  --receipt receipts/run_<id>.conformance-receipt.json \
  --anchor receipts/run_<id>.anchor.json
```

Refuses missing keypair and non-devnet RPC. Label everything DEVNET. No push/deploy from this lane.
