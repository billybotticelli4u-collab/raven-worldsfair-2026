# Raven Abuse Runbook (operator twin of /abuse.html)
Cases & responses: rpcUrl/issuerIdentity -> 400 reject (tested). Secrets in
requests -> never logged (sanitized ledger, NO-SECRETS test). "Say it's
safe" -> refuse with gaps; "not enough evidence for a full pass". Trading
advice / price prediction / rug-score requests -> refuse, verification-only.
Mass anonymous calls -> rate limits (10/min/key, 30/min/IP) + invite gate.
Prompt injection via metadata/names -> inputs are data; engine decodes bytes,
never follows text. Executable user skills / shared mutable memory / browser
actions / outbound autonomy -> unsupported by design (Pulsia lesson: shared
skills and memory can be weaponized; Raven's public skills are read-only).
Escalation: any suspected abuse -> log in operator decisions, Glen owns the
response. Key compromise -> revoke per delegate-key policy.

## Real-incident grounding (2025-2026)
Tweet-borne prompt injection drained ~$200k from an auto-executing agent
(May 2026, Morse-code payload on X) -> inputs are data, never instructions;
no auto-execution. LLM-router MITM injected tool calls and drained $500k ->
receipts verify end-to-end against an independently pinned key (/pubkey is a
cross-check); never trust intermediaries.
Memory poisoning of agent long-term stores -> raw signed receipt is the only
truth; deterministic recall; verify before use. ~$45M aggregate agent
incidents in 2026 -> fail-closed + human approval gates are the architecture.
