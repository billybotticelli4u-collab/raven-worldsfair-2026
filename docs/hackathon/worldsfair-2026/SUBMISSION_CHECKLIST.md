# World's Fair 2026 — Submission Checklist (targets)

Targets only. Not all items are Day-1 deliverables.

## Provenance / eligibility

- [x] Record `officialContestStart` with zone (`America/Los_Angeles`)
- [x] Record `baselineMeasuredAt` separately (UTC + Europe/Rome)
- [x] Freeze HEAD/TREE of `origin/main` before Fair product commits
- [x] Document code boundary (Option A: `apps/worldsfair-agent-trust/`)
- [ ] Independent review of Fair branch (not done on Day 1 executor pass)
- [ ] Organizer/Colosseum submission form filled

## Day-1 product vertical slice

- [x] Agent A refuses blind trust; requests Raven evidence; PROCEED/REFUSE
- [x] Agent B one Solana-grounded claim + evidence
- [x] Raven verify via existing `packages/verify-js` (no toy verifier)
- [x] PATH A verified → PROCEED
- [x] PATH B controlled defect → fail closed → REFUSE
- [x] Missing evidence → REFUSE; verifier exception → REFUSE
- [x] Visual web UI (agents, claim, evidence, Raven state, outcome)
- [x] About/Build Info: pre-existing vs Fair; contest start; Fair commit
- [x] Tests for verified/refused/missing/exception/build-info honesty
- [x] Focused branch pushed (no merge to main)

## Later / non-Day-1 targets

- [ ] Website repositioning for Fair (checklist only — **do not redesign** site on Day 1)
- [ ] Demo video / judge walkthrough recording
- [ ] Optional dedicated Fair repo (only if organizers require; default remains Option A)
- [ ] Production deploy of Fair demo (forbidden on Day 1 executor pass)
- [ ] Merge to `main` (forbidden on Day 1 executor pass)

## Hard prohibitions (must remain true)

- [x] No Owner trust ceremony / keys / enrollment / epoch / override
- [x] No npm publish / production deploy / credential changes / repo settings
- [x] No merge to main / history rewrite / squash past provenance
- [x] No weakening Raven trust semantics
- [x] No fake LLM theatre (deterministic agents only)
