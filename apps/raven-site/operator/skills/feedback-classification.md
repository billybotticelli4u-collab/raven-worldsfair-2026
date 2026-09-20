# Skill: feedback-classification
Purpose: turn lead/beta feedback into a deterministic build/docs/decline bucket.
Inputs: role, use case, missing evidence, decision supported, notes.
Steps: run node scripts/raven-feedback-classifier.mjs with the fields; copy bucket + flags into the lead row; tally per problem-hunt.
Outputs: bucket, sanctionedEngineWork, docsIssue, outOfScope, reason.
Human approval required: NO for classification; YES before acting on it.
Banned: overriding the script by vibes; LLM re-classification.
Safe fallback: bucket "unsupported/out of scope" → use the decline template.
