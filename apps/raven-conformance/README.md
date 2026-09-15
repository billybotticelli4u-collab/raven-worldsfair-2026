# raven-conformance

Crypto World's Fair 2026 — **Raven Conformance MVP** (Build Stage product milestone).

Deterministic loop judges can run from a clean clone:

**target → claimed profile → corpus → execution → evidence report → reproduction**

This app does **not** claim Day-3 Evidence Contract Handshake as this product.

## 60-second judge UX

```bash
cd apps/raven-conformance
npm test
npm start    # http://127.0.0.1:8791
```

1. Select a demo target  
2. Click **Run Conformance**  
3. Watch corpus results (CONFORMANT / DIVERGENT)  
4. Open exact failure evidence  
5. Copy the reproduction command  

## CLI reproduction (one command after clone)

```bash
cd apps/raven-conformance && npm run conform -- --target CONFORMANT_REFERENCE
cd apps/raven-conformance && npm run conform -- --target BROKEN_OBVIOUS
cd apps/raven-conformance && npm run conform -- --target BROKEN_SUBTLE
```

Exit code `0` = CONFORMANT; `1` = DIVERGENT.

## Three Raven-owned demo targets

| Target | Intent |
|--------|--------|
| `CONFORMANT_REFERENCE` | Correct impl — corpus PASSes |
| `BROKEN_OBVIOUS` | Straightforward contract violation (unconditional ACCEPT) |
| `BROKEN_SUBTLE` | Verifier-class defect demo: accepts unexpected top-level fields (#212-class **as a Raven-owned demo target**). Not a third-party vulnerability claim. |

Profile: `raven-canonical-envelope/1`  
Corpus: `raven-canonical-envelope-demo-corpus/1` (10 vectors, self-contained)

## DIVERGENCE meaning

`DIVERGENCE` = observed decision ≠ specified corpus expectation **only**.  
It is **not** automatically exploitable / unsafe / malicious. No generic security score.

## Isolation (MVP)

- Local Node `child_process` (not a general sandbox)
- Proxies unset; no Raven credentials in target env
- Timeout-bounded; runner owns corpus + report hash
- stdout/stderr captured as evidence

## PRE-EXISTING vs BUILT DURING CRYPTO WORLD'S FAIR

### BUILT DURING CRYPTO WORLD'S FAIR 2026

- Conformance product, profile abstraction, runner, report, UI
- Demo targets + Raven-owned demo corpus
- Reproduction CLI and judge HTTP surface

### PRE-EXISTING (referenced only — not imported)

- Raven receipt/verifier research lineage and private corpora (**not copied**)
- Broader Raven monorepo / production systems (**not touched**)
- Public Fair repo shell / agent-trust sibling app

## Explicitly not built

Token, marketplace, cert authority, pentest scanner, accounts, global registry,
billing, multi-chain parity, public leaderboard, new governance architecture.

## Sibling

`apps/worldsfair-agent-trust` remains the Agent Trust demo. This Conformance MVP
is a separate product path under the same public Fair repo.
