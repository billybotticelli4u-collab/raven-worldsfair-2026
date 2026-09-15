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
