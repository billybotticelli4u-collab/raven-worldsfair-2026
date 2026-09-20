# Skill: hosted-verifier-smoke
Purpose: confirm the verifier is healthy. Read-only.
Inputs: none.
Steps: 1) GET /healthz expect {"status":"ok","signer":true} 2) GET /pubkey expect keyId rvk_c2997e90215279c2 3) optionally node scripts/site-smoke.mjs.
Outputs: one line for the daily brief.
Human approval required: NO.
Banned: any POST without operator key; any env/secret access.
Safe fallback: if down, note it in the brief and alert Glen — do NOT redeploy autonomously (engine adoption requires approval).
