# RAVEN OPERATOR CONTEXT (safe to paste into any AI agent — no secrets)

## What Raven is
A signed evidence-and-receipt layer for AI agents before they touch a Solana
token. Verdicts (pass | pass_with_info_finding | warning | risk | unknowable)
derive from decoded on-chain bytes, list explicit coverageGaps, and ship with
an ed25519 signature. The product sentence: "this mint produced these
findings, at this slot, under this engine version, with these gaps, signed by
this key."

## Beachhead
Signed Solana token-launch verification for agents. Nothing else.

## Live surfaces
- Hosted verifier: https://raven-hosted-verifier.onrender.com
  (POST /verify keyed · GET /pubkey · GET /healthz)
- Console: https://raven-launch-console.vercel.app (+ /agents.json,
  /openapi.json, /evals.json, /access.json, /llms.txt)
- Attestation key id: rvk_c2997e90215279c2 (domain raven-official-attestation)
- MCP: npx -y raven-verify-mcp · ACP offering: solana_verify_token (0.1 USDC)

## Holder-beta status
Dormant globally. Per-API-key only via RAVEN_HOLDERS_BETA_KEYS (Render env,
operator-managed). Never enable globally without a shadow-eval report and
Glen's approval.

## What NOT to build (RAVEN_FOCUS.md)
Generic rug scores, trading advice, social sentiment, price prediction,
macro commentary, portfolio advice, wallet copy-trading (separate project,
never inside Raven). No live public anonymous verifier box.

## Handling a token request (lead named a token)
1. Resolve mint + token program (lead may give a name or DexScreener link).
2. Run the hosted verifier with the alpha key (operator-held, never in chat).
3. Record in private/leads.json: verdict, receiptHash
   (officialAttestationHash), keyId, observedSlot.
4. Reply using operator/templates/verdict-reply-<verdict>.md — verdict first,
   findings, gaps, what was NOT evaluated.
5. Glen approves the outbound reply. Always.

## Running a signed verification
curl -X POST <verifier>/verify -H "x-api-key: $KEY" -H "content-type:
application/json" -d '{"mintAddress":"…","tokenProgramAddress":"…"}'
Optional: metadataAddress, poolAddress (Raydium CPMM), commitment.

## Updating the private lead tracker
operator/private/leads.json per operator/leads-template.json. Never commit
private/. Key prefix only, never full keys.

## Classifying a feature request
Run scripts/raven-feedback-classifier.mjs. Engine work is sanctioned ONLY if
it maps to a listed coverage gap (liquidity, holders, deployer_outcomes,
holder_venue_adjustment, Token-2022 tail) AND came from a real lead/beta
user/eval failure. Docs/onboarding/pricing confusion = site work, not engine
work. Anything in the forbidden list = out of scope; decline politely.

## Banned claims (exact)
"safe", "guaranteed", price prediction, trading advice, rug score, buy/sell
recommendations. Preferred wording when gaps remain:
"not enough evidence for a full pass".

## Interpreting coverage gaps
coverageGaps is normative. Listed = NOT evaluated = unverified, never
implicitly fine. A pass-grade verdict with gaps is "no risk findings on
checked surfaces", and that is the strongest claim allowed.

## Traction rule (anti-metrics)
Do not celebrate internal AI activity as traction: tokens consumed, model
calls, agent sessions, generated files, PRs, lines of code, UI polish, and
social likes are NOT metrics. Traction starts when an EXTERNAL agent or
partner uses a signed Raven receipt in a real workflow. Track: external
receipts issued/verified, first beta key used, first integration storing
receipts, first real blocked/escalated action, false-positive rate, blackbox
pass rate.
