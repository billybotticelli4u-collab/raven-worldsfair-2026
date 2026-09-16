# Raven Conformance UI Contract v1

**Schema id:** `raven-conformance-ui-contract/1`  
**Report schema (extended carefully):** `raven-conformance-report/1`  
**Audience:** UI lane + local judge surface (`public/app.js`, `src/server.js`)  
**Compatibility:** Additive extension of MVP report fields. Existing UI may treat any non-`PASS` vector status as “not pass” for badges; prefer reading `summary.counts` and new status strings when available.

## 1. Target manifest shape

Targets live in `targets/manifests.json` → `targets[]`:

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | string | yes | Stable id (e.g. `CONFORMANT_REFERENCE`) |
| `name` | string | yes | Human label |
| `version` | string | yes | Semver-ish |
| `entry` | string | yes | Path relative to `targets/` |
| `claimed_conformance_profile` | string | yes* | Profile name; omitted/ignored for `probe: true` |
| `invocation_interface` | string | yes | MVP: `stdin_json_line` |
| `description` | string | yes | |
| `expected_outcome` | string | no | `CONFORMANT` / `DIVERGENT` / probe-specific |
| `probe` | boolean | no | If true: hostile boundary probe, **not** a conformance demo |
| `probe_kind` | string | no | e.g. `network`, `env`, `write`, `timeout`, `child`, `flood`, `malformed`, `crash` |

UI **must not** offer arbitrary public code upload. Only allowlisted manifest targets.

## 2. Run request

`POST /api/run` body (JSON):

```json
{
  "target": "CONFORMANT_REFERENCE",
  "timeout_ms": 3000,
  "run_id": "optional_client_supplied"
}
```

| Field | Type | Default |
|-------|------|---------|
| `target` | string | required for run |
| `timeout_ms` | number | runner default (3000) |
| `run_id` | string | server-generated `run_<hex>` |

Probe suite: `GET /api/probes` or CLI `npm run probes`.

## 3. Progress events (`GET /api/run-stream`)

The Challenge 2 Judge UI opens `EventSource("/api/run-stream?target=<ID>")` and receives newline-delimited SSE `data:` JSON payloads:

```json
{ "type": "run_started", "run_id": "...", "target": "..." }
{ "type": "vector_finished", "run_id": "...", "vector_id": "...", "status": "PASS" }
{ "type": "run_finished", "run_id": "...", "overall": "CONFORMANT", "payload": { "report": { }, "ui": { } } }
{ "type": "error", "run_id": "...", "code": "RUNNER_FAILURE", "message": "..." }
```

`POST /api/run` remains available as the one-shot fallback response for environments that cannot hold an SSE connection.

## 4. Report schema (`raven-conformance-report/1` extended)

### Retained (MVP-compatible)

- `schema`, `run_id`, `started_at`, `finished_at`, `product`, `build_stage_note`
- `target{id,name,version,entry,entry_sha256,claimed_conformance_profile,invocation_interface,description}`
- `claimed_profile{name,version,file,sha256}`
- `corpus{id,version,file,sha256,declared_content_digest_sha256,vector_count}`
- `environment`, `allowed_resources`, `results[]`, `divergence_definition`, `limitations`, `reproduction`
- `report_content_digest_sha256` — digest of the full serialized report body (volatile fields included)
- `summary.test_count`, `summary.pass`, `summary.divergence`, `summary.overall`

### Additive fields

- `summary.behavioral_divergence` — same count as `divergence` (alias clarity)
- `summary.counts` — map of every taxonomy status → integer
- `summary.incomplete` — boolean if run aborted
- `isolation` — `{ mode, verified, platform, details, verified_controls[], assumed_controls[] }`
- `binding` — `{ profile_sha256, corpus_sha256, target_entry_sha256, deterministic_report_sha256 }`
- `volatile_fields` — list of serialized fields that are intentionally excluded from `deterministic_report_sha256`
- `results[].status` — expanded taxonomy (below); `DIVERGENCE` retained as **alias of** `BEHAVIORAL_DIVERGENCE` only if needed for old UI — Challenge 1 prefers `BEHAVIORAL_DIVERGENCE` and keeps `summary.divergence` count for compatibility
- `probe_section` — optional; present on probe runs

