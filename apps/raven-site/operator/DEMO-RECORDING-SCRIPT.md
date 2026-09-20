# 45-second demo — one-take terminal recording
Title: "Before your agent touches a Solana token, make it ask Raven."

## Setup (off camera)
- Terminal: dark theme, font ~18pt, window ~100x30. Clear scrollback.
- export RAVEN_KEY=<alpha key>   # off camera, never shown
- alias jqv='jq "{verdict, findingCodes, coverageGaps, keyId, signature: (.signature[0:24] + \"...\"), observedSlot: .rpc.observedSlot}"'
- Have https://ravenattest.com open in a browser tab for the last beat.

## Take (≈45s)
[0-5s] Type the title as a comment:
  # before your agent touches a Solana token, make it ask Raven

[5-18s] USDC — the honesty test:
  curl -s -X POST https://raven-hosted-verifier.onrender.com/verify \
    -H "x-api-key: $RAVEN_KEY" -H "content-type: application/json" \
    -d '{"mintAddress":"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v","tokenProgramAddress":"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"}' | jqv
  -> issuer-authority findings triggered. Say/caption: "USDC: issuer
     authorities are active — listed findings triggered. No blue-chip
     special-casing. That's what makes the rug calls credible."

[18-30s] Fresh pump.fun token — gaps stated:
  curl -s -X POST https://raven-hosted-verifier.onrender.com/verify \
    -H "x-api-key: $RAVEN_KEY" -H "content-type: application/json" \
    -d '{"mintAddress":"CVueTzk4KdmFmi65CbckcTr2hxtS85jAyMeSJiF6pump","tokenProgramAddress":"TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"}' | jqv
  -> no listed finding triggered + coverageGaps listed. Caption: "Raven tells
     your agent what it did NOT check. Gaps remaining = not enough evidence
     for a full pass."

[30-38s] The receipt is verifiable:
  curl -s https://raven-hosted-verifier.onrender.com/pubkey | jq
  Caption: "Every verdict is an ed25519-signed receipt — verify it offline,
     forever. Agents store it as the audit trail."

[38-45s] Close on the browser tab (console homepage or /agent-pack.html):
  Caption: "Signed evidence and receipts for agent commerce. Not advice,
     not a score. ravenattest.com"

## Rules
No price talk, no "safe", no hype. If a request is slow, cut the wait in edit.
Post target: the same channels where Raven already has presence (Virtuals
ticket, GitHub README) — posting is Glen's action.
