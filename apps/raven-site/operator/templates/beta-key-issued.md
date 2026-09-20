Subject: Your Raven API key ({KEY_PREFIX}…)

Key: sent separately / below. Limits: 15 req/min per key on /receipt/v1; 10 req/min, burst 4 on /verify
(alpha — free).
{IF_HOLDER_BETA: "Holder-beta is ON for your key: venue-adjusted top-holder
concentration — pump.fun curve and registered PumpSwap vaults excluded only
with decoded on-chain evidence; unadjusted results carry an explicit
qualifier and coverage gap."}

Quick start:
curl -X POST https://raven-hosted-verifier.onrender.com/verify \
  -H "x-api-key: YOUR_KEY" -H "content-type: application/json" \
  -d '{"mintAddress":"{TOKEN}","tokenProgramAddress":"{PROGRAM}"}'

Every issued receipt is signed (key rvk_c2997e90215279c2) — verify any
of them against your independently pinned key: https://ravenattest.com/security.html
When the evidence can't be established, Raven refuses with an explicit unsigned
refusal envelope instead of issuing a receipt.
Docs: /workbench.html · /openapi.json · evals you can run against us: /evals.html

One ask: which missing evidence would make this useful enough to wire into
your workflow permanently?