### Vector status taxonomy (none silently PASS)

| Status | Meaning |
|--------|---------|
| `PASS` | Parsed decision matches expected |
| `BEHAVIORAL_DIVERGENCE` | Ran + parsed; decision ≠ expected |
| `TARGET_CRASH` | Non-zero exit / spawn crash without valid decision |
| `TIMEOUT` | Wall-clock / kill timeout |
| `INVALID_OUTPUT` | Unparseable or missing `decision` |
| `OUTPUT_FLOOD` | stdout/stderr exceeded byte cap |
| `SKIPPED_VECTOR` | Explicitly marked skip; counted in summary |
| `RUNNER_FAILURE` | Isolation/setup failure |
| `BOUNDARY_ESCAPE` | Probe: boundary failed (escape observed) |
| `BOUNDARY_HOLD` | Probe: boundary held (expected block/fail) |
| `INCOMPLETE` | Interrupted run partial row |

**Conformance claim rule:** For profile demos, `overall: CONFORMANT` only if every corpus vector is `PASS`. Crashes / timeouts / invalid / flood / skipped vectors **must not** become `PASS` and **must** appear in `summary.counts`. `summary.divergence` counts `BEHAVIORAL_DIVERGENCE` only (UI compatibility).

## 5. Deterministic digest vs volatile metadata

**Included in `deterministic_report_sha256` / content digest:** schema, product, target binding digests, profile, corpus, isolation mode disclosure (not wall-clock), results semantic fields (vector_id, status, expected, observed.decision/reason), summary counts/overall, divergence_definition, limitations text, binding object.

**Volatile (excluded from deterministic digest):** `run_id`, `started_at`, `finished_at`, per-vector `evidence.durationMs`, `environment` wall identity that changes host-to-host may be bound separately. The current implementation still includes `reproduction`, `limitations`, and `isolation.platform` inside `deterministicReportBody()`, so edits to those fields will change `deterministic_report_sha256` until the digest inputs are narrowed further.

## 6. Error codes

| Code | HTTP / CLI | Meaning |
|------|------------|---------|
| `unknown_target` | 400 / exit 2 | Target id not in manifest |
| `missing_target_entry` | 500 | Entry file missing |
| `invalid_json` | 400 | Bad request body |
| `RUNNER_FAILURE` | 500 / report | Isolation/setup failed |
| `OUTPUT_FLOOD` | in-result | Byte cap hit |
| `TIMEOUT` | in-result | Kill after timeout |
| `INVALID_OUTPUT` | in-result | Bad target stdout |
| `INCOMPLETE` | report | Interrupted |

## 7. Replay request / response

CLI: `npm run replay -- --report <path>`

Request conceptually:

```json
{ "report_path": "reports/run_….json" }
```

Response:

```json
{
  "schema": "raven-conformance-replay/1",
  "ok": true,
  "bundle_match": true,
  "semantic_match": true,
  "original_binding": { },
  "replay_binding": { },
  "original_overall": "CONFORMANT",
  "replay_overall": "CONFORMANT",
  "diffs": []
}
```

Replay: verify profile/corpus/target digests match report binding, re-exec in clean isolation workdir, compare semantic outcomes (statuses + decisions), not volatile timestamps.

## 8. Current UI / server compatibility notes

| Surface | Today | Challenge 1 |
|---------|-------|-------------|
| `GET /api/targets` | all targets | Filter or flag `probe: true` so UI default list stays demos |
| `POST /api/run` | `{ target }` → report | Same; additive report fields OK |
| `public/app.js` | `PASS` vs else; `summary.pass` / `divergence` | Keep working; show `isolation.mode` if present; treat `BEHAVIORAL_DIVERGENCE` like prior DIVERGENCE |
| Badges | `pass` / `div` | Map non-PASS → `div` (or finer classes later) |

See `integration/UI_CONSUME_CONTRACT.md` for the minimal patch guidance.
