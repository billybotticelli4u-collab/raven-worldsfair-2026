# Test matrix (C1–C6 successor)

| Area | Coverage |
| --- | --- |
| Journey | create → export → import → rerun MATCH → safe default report |
| v0 fixture | real supported v0 wire ACCEPT + MATCH |
| Refusal | truncated input REJECT → MATCH |
| Controls | crash / hang / excess / bad-protocol → RUN_ERROR (not MATCH) |
| Extension | example-parser-v1 without engine edit |
| Version compare | saved baseline case + retained digest; leaf diffs; drift refused |
| Binding | adapter source / dependency closure drift → RUN_ERROR before execution |
| Portability | paths with spaces; platform assert portable (Darwin measured; Linux UNMEASURED) |
| SDK-C1…C6 | regression tests in `test/sdk-c1c6-regression.test.mjs` |
| DCB-2 S1 / S2 | `test/dcb2-closure-guard.test.mjs`: D2-1 (installed optional-only dependency inventoried; mutation refused before execution; absent-optional appearance refused; ancestor-only optional → CLOSURE_ESCAPE; permitted == inventoried with positive control; peer rule), D2-2 (SDK path with spaces), exit-126 provenance, fail-closed guard config, symlink refusal, policy `/2` identity and `/1` case refusal, real Kit closure roots; S2: separate mutation controls for all four child-runtime files—watchdog, guard, observer hook and process-identity helper—and the permitted==bound invariant |

Author/regression suite ≠ independent PASS. CODEX recheck required before KIMI final integration.
