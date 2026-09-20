# Raven Operator Console (private, local-first)

Internal cockpit. NOT linked from public navigation and NOT copied to the
Vercel deploy directory. Committed files are templates only; real lead and
usage data lives in `operator/private/` which is gitignored (repo is public).

## Layout
- index.html — hub: health quick-checks + links to every surface
- leads.html — render your private leads.json against the full field list
- dotplot.html — Granola-style repeat-usage grid (demo data; load private)
- evals.html / receipts.html / feedback.html / decisions.html / skills.html
- DECISION_POLICY.md — what agents may do vs what Glen approves
- RAVEN_OPERATOR_CONTEXT.md — safe paste-into-an-agent context pack
- PROBLEM_HUNTING.md + RECURRING_TASKS.md — the learning loop, documented
- templates/ — receipt-first reply templates (verdicts, beta key, follow-ups)
- skills/ — deterministic operator skills (steps, approvals, banned actions)
- private/ — YOUR data: leads.json, dotplot.json, decisions.json (gitignored)

## Daily use
1. Open operator/index.html locally (python3 -m http.server in raven-site).
2. Run the brief: node scripts/generate-raven-daily-brief.mjs
3. New lead? leads.html field list -> private/leads.json; classify:
   node scripts/raven-feedback-classifier.mjs --role "..." --usecase "..." ...
4. Reply with a template from operator/templates (verdict first, always).
5. Weekly: node scripts/raven-problem-hunt.mjs > operator/private/hunt.md
6. Before any push: node scripts/raven-change-review.mjs

## Hard rules
No secrets in this tree. No autonomous actions. Every customer-facing
decision has a human owner (DECISION_POLICY.md). A failing eval is a build
order; a vibe is not.
