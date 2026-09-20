# Recurring tasks (designed, NOT deployed — no background agents yet)

| Task | Trigger | Input | Output | Human approval | Failure mode | Fallback |
|---|---|---|---|---|---|---|
| Daily verifier health | each morning | GET /healthz, /pubkey | line in daily brief | no (read-only) | endpoint down -> alert line | curl by hand |
| Daily site smoke | each morning | scripts/site-smoke.mjs | PASS/FAIL in brief | no (read-only) | false alarm on deploy lag | rerun once |
| Daily eval pack check | each morning | raven-public-blackbox-eval.mjs (public part) | PASS/FAIL in brief | no (read-only) | RPC hiccup | rerun keyed manually |
| Daily lead follow-up check | each morning | private/leads.json followUpDate | due list | YES before any reply is sent | stale data | check inbox |
| Daily missing-evidence summary | each morning | private/leads.json | tally in brief | no | empty data | skip section |
| Weekly dot plot review | Monday | private/dotplot.json | habitual/churned lists | YES for follow-up actions | sparse data | manual marks |
| Weekly problem-hunt | Monday | raven-problem-hunt.mjs | hunt report | YES for any build decision | missing files (degrades) | read leads raw |
| Weekly focus-guardrail review | Friday | RAVEN_FOCUS.md vs week's work | drift note | YES | rationalized drift | re-read focus file |

When these become scheduled agents, each runs read-only, writes a report,
and stops. Action always returns to a human.
