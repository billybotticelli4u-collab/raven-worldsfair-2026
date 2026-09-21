# Exportable-cleanliness fixtures (CLAUDE-068 / CLAUDE-072)

## Layout

- `allowlists/judge-package-v5.2.txt` — sandbox-root allowlist for sealed judge package v5.2
- `allowlist-demo/` — only local path listed in allowlist → expect exit 0 with `--allowlist`
- `private-tmp-only.json` — only `/private/tmp` + `/var/folders` → must exit 1 **without** allowlist
- `clean-sealed-proxy/` — relative-only stand-in when sealed package v5.2 is not on this host
- `claude-066-leaked-revalidate-report.json` — absolute `target.entry` leak
- `historical/` — seal 600758b5 class, CLAUDE-066, four comparison.json session-metadata leaks (all must FAIL)
- `bypass-corpus/` — ≥40 adversarial vectors + `manifest.json` (run via `scripts/run-exportable-cleanliness-bypass-corpus.mjs`)
- `symlink-demo/` — O1: symlinks → checker exit **3** (refuse; never silent skip)

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | clean |
| 1 | absolute-path leak(s) |
| 2 | usage / IO |
| 3 | symlink refuse (O1) |

## Out of scope (O3)

Base64 / opaque encodings are **not** decoded. See corpus vector `O3-base64-blind-spot` (expected exit 0).

## Reviewer

Author does not self-GO. **KIMI reviews** (not Claude). Billy implements.
