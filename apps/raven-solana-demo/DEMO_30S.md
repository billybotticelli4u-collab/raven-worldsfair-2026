# 30-second demo script

```bash
# 1. Show the claim (5s)
cat profiles/raven-solana-txversion-experimental-0.json | head -8

# 2. Run the whole demo (15s)
node harness/run.js --all

# 3. Point at the two judge-visible divergences of the stale pre-v1 parser (10s)
#    V03_valid_v1:                   expected ACCEPT/1  observed REJECT   (false refusal — v1 is live on mainnet since 2026-09-09)
#    V10_noncanonical_shortvec:      expected REJECT    observed ACCEPT   (incorrect admission of bytes the v1 envelope convention owns)
```

Narration: "Solana activated transaction v1 on mainnet September 9, 2026. Every pre-v1 parser misreads the version byte. Our conformance product proves a target understands all three wire formats — and catches the ones that only think they do."
