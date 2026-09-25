# Provenance — Replay SDK UI backend successor

## Reconstructed base (not upstream commit object)

The accepted integrated archive  
`RAVEN-REPLAY-SAVED-CASES-INTEGRATED-2026-09-22.tar.gz`  
(SHA-256 `2058d12fecdbbb790181db5754847ea2110d3efa15f10985c80839dfd851500f`)  
ships **without** a `.git` directory.

Billy 2 therefore created a **local reconstructed root commit**:

| Field | Value |
| --- | --- |
| Local base commit | `cce9acaa49bfbd672930fa0c79b715e279a94d56` |
| Local base TREE | `fa14dadced86a45d5193069dbb2d77e19955c444` |
| Stated upstream HEAD | `c7ffd6f94ef38b6b537088b34353fc5b0490e0ce` |
| Stated upstream TREE | `fa14dadced86a45d5193069dbb2d77e19955c444` |

**Proof:** `git write-tree` over a fresh extract of the archive equals `fa14dadc…`, which equals the reconstructed base commit’s tree and the upstream-stated TREE.

The stated upstream **commit** `c7ffd6f9…` is **not reproduced** here (objects absent from the tarball). History was not rewritten to fake that commit hash.

## Successor lineage (no rewrite)

1. `cce9acaa…` — reconstructed base (TREE `fa14dadc…`)
2. `3f78b2c1…` — first implementation candidate (preserved; delivery folder untouched)
3. *(this repair)* — portable supervisor + `WORK_BUDGET` restore on top of `3f78b2c1…`

## Author

Commits use author `Raven R&D <raven-rd@local>` (local convention). This packet is **author evidence**, not approval.

## R5 (2026-09-24)

Successor of R4 HEAD `2847908c…`. Closes R4-C1: every signaling path identity-gated;
mismatch aborts with no escalation. Vendor SDK still frozen at dbcee545 (38/38).
Claude frontend `public/*` untouched. No push/merge/deploy.

## R6 (2026-09-24)

Successor of R5 `534571ed…`. Closes Claude B1: absolute ps capture under empty PATH;
no empty-field wildcards; exact command/lstart match; unreadable ≠ gone.
Vendor still frozen at dbcee545 (38/38). `public/*` untouched. No push/merge/deploy.
