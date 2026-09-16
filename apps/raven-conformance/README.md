# raven-conformance

Crypto World's Fair 2026 — **Raven Conformance** (Build Stage / Challenge 1 bounded runner).

Deterministic loop judges can run from a clean clone:

**target → claimed profile → corpus → isolated execution → evidence report → reproduction / replay**

This app does **not** claim Day-3 Evidence Contract Handshake as this product.  
A Node `child_process` alone is **not** a security sandbox.

## 60-second judge UX

```bash
cd apps/raven-conformance
npm test
npm run demo          # CONFORMANT_REFERENCE + isolation disclosure
npm start             # http://127.0.0.1:8791
```

1. Select a demo target  
2. Click **Run Conformance**  
3. Watch corpus results (CONFORMANT / DIVERGENT) + isolation mode  
4. Open exact failure evidence  
5. Copy the reproduction command  

## CLI reproduction

```bash
cd apps/raven-conformance && npm run conform -- --target CONFORMANT_REFERENCE
cd apps/raven-conformance && npm run conform -- --target BROKEN_OBVIOUS
cd apps/raven-conformance && npm run conform -- --target BROKEN_SUBTLE
```

Exit code `0` = CONFORMANT; `1` = DIVERGENT / incomplete.

### Replay (reproduce from a saved report)

```bash
npm run demo
npm run replay -- --report reports/<run_id>.json
```

Replay checks profile/corpus/target digests, re-executes in a clean isolation workdir, and compares semantic outcomes (not timestamps).

### Hostile boundary probes (not conformance demos)

```bash
npm run probes
```

Probes are marked `probe: true` in `targets/manifests.json` and are excluded from the default UI target list.

## Three Raven-owned demo targets

| Target | Intent |
|--------|--------|
| `CONFORMANT_REFERENCE` | Correct impl — corpus PASSes |
| `BROKEN_OBVIOUS` | Straightforward contract violation (unconditional ACCEPT) |
| `BROKEN_SUBTLE` | Verifier-class defect demo: accepts unexpected top-level fields (#212-class **as a Raven-owned demo target**). Not a third-party vulnerability claim. |

Profile: `raven-canonical-envelope/1`  
Corpus: `raven-canonical-envelope-demo-corpus/1` (10 vectors, self-contained)

## Result taxonomy

| Status | Meaning |
|--------|---------|
| `PASS` | Decision matches expected |
| `BEHAVIORAL_DIVERGENCE` | Ran + parsed; decision ≠ expected |
| `TARGET_CRASH` | Non-zero exit / crash without valid decision |
| `TIMEOUT` | Killed after wall-clock timeout |
| `INVALID_OUTPUT` | Unparseable / missing decision |
| `OUTPUT_FLOOD` | stdout/stderr byte cap hit |
| `SKIPPED_VECTOR` | Explicit skip (counted) |
| `RUNNER_FAILURE` | Isolation/setup failure |
| `BOUNDARY_HOLD` / `BOUNDARY_ESCAPE` | Probe outcomes with evidence |

Crashes / timeouts / invalid / flood **never** become `PASS`.  
`summary.divergence` counts `BEHAVIORAL_DIVERGENCE` for UI compatibility.

## Isolation (Challenge 1)

| Mode | When | Verified? |
|------|------|-----------|
| `sandbox_exec` | Darwin + Seatbelt profile applies | `verified: true` — deny network, confine writes to ephemeral workdir |
| `curated_demo` | sandbox-exec unavailable (e.g. Linux CI) | `verified: false` — timeout, env allowlist, output caps, process-group kill only |

**Always enforced by runner:** bounded time + process-group kill, stdout/stderr byte caps, env allowlist, per-run ephemeral workdirs, cleanup.

Reports disclose exact mode and verified vs assumed controls. Do **not** describe a child process alone as a security sandbox.

UI contract for the UI lane: `interface/raven-conformance-ui-contract-v1.{md,json}`  
Integration note: `integration/UI_CONSUME_CONTRACT.md`

## DIVERGENCE meaning

`BEHAVIORAL_DIVERGENCE` = observed decision ≠ specified corpus expectation **only**.  
It is **not** automatically exploitable / unsafe / malicious. No generic security score.

## PRE-EXISTING vs BUILT DURING CRYPTO WORLD'S FAIR

### BUILT DURING CRYPTO WORLD'S FAIR 2026

- Conformance product, profile abstraction, runner, report, UI
- Challenge 1: isolation module, taxonomy, hostile probes, replay, UI contract
- Demo targets + Raven-owned demo corpus
- Reproduction CLI and judge HTTP surface

### PRE-EXISTING (referenced only — not imported)

- Raven receipt/verifier research lineage and private corpora (**not copied**)
- Broader Raven monorepo / production systems (**not touched**)
- Public Fair repo shell / agent-trust sibling app

## Explicitly not built

Token, marketplace, cert authority, pentest scanner, accounts, global registry,
billing, multi-chain parity, public leaderboard, new governance architecture,
arbitrary public code upload.

## Sibling

`apps/worldsfair-agent-trust` remains the Agent Trust demo. This Conformance app
is a separate product path under the same public Fair repo.

## Handoff

See `CHALLENGE1_HANDOFF.md` on branch `billy/fair-challenge1-bounded-runner-2026-09-16`.

## Challenge 2 — Judge UI

Branch: `billy/fair-conformance-challenge2-judge-ui-2026-09-16`

```bash
cd apps/raven-conformance
npm test
npm start    # http://127.0.0.1:8791
```

Live SSE progress (`/api/run-stream`), display adapter over Challenge 1 taxonomy, recorded-report fallback, download/repro, a11y + XSS text-only rendering. UI does not recalculate verdicts or maintain a second runner.
