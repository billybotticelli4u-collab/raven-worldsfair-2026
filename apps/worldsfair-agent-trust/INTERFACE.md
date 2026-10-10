# Agent Trust live-local core — INTERFACE (Billy 2, branch `billy2/agent-trust-discovery-live-20261011`)

Scope of this branch: agent cards, discovery registry, separate Agent A / Agent B
HTTP services, live proof request/response with a one-time challenge, the refused
Agent B variants, and `npm run demo:live-local`. Live Solana (`apps/worldsfair-agent-trust/live/`,
`npm run demo:live-solana`) belongs to Billy 1 and is **not** in this branch. The offline
judge path is unchanged. `npm run check:demo-unchanged` proves that `npm run demo` stdout
and every 33f5486b file under `apps/worldsfair-agent-trust/` are byte-identical.

All code lives in `apps/worldsfair-agent-trust/src/live/` (ES modules; run with
`node --experimental-strip-types`, Node 22.18 / 24.18 / 26.9 tested).

## 1. Starting things

### CLI (each is its own process)
```sh
# from the repo root
npm run demo:live-local            # registry + 7 Agent B + Agent A, scenarios, clean shutdown
node --experimental-strip-types scripts/agent-trust-live-demo.mjs --json   # full transcript (pids, urls)

# individual services (one READY line on stdout, then serve until SIGTERM/stdin close/120 s cap)
RAVEN_LIVE_AGENT_CONFIG='{"port":0}' \
  node --experimental-strip-types apps/worldsfair-agent-trust/src/live/registryServer.js
RAVEN_LIVE_AGENT_CONFIG='{"variant":"honest","registryUrl":"http://127.0.0.1:<regport>"}' \
  node --experimental-strip-types apps/worldsfair-agent-trust/src/live/agentBServer.js
RAVEN_LIVE_AGENT_CONFIG='{"registryUrl":"http://127.0.0.1:<regport>"}' \
  node --experimental-strip-types apps/worldsfair-agent-trust/src/live/agentAServer.js
```
READY line: `{"event":"ready","role":"registry|agent-a|agent-b","agentId":"…","url":"http://127.0.0.1:<port>","pid":<n>}`.
Env: `RAVEN_LIVE_AGENT_CONFIG` (JSON config below), `RAVEN_LIVE_PORT` (port fallback),
`RAVEN_LIVE_MAX_LIFETIME_MS` (default 120000). A child exits when its parent closes stdin.

