# Skill: token-verdict-reply
Purpose: a lead named a token; return a signed verdict the same day.
Inputs: mint (or name/DexScreener link), token program, lead row.
Steps: 1) resolve mint+program 2) run hosted /verify (operator key, never in chat/browser) 3) record verdict+receiptHash+keyId+observedSlot in private/leads.json 4) fill operator/templates/verdict-reply-{verdict}.md 5) submit to Glen.
Outputs: updated lead row + drafted reply.
Human approval required: YES (outbound reply).
Banned: "safe", buy/sell wording, editing the verdict, omitting gaps.
Safe fallback: if resolution is ambiguous, ask the lead for the mint; if verifier errors, send verdict-reply-unknowable with the reason.
