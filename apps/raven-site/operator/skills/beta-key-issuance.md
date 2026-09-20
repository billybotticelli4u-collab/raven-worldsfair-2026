# Skill: beta-key-issuance
Purpose: issue a hosted API key (optionally holder-beta) to an approved lead.
Inputs: approved lead row; Glen's APPROVED decision-log entry.
Steps: follow apps/launchguard-acp/deploy/BETA-KEY-ISSUANCE.md exactly (generate key offline → RAVEN_API_KEYS → optional RAVEN_HOLDERS_BETA_KEYS → Manual Deploy → battery → docs+curl via templates/beta-key-issued.md). Record prefix only.
Outputs: live key, updated lead row, decision-log entry.
Human approval required: YES — twice (issuance decision + outbound message).
Banned: keys in chat/browser/repo; enabling RAVEN_ENABLE_HOLDERS globally; skipping the post-deploy battery.
Safe fallback: rollback = remove key from env, redeploy.
