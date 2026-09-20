# Decision Policy — human accountability layer

Agents (including Claude) may: draft, summarize, classify, verify, run
scripts, prepare receipts, and RECOMMEND.

A HUMAN (owner: Glen) approves, with no exceptions:
- API key issuance
- holder-beta enablement
- public claims (site copy, manifests, comparisons)
- pricing changes
- engine adoption (merges that change live verdicts; Render deploys)
- outbound replies (every customer-facing message)
- any verdict interpretation that could sound like trading advice

Every operator action is logged in private/decisions.json with:
action · source evidence · recommendation · risk · human approval status ·
date · owner.

Raven never pretends an agent is accountable. A human operator owns every
customer-facing decision. If an action lacks a named human owner, it does
not happen.
