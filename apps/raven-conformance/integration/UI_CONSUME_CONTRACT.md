# UI lane — consume Challenge 1 contract

**Contract files (local publish for UI lane):**

- `interface/raven-conformance-ui-contract-v1.md`
- `interface/raven-conformance-ui-contract-v1.json`
- `GET /api/contract` serves the JSON

## Minimal consumption patch (conceptual)

1. Discover allowlisted profiles with `GET /api/profiles`; pass the selected name to target/meta discovery and execution.
2. `POST /api/run` accepts `{ "profile": "<name-or-alias>", "target": "<demo id>" }`. Omitting `profile` preserves the envelope default.
3. Prefer `report.summary.counts` when present; fall back to `pass` / `divergence`.
4. Treat vector `status === "PASS"` as green; any other status as not-pass (including `BEHAVIORAL_DIVERGENCE`, formerly implied by `DIVERGENCE`).
5. Display `report.isolation.mode` + `report.isolation.verified` in the identity panel. If `verified === false`, show curated-demo disclosure (do not claim sandbox).
6. Demo target list: `GET /api/targets?profile=<selector>` returns non-probe targets only. Probes remain envelope-only via `GET /api/probes` / `POST /api/run-probes`.
7. Replay: `POST /api/replay` with `{ "report_path": "..." }` or CLI `npm run replay -- --report …`.
8. Do **not** add arbitrary file/code upload controls.

## Compatibility with current `public/app.js`

Challenge 1 updates `public/app.js` in-repo to show isolation + expanded summary counts.
External UI forks should follow the JSON contract; additive fields only — do not remove `summary.pass`, `summary.divergence`, `summary.overall`.
