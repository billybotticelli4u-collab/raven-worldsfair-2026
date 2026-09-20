# Skill: eval-failure-triage
Purpose: a public eval failed; turn it into a precise build order.
Inputs: failing eval id, observed vs expected output.
Steps: 1) reproduce twice (rule out RPC flake) 2) classify: engine regression / contract drift / eval stale 3) if engine: locate the owning package test; write a failing unit test FIRST 4) draft fix recommendation with risk 5) decision-log entry.
Outputs: triage note + recommendation.
Human approval required: YES for any fix that changes verdicts (engine adoption).
Banned: editing the eval to make it pass; shipping without the failing test.
Safe fallback: if unreproducible, log as flake with both run outputs attached.
