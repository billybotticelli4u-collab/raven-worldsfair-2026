# RAVEN REVENUE MODEL (internal, v1 — 2026-06-05)

The business in one line: Raven is the verification rail agents call before
they touch a Solana token. We sell signed preflight receipts, not scans.
Operating metric: signed receipts issued this week — and how many came from
someone other than us. Revenue metric: teams willing to pay for signed
verification before an agent acts.

## 1. Pricing tiers
| Tier | Buyer | Price | Includes |
|---|---|---|---|
| ACP per-job | autonomous agents, no-account | 0.1 USDC/job | one signed verification, receipt, gaps, replay hash |
| Developer | MCP/bot builders, small scanners | $99/mo | 10k verifications/mo, signed receipts, examples, feedback channel |
| Growth | scanners, TG bots, small launchpads | $499/mo | 100k/mo, higher limits, receipt-display support, holder-beta on request |
| Launchpad/Wallet | serious product teams | $1.5k–3k/mo | 500k+/mo, holder-beta, priority support |
| Enterprise | wallets, infra, agent platforms | $5k–10k+/mo | SLA, custom evidence, dedicated limits |
Add-ons (demand-priced via request-access data): holder-beta +$250/mo;
deployer history +$250–500/mo (NOT BUILT — only if feedback demands);
liquidity/pool evidence +$250–500/mo; custom evidence pack +$1k/mo.
One-off: signed launch receipt $99–250; launchpad receipt pack $500–2k/mo.
NEVER sold: "safe" claims, scores, predictions, advice, copy-trading.

## 2. Cost assumptions
Alpha (now): Render $7, RPC $0–49 (Helius free→Developer), Vercel $0 incr.,
domain ~$1/mo, misc $0–50 → ~$10–110/mo. Operator AI tooling ~$100–400/mo.
Growth: Render $25–85, RPC $49–499, logs/monitoring $50–300, Stripe ~1.5–3.25%
+ €0.25/charge → ~$300–1.5k/mo.
Unit cost: 5–100 RPC credits/verification → $0.0001–0.0005/job on Helius
Developer. Engine is deterministic (no LLM in the verdict path) → gross
margin ≥99% at every tier. Biggest cost risks: RPC volume, accidental
agent/LLM loops. Keep the engine deterministic, forever.

## 3. Break-even
Burn lean ≈ $200–600/mo all-in (incl. operator tooling). Break-even =
2–6 Developer subs, or 1 Growth sub, or ~4k ACP jobs/mo, or one grant
covering a year. Survival is not the constraint; time-to-distribution is.

## 4. Forecast (two curves, both honest)
Conservative (Claude): 30d $0–100 + grant shot ($5–25k one-off);
90d $200–1k/mo; 12mo $2k–10k/mo on 3–10 integrations.
Execution-upside (Chat, assumes levers fired NOW + good conversion):
30d $250–1k; 60d $2–6k; 90d $8–20k; 6mo $25k+ with one embedded
distribution partner. Plan spend on the conservative curve; work the
pipeline for the upside one. Inflection = Raven embedded in a product that
already sees token flow, not sold one customer at a time.

## 5. Target ICPs (ranked)
1. Solana launchpads (receipt before listing/promotion)
2. Telegram trading bots (preflight before routing users)
3. Wallets with token discovery (badges/warnings need evidence)
4. AI agents / MCP developers (tools that don't guess)
5. Scanners/dashboards (signed evidence beats another score)
6. Agent-commerce platforms (receipts before agents pay/trade/escalate)
7. Token due-diligence/listing teams (audit trails)
First 50 prospects + outreach queue: operator/private/PROSPECTS.md
(gitignored; outreach remains PAUSED until Glen approves each send).

## 6. First offers (sell these, nothing else)
Offer 1 — Developer API alpha, $99/mo (goal: 5 users).
Offer 2 — Launchpad/scanner integration, $499/mo (goal: 3 users).
Offer 3 — ACP job 0.1 USDC (goal: default demo; proves agent commerce).
First-money exception: SUBMIT THE GRANTS (Helius Startup Launchpad,
Superteam — drafts exist). Highest probability first dollars.

## 7. Success metrics (weekly, in the daily brief)
- signed receipts issued (ours vs external)
- external callers (any) / paying callers
- ACP jobs completed
- leads -> verdicts sent -> keys issued -> repeat usage (dot plot)
- MRR vs burn
- grant status

## 8. Approval gates (unchanged)
Every outreach send, key issuance, price change, and public claim is
Glen-approved (DECISION_POLICY.md). This document authorizes preparation,
not contact.
