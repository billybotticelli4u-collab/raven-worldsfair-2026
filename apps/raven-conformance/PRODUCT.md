# Raven Conformance — Fair product note

## Build Stage

Author-lane Fair **Build Stage** product milestone for Crypto World's Fair 2026.
Does **not** claim Day-3 Evidence Contract Handshake as this product.

## Product loop

1. Target declares identity + claimed conformance profile  
2. Runner loads deterministic corpus for that profile  
3. Each vector is executed in MVP-isolated child process  
4. Evidence report records exact expected vs observed  
5. Clean-clone reproduction command regenerates the report class  

## Smallest target profile manifest fields

- name  
- version / digest  
- claimed conformance profile  
- invocation interface  
- environment identity (recorded at run time)  
- allowed resources  
- corpus identity  

## Report contract

Machine-readable `raven-conformance-report/1` plus human view:

- run ID, target identity, claimed profile  
- corpus / version / digest  
- environment, test count  
- exact expected, exact observed, PASS/DIVERGENCE per vector  
- reproduction command  
- report content digest  
- explicit limitations  

## Mutation / non-vacuity

- Breaking target behavior (BROKEN_* demos) causes corpus DIVERGENCE  
- CONFORMANT_REFERENCE must pass all vectors  

## Review classification (author lane)

Classify `READY_FOR_HACKATHON_PRODUCT_REVIEW` or `NOT_READY` after freeze.

## Challenge 1 (this branch)

Bounded isolation runner + result taxonomy + hostile probes + replay + UI contract.

- Branch: `billy/fair-challenge1-bounded-runner-2026-09-16`
- Isolation: `sandbox_exec` (Darwin Seatbelt) when verified; `node_permissions` (Node `--permission`, not an OS sandbox) on Linux when verified; otherwise fail-closed / `curated_demo` with `verified: false`
- A Node child_process alone is **not** a security sandbox
- No arbitrary public code upload; no merge/deploy/npm publish in this handoff

## Challenge 2 Judge UI (this branch)

Author-lane Fair Build Stage UI for 60-second judge understanding: live progress from runner events, display-adapter status kinds, a11y, XSS text-only rendering, recorded-report fallback, download + reproduce. Does not rewrite engine verdicts; does not maintain a second runner. Consumes `interface/raven-conformance-ui-contract/1`.
