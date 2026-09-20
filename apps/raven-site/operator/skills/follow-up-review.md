# Skill: follow-up-review
Purpose: daily check of follow-ups due; no lead goes stale silently.
Inputs: private/leads.json followUpDate fields.
Steps: 1) list rows with followUpDate <= today 2) draft from templates/follow-up-3-days.md 3) queue for Glen 4) on reply, update repeatUsage/notes/nextRequestedFeature.
Outputs: due list + drafted follow-ups.
Human approval required: YES (every outbound message).
Banned: auto-sending; more than one follow-up question per message.
Safe fallback: no response after 2 follow-ups → mark stalled, stop.
