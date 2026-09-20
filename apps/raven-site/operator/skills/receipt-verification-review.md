# Skill: receipt-verification-review
Purpose: periodically prove stored receipts still verify (the long-term promise).
Inputs: a sample of stored receipts from private/leads.json (receiptHash/keyId/observedSlot) or the public /receipts.html samples.
Steps: 1) for each: fetch /pubkey, locate the receipt's keyId, and confirm the served key material matches the operator-pinned expected key 2) check signatureAlg matches the published alg for that key 3) recompute replayHash; compare 4) verify signature over domain||officialAttestationHash 5) record VERIFIED/MISMATCH in the daily brief.
Outputs: verification report line; MISMATCH escalates immediately.
Human approval required: NO to run (read-only); YES for any action following a MISMATCH.
Banned: declaring VERIFIED on partial checks; "post-quantum secure" claims anywhere.
Safe fallback: MISMATCH = incident — freeze related key actions, escalate to Glen, re-run the original request for a fresh receipt to compare.
