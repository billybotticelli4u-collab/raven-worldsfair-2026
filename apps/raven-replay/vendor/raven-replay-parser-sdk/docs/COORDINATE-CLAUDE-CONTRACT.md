# Coordinate with Claude — contract delta (C3PATH path provenance)

Billy 1 successor after CODEX C3 pin-map recheck of `7546982c` (remaining **C3 path-provenance** only). Claude owns Quickstart/UI lane — **do not implement a competing engine**. Integrate against this revised contract before UI wiring.

## Schema / report changes Claude must absorb

1. **Default reports** (`report`, `rerun`, default `compare-versions`, including incomplete comparison summaries):
   - No reconstructible wire/message/signature bytes.
   - **Pin-map policy** (`src/report-pin-map.mjs`, id `raven-replay-default-report-pin-map/1`) unchanged for reasons and decoded `field_names`.
   - **Difference `field` paths (C3PATH):** built from structured segments during diff traversal. Complete literal object keys are pin-mapped or `field_<sha12>` of the entire key. Readable `[n]` only from real array-index segments — never by parsing brackets from flattened untrusted key text. Bracket-bearing / dotted literal keys cannot leak decimal or dotted payload via path split.
   - Applies to top-level summary, `differences`, and completed **and** incomplete version-comparison reports (and fresh-experiment diffs).
   - Flag `report_omits_reconstructible_wire: true` remains. Not a covert-channel / sandbox claim.

2. **Detailed opt-in** (unchanged intent, clearer label):
   - `report --detailed` → schema `raven-replay-adapter-case-report/1-detailed`; may include unsanitized raw difference field strings.
   - `compare-versions --detailed` → may include `result_full_from_saved_baseline` under label `FULL_BASELINE_PARSED_OPT_IN`.
   - Default comparison sets `result_full_from_saved_baseline: null`.

3. **Version comparison schema** remains `raven-replay-version-comparison/3`. C5 retained-baseline semantics **unchanged / closed**.

4. **Normalisation Option A**, **binding**, **watchdog**: unchanged from prior closed findings.

## Out of scope for Claude here

- No competing parser/SDK implementation.
- No push/merge/deploy/publication/RPC/credentials/outreach.
- Quickstart / Claude UI lane otherwise untouched by this package.
