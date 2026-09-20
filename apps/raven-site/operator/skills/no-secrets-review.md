# Skill: no-secrets-review
Purpose: pre-push guarantee that no secret reaches the public repo or site.
Inputs: working tree.
Steps: 1) node scripts/raven-change-review.mjs 2) node test.mjs 3) confirm operator/private/ still gitignored (git check-ignore) 4) git diff --staged for anything rvk_/PEM/bearer-like.
Outputs: PASS/FAIL with file:line.
Human approval required: NO to run; FAIL blocks push unconditionally.
Banned: pushing on FAIL; printing matched secret values.
Safe fallback: on FAIL, remove the string, rotate if it was real, re-run.