### Programmatic
```js
import { startRegistry } from "./src/live/registryServer.js";   // ({ port? }) -> { url, port, server, close(), entries }
import { startAgentB, VARIANTS } from "./src/live/agentBServer.js";
//   startAgentB(config, { evidenceProvider?, claimProvider? }) -> { url, port, server, close(), agentId, card, cardSha256 }
//   config: { variant, agentId?, registryUrl?, port?, subject?, claimEndpoint? (impostor), evidenceSourceLabel? }
import { createAgentA } from "./src/live/agentACore.js";
//   createAgentA({ registryUrl, agentId="agent-a", verifyEvidence?, requestTimeoutMs=5000,
//                  windowMs=30000, clock=()=>new Date() })
//   -> { discover(), exchange(candidate,{subject}), acceptResponse(req,resp), run({targetAgentId?,subject?}), consumedNonces }
import { startAgentA } from "./src/live/agentAServer.js";        // (config{registryUrl,port?}) -> HTTP wrapper of run()
import { createFleet, pidAlive } from "./src/live/orchestrator.js"; // start(role,{config}) / stopAll() -> [{role,agentId,pid,url,exited}]
import { runLiveDemo } from "./src/live/liveDemo.js";            // ({ json?, out? }) -> boolean ok
```
**Extension points (for Billy 1's live source):**
- `evidenceProvider: async (evidenceRequestWithoutChallenge, { agentId, subject }) => evidence.response`.
  It replaces the fixture. Agent B still adds `challengeEcho`. Use `createEvidenceResponse` from `src/lib/protocol.js`.
- `claimProvider: (subject) => solana.claim`. The message must have `from:"agent-b"` and `to:"agent-a"` (`createClaimMessage`).
- `verifyEvidence: async ({ evidenceRequest, evidenceResponse, now: Date }) => evidence.verification`.
  The result must have the same shape as `ravenVerifyEvidenceResponse`. The existing Day-2 `applyDecisionPolicy` decides.
- `agentAServer.js` (the CLI process) always uses the default verifier. There is no key or verifier injection over the CLI or the wire.

## 2. Network
- Every server binds **127.0.0.1** and the host cannot be changed. Port: `config.port`, then
  `RAVEN_LIVE_PORT`, then 0 (ephemeral). Port must be an integer 0–65535 (`port_invalid`).
- The client (`loopbackJson`) refuses any non-`http://127.0.0.1:<port>` target
  (`non_loopback_target_refused`). It follows no redirects, has a 5 s default timeout and caps bodies at 64 KiB.

## 3. Agent card — `raven-agent-card/0`
```json
{
  "cardVersion": "raven-agent-card/0",
  "agentId": "agent-b-honest",                      // /^[a-z0-9][a-z0-9-]{1,63}$/
  "role": "evidence-provider",                       // or "evidence-consumer"
  "endpoint": "http://127.0.0.1:41234",              // must be loopback
  "capabilities": ["evidence.request:raven.receipt-v1"],
  "verifierPin": "raven-receipt-verifier@1b04356a275742752fb7afd8dfcc4269d462a778",
  "subjects": [{ "chain": "solana-mainnet",
                 "mintAddress": "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
                 "tokenProgramAddress": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" }],
  "evidenceSource": "retained_fixture"
}
```
`cardSha256` = SHA-256 hex of the pinned verifier's `canonicalJson(card)`. Served by Agent B at `GET /.well-known/raven-agent.json`.
Agent A eligibility (`evaluateProviderCard`): shape OK, role `evidence-provider`, capability present, pin equal, subject offered.

## 4. Registry API
| Method / path | Body / query | 2xx | Errors |
|---|---|---|---|
| `POST /v0/register` | `{ "card": <card> }` | `201 { agentId, cardSha256 }` | `400 {error:"invalid_card",reasons[]}`, `409 agent_id_taken`, `429 registry_full` (32), `400 bad_request` |
| `GET /v0/agents` | `?capability=<cap>` optional filter | `200 { protocol:"raven-agent-trust-live/0", registry:"raven-demo-registry/0", note, query:{capability}, agents:[{card,cardSha256,registeredAt}] }` | `404 not_found` |

Card shape reasons: `card_not_object`, `card_version_unsupported`, `agent_id_invalid`, `role_invalid`,
`endpoint_not_loopback`, `capabilities_invalid`, `verifier_pin_invalid`, `subjects_invalid`.
A listing is a self-asserted claim, not trust.

## 5. Agent B API
| Method / path | Body | 200 |
|---|---|---|
| `GET /.well-known/raven-agent.json` | — | the card |
| `POST /v0/claim` | `{}` | `{ protocol, providerAgentId, claim: <solana.claim raven-agent-trust/1> }` |
| `POST /v0/evidence-request` | `{ protocol:"raven-agent-trust-live/0", request: <evidence.request + challenge> }` | `{ protocol, response: <evidence.response + challengeEcho> }` |
Errors: `400 invalid_evidence_request`, `409 request_addressed_to_other_agent`, `404 not_found`, `500 agent_b_error`.

Request = the existing `createEvidenceRequest(claim)` message plus:
```json
"challenge": { "nonce": "<64 lowercase hex = 32 random bytes>", "issuedAt": "<ISO-8601, Agent A clock>",
               "requesterAgentId": "agent-a", "providerAgentId": "agent-b-honest", "providerCardSha256": "<hex>" }
```
Response = the existing `evidence.response` (`status`, `evidence` = receipt-v1, `source`) plus:
```json
"challengeEcho": { "nonce": "<same nonce>", "requestMessageId": "<request.messageId>",
                   "providerAgentId": "agent-b-honest", "respondedAt": "<ISO-8601, Agent B clock>" }
```

## 6. Agent A API and transcript
`POST /v0/run { "targetAgentId"?: string, "subject"?: {chain,mintAddress,tokenProgramAddress} }` →
```json
{ "protocol":"raven-agent-trust-live/0", "agentId":"agent-a",
  "discovery":[{ "agentId","endpoint","cardSha256","eligible","reasons":[] }],
  "attempts":[{ "agentId","outcome":"PROCEED|REFUSE","stage","reason","nonce?","transport?",
                "evidenceSource?","disclosure?","evidenceIdentity?","exchange?":[claim,request,response,verification] }],
  "selectedAgentId": "agent-b-honest" | null, "outcome": "PROCEED|REFUSE" }
```
Without a target, every registered card is attempted in registry order, and the first PROCEED is selected.

Acceptance (`acceptResponse`, in order): echo present → nonce not already consumed → echo nonce == sent nonce
→ nonce outstanding → provider id → request id → `respondedAt` parseable → not more than 30 s skew before
`issuedAt` and not older than `windowMs` (30 s) by Agent A's clock → not more than 30 s in the future. On success the nonce
is consumed (single use).

## 7. Refusal codes (`attempt.stage` / `attempt.reason`)
- `discovery`: `unknown_agent`, `capability_missing`, `verifier_pin_mismatch`, `role_not_provider`,
  `subject_not_offered`, `registry_hash_mismatch`, plus any card shape reason
- `card_check`: `endpoint_unreachable`, `endpoint_card_unavailable`, `endpoint_card_mismatch` (with `servedAgentId`)
- `claim`: `invalid_claim`, `claim_subject_not_requested`
- `request`: `provider_unreachable`
- `transport`: `invalid_evidence_response`, `challenge_echo_missing`, `nonce_replayed`, `nonce_mismatch_replay`,
  `nonce_not_outstanding`, `provider_mismatch`, `request_mismatch`, `responded_at_invalid`, `stale_response`,
  `response_from_future`
- `verification`: the existing Day-2 policy reasons (e.g. `integrity_or_malformed`, `untrusted_key`, `stale`,
  `subject_mismatch`, `subject_unavailable_or_invalid`, `missing_evidence`, `verifier_exception`,
  `verification_correlation_failed`); `decided` / `verified` on PROCEED

## 8. Verifier entry point
Default: `ravenVerifyEvidenceResponse({ evidenceRequest, evidenceResponse, now: BONK_FIXTURE_NOW })` from
`src/lib/ravenVerify.js`, which is unchanged. It wraps `vendor/raven-receipt-verifier`
`packages/verify-js/src/index.ts` (`verifyReceiptV1ForSubject` + `ravenProductionTrustedKeys`) at pin `1b04356a`.
`src/live/canonical.js` exports `loadPinnedVerifier()` (the same module) and `sha256Canonical()`.
Demo evidence is the retained BONK fixture (`liveAcquisition:false`, fixture evaluation time). Only transport
and nonce freshness use the real clock.

## 9. Demo population (`VARIANTS`)
`honest` PROCEED · `tamperer` integrity_or_malformed · `wrong-capability` capability_missing ·
`bad-pin` verifier_pin_mismatch · `replayer` PROCEED, then nonce_replayed · `stale` stale_response ·
`impostor` (card endpoint = honest's URL) endpoint_card_mismatch · unknown id unknown_agent.

## 10. Tests and checks (fresh clone)
```sh
npm run demo                 # unchanged: "Valid receipt: PROCEED\nOne-field tamper: REFUSE"
npm run check:demo-unchanged # byte-identity vs 33f5486b
npm test                     # root 16
npm --prefix apps/worldsfair-agent-trust test   # 43 original + live-*.test.js
npm run demo:live-local
```
