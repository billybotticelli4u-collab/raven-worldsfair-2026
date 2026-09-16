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

Exit code `0` = CONFORMANT; `1` = DIVERGENT or HARNESS_ERROR. All verdicts are limited to the named corpus.

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

## Phase 1 execution and verification contract

Target profile name and explicit `claimed_conformance_profile_version` must both
exactly match the loaded profile. Missing or mismatched versions are refused with
`PROFILE_MISMATCH`. The corpus must name that profile and its declared content
digest must match recomputation (`CORPUS_DIGEST_MISMATCH`). Profile and corpus rules
and vector expectations are unchanged. This digest check detects stale changes,
not an attacker replacing both a corpus and its self-declared digest.

`HARNESS_ERROR` covers nonzero exit/signal, timeout, invalid/absent output, spawn
failure and output overflow. It contributes to neither PASS nor DIVERGENCE and is
excluded from `graded_count`; any harness error blocks overall CONFORMANT.
The summary includes divergent and harness-error vector IDs. These are no security score.

The runner supports curated single-file Node scripts with builtin imports. Node
permissions allow entry-file reads and inherited stdin, deny filesystem writes and
child creation, and omit ambient credentials. POSIX process groups are killed on
exit, timeout, overflow, or runner interruption. Windows is refused. Output capture
is bounded to 64 KiB of raw bytes per stream with explicit truncation metadata.
Network is **not restricted**. Node permissions are a cooperative runtime boundary,
not OS isolation for malicious arbitrary code. Resource fields state these limits.

Verify a saved report against the local reviewed profile, corpus and target:

```sh
npm run verify -- reports/RUN_ID.json
npm run verify -- reports/RUN_ID.json --expected-digest EXTERNALLY_OBTAINED_SHA256
```

The standalone verifier imports no producer code. It checks the report digest,
local artifact digests, all vector identities/expectations, transcript decisions,
error classification and summary counts/verdict. It exits nonzero on disagreement.
Without an independently obtained expected digest, internally consistent fabricated
transcripts cannot be distinguished from real executions. Even a matched external
digest establishes artifact identity, **not execution attestation**. Verification
is not a replay, and neither command re-evaluates the profile beyond the corpus.

Reproduction should use the exact commit in the separately supplied Phase 1 freeze
packet. The branch name in the convenience command is not an immutable review identity.

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
