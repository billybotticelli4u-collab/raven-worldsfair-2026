# worldsfair-agent-trust

Crypto World's Fair 2026 — Day 2 Track B machine-to-machine trust slice.

One machine (Agent A) refuses to trust another machine's Solana claim (Agent B)
until Raven independently verifies receipt-v1 evidence offline. The deterministic
`raven-agent-trust/1` exchange is returned by `POST /api/run` as four correlated
machine-readable messages:

1. `solana.claim` from Agent B to Agent A;
2. `evidence.request` from Agent A to Agent B;
3. `evidence.response` from Agent B to Agent A;
4. `evidence.verification` from Raven to Agent A.

Raven reports verification facts. Agent A's separate policy consumes those facts
and owns the causal `PROCEED` or `REFUSE` decision.

Day 2 deliberately uses the frozen BONK receipt fixture. Every evidence response
labels `source.mode` as `deterministic_fixture` and `liveAcquisition` as `false`;
the app does not represent replayed evidence as a live Solana observation.

Raven's `evidence.verification` result also discloses the evaluation time actually
passed into the verifier (`BONK_FIXTURE_NOW`), labeled as
`deterministic_fixture_demo_time` — not wall clock and not current Solana freshness.

```bash
cd apps/worldsfair-agent-trust
npm test
npm start   # http://127.0.0.1:8787
```

See `PRODUCT.md` and `docs/hackathon/worldsfair-2026/`.

## Public repo notes

In the public Fair repository, verification imports the pinned submodule
`vendor/raven-receipt-verifier` (PRE-EXISTING foundation). Scripts set
`NODE_OPTIONS=--experimental-strip-types` so Node can load the submodule
TypeScript entry without npm-publishing the verifier.

Truth: `liveAcquisition:false`; disclosed deterministic fixture/demo evaluation
time (same clock verification uses); malformed evaluation time → REFUSE.

