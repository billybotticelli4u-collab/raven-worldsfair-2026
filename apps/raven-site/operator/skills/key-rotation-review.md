# Skill: key-rotation-review
Purpose: rotate the attestation signing key deliberately, without breaking any historical receipt.
Inputs: reason for rotation (scheduled / suspected exposure), Glen's APPROVED decision-log entry.
Steps: 1) generate new keypair offline (operator terminal, never in chat/browser/repo) 2) decide old key state: retired (scheduled) or revoked (compromise) 3) update verifier config so /pubkey serves BOTH keys with states (Render change = engine adoption, Glen approves) 4) update /key-policy.json currentKeyId + RAVEN_CRYPTO_AGILITY.md + agents.json 5) verify: new receipts carry new keyId; an OLD stored receipt still verifies against the old key 6) decision-log entry with both keyIds (prefixes only).
Outputs: rotated key, both keys published, policy files updated, old-receipt verification proven.
Human approval required: YES — rotation never happens automatically, no exceptions.
Banned: automated rotation; deleting old public keys; re-signing old receipts; private material in any committed or static file.
Safe fallback: if anything fails mid-rotation, old key stays active; rotation is aborted, not half-done.
