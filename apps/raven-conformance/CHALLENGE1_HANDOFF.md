# Challenge 1 Handoff — Bounded Isolation Runner

**Author lane:** Billy (implementer) for Raven  
**Branch:** `billy/fair-challenge1-bounded-runner-2026-09-16`  
**Repo:** billybotticelli4u-collab/raven-worldsfair-2026  
**App:** `apps/raven-conformance/`  
**Classification (author lane only):** `READY_FOR_HACKATHON_PRODUCT_REVIEW`  
**Not:** independent GO / owner acceptance / merge authority

## Baseline reconfirm

| Item | Value |
|------|-------|
| MVP HEAD (branch base) | `53360df071872a29447993e879add2be9406b7b5` |
| MVP TREE | `468b0397c89165160337a53597e8b6533f1f1dec` |
| Tip advanced? | No — built from exact MVP tip |
| Challenge 1 HEAD | _(stamped after commit)_ |
| Challenge 1 TREE | _(stamped after commit)_ |

## Isolation verified vs curated-demo

| Host | Mode | verified |
|------|------|----------|
| Darwin Mac (author re-measure 2026-09-16) | `sandbox_exec` | **true** |
| Linux (earlier author lane) | `curated_demo` | false |

**Darwin verified controls:** Seatbelt `sandbox-exec` profile applied (deny network; write confined to ephemeral workdir + temp/dev; explicit deny write to corpus/profiles/reports/app); env allowlist; timeout + process-group kill; stdout/stderr byte caps. Probe uses **Node** under Seatbelt (not `/usr/bin/true` alone).

**Linux curated_demo:** timeout/env/output caps only; network via proxy unset; FS not kernel-confined — `HOSTILE_CORPUS_WRITE` ESCAPE expected.

**Disclosure:** A Node `child_process` alone is **not** a security sandbox.

## Measured outcomes

### Acceptance demos (Darwin sandbox_exec)

| Target | Overall |
|--------|---------|
| CONFORMANT_REFERENCE | CONFORMANT |
| BROKEN_OBVIOUS | DIVERGENT |
| BROKEN_SUBTLE | DIVERGENT |

### Hostile probes (Darwin sandbox_exec — see evidence JSON)

See `evidence/darwin-sandbox-exec-measurement-2026-09-16.json` (filled by measurement run).

### Tests

`npm test` on Darwin — **34 pass / 0 fail**.

### Replay

`npm run replay` semantic match OK on Darwin.

## Artifact hashes (key files, sha256)

```
28cec1f9d1cb0fd18af185c88fb7d94c6fd3594925ff891df43c45a1a233737d  src/lib/isolation.js
aed717e036b8ad706b331d3abd08c9df7fdffb1567324a21eb6df7e530d55813  src/lib/runner.js
c5330ef967314eea365f15996f25cd10f1d05a54cdf73614c3d4e4240e07a2f1  src/lib/replay.js
494da561dfd35600dea3cfc4aa66ce5fb662ec75632c0df30a5e22f2b05b9a95  interface/raven-conformance-ui-contract-v1.json
3bba688b3b17245124b2ef035d706bf3a439344fd26861c4eec53583196ff298  interface/raven-conformance-ui-contract-v1.md
000ec4e12e4dfb88f5b8210a39aa22f71d8f175b00a6b6b5e9a8b3b34c1c2143  targets/manifests.json
7dd659bbac4ea393a9da47c5aeda9f4b16c3998738408c13390cfc2d250720fa  integration/UI_CONSUME_CONTRACT.md
bb41f9d0452f8336d388bd62209de6adf5b969697e243ced0a6f9388ff932368  package.json
5c6929b4470babe99c70a50263b08dbe43fb42c81cf2fc6a5b70728df01689b3  targets/hostile/HOSTILE_CHILD_PERSIST.mjs
dbe44b426fba144d1b1c487a6ef8a23197409b0e3f5693df217eaf6659cbefe8  targets/hostile/HOSTILE_CORPUS_WRITE.mjs
4aaea870d4963f59f1f556334eb6b173552e69bf9563850606506f861331afb5  targets/hostile/HOSTILE_ENDLESS.mjs
4afc6bf770b910400a4d4f38768c5d4fd5489f5367ab71a718630942dd620144  targets/hostile/HOSTILE_ENV_CANARY.mjs
764615b3610b5d81d2bb61fd0c02131d2296ac7013ef4cf86c5a67841d9aeee6  targets/hostile/HOSTILE_EXIT_CRASH.mjs
1a8d60beb131d77184da1179d1e92b6dc20440593cadba3b7de304649f7d3e4d  targets/hostile/HOSTILE_MALFORMED_OUTPUT.mjs
0290ca8bdc5045b338961d4f22d7d76da88976ba357585c085ad8ff2112fa1c9  targets/hostile/HOSTILE_NETWORK_ATTEMPT.mjs
e4add76de1baecbfaa136145e374dbaeb722fbc81fe7ab12ad0fd0bde9a42bdc  targets/hostile/HOSTILE_OUTPUT_FLOOD.mjs
```

## Report example paths

- `examples/sample-report-CONFORMANT_REFERENCE-challenge1.json`
- `examples/sample-report-BROKEN_SUBTLE-challenge1.json`
- `evidence/darwin-sandbox-exec-measurement-2026-09-16.json`

## Interface compatibility (UI lane)

- Contract: `interface/raven-conformance-ui-contract-v1.{md,json}`
- Integration note: `integration/UI_CONSUME_CONTRACT.md`
- Additive report fields; MVP `summary.pass` / `divergence` / `overall` retained

## Failed / skipped / unverified

| Item | Status |
|------|--------|
| Memory ulimit soft limits | **UNVERIFIED** |
| Multi-tenant production sandbox claim | **Not claimed** |
| Merge / deploy / independent GO | **Not issued** |

## ≤3 owner decisions

1. Accept Darwin-measured `sandbox_exec` candidate for Fair product review (Linux stays curated_demo disclosure)?
2. Accept CORPUS_WRITE ESCAPE on non-Darwin as honest disclosure (no bubblewrap required for this freeze)?
3. Open draft PR for review only (no merge), or keep branch-only until independent reviewer GO?

## Author evidence vs independent review vs owner acceptance

| Layer | This handoff |
|-------|----------------|
| Author evidence | Measured Darwin tests + probe JSON; Linux curated_demo earlier |
| Independent review | **Not claimed** — needs non-author |
| Owner acceptance | **Not claimed** — sleeping owner; ≤3 decisions above |

## Reproduction

```bash
git clone https://github.com/billybotticelli4u-collab/raven-worldsfair-2026.git
cd raven-worldsfair-2026
git checkout billy/fair-challenge1-bounded-runner-2026-09-16
cd apps/raven-conformance
npm test
npm run demo
npm run conform -- --target BROKEN_SUBTLE
npm run replay -- --report examples/sample-report-BROKEN_SUBTLE-challenge1.json
```

## Classification

`READY_FOR_HACKATHON_PRODUCT_REVIEW` (author lane only).
