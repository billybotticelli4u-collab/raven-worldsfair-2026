# Skill: receipt-verification
Purpose: independently verify any stored Raven receipt. Read-only.
Inputs: stored response JSON.
Steps: 1) GET /pubkey and confirm the served key material matches the operator-pinned expected key 2) recompute replayHash via canonical JSON (repo recipe) 3) compare hashes 4) verify ed25519 signature over domain||officialAttestationHash 5) optionally re-run the request and diff findings.
Outputs: VERIFIED / MISMATCH (+ which step failed).
Human approval required: NO.
Banned: declaring VERIFIED on partial checks.
Safe fallback: MISMATCH → escalate to Glen immediately; treat as incident.
