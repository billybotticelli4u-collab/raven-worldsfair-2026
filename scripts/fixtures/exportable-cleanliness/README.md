# Exportable-cleanliness fixtures (CLAUDE-068)

- `claude-066-leaked-revalidate-report.json` — absolute `target.entry` (constructed; prefer real historic Mac leak if synced)
- `allowlist-demo/` — only local path listed in allowlist → expect exit 0 with `--allowlist`
- `private-tmp-only.json` — only `/private/tmp` + `/var/folders` → must exit non-zero
- `clean-sealed-proxy/` — relative-only stand-in when sealed package v5.2 (`67fe72eb…`) is not on this host

Real sealed package v5.2 lives on Mac `machineId=54f619bf-8923-4452-818b-5ab416ad504a` under ROBY Downloads / INTEGRATION-LANE. Subagent Shell does not route machineId (Linux box only).
