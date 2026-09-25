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

Author/regression suite ≠ independent PASS. CODEX recheck required before KIMI final integration.
