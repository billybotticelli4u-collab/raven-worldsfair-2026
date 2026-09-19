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
  "run_id": "run_myexample"
}
```

| Field | Type | Default |
|-------|------|---------|
| `target` | string | required for run |
| `timeout_ms` | integer, 100–10000 inclusive | runner default (3000) |
| `run_id` | `run_` plus 1–64 ASCII letters/digits; must not already exist | server-generated `run_<hex>` |

HTTP admission hardening: JSON bodies must be objects, at most 65536 received
bytes, and completed within 5 seconds after the handler begins reading the body.
This applies to run, probes and replay. Oversized bodies return 413, unfinished
bodies 408, and invalid objects/options 400. These are transport refusals, not
conformance verdicts. Target/CLI semantics and profile bytes are unchanged.
This narrows formerly unchecked HTTP inputs; clients supplying arbitrary run IDs,
timeouts over 10000, or external replay paths must migrate.

SSE runs, POST runs, probes and replays share one execution lock. Concurrent
execution requests return 409 (SSE retains its existing named error event).
Disconnecting an SSE client does not cancel the bounded run; its lock remains
held until completion. No promise of cross-process locking is made.

Probe suite: `POST /api/run-probes` (optional) or CLI `npm run probes`.

## 3. Progress events (optional SSE / polled)

When streaming is added later, events:

```json
{ "type": "run_started", "run_id": "...", "target": "..." }
{ "type": "vector_started", "run_id": "...", "vector_id": "V01_..." }
{ "type": "vector_finished", "run_id": "...", "vector_id": "...", "status": "PASS" }
{ "type": "run_finished", "run_id": "...", "overall": "CONFORMANT" }
{ "type": "error", "run_id": "...", "code": "RUNNER_FAILURE", "message": "..." }
```

MVP HTTP path returns the full report in one response (no SSE required). UI may synthesize “RUNNING” locally.

## 4. Report schema (`raven-conformance-report/1` extended)

### Retained (MVP-compatible)

- `schema`, `run_id`, `started_at`, `finished_at`, `product`, `build_stage_note`
- `target{id,name,version,entry,entry_sha256,claimed_conformance_profile,invocation_interface,description}`
- `claimed_profile{name,version,file,sha256}`
- `corpus{id,version,file,sha256,declared_content_digest_sha256,vector_count}`
- `environment`, `allowed_resources`, `results[]`, `divergence_definition`, `limitations`, `reproduction`
- `report_content_digest_sha256` — digest of **deterministic body** (see §5)
- `summary.test_count`, `summary.pass`, `summary.divergence`, `summary.overall`

### Additive fields

- `summary.behavioral_divergence` — same count as `divergence` (alias clarity)
- `summary.counts` — map of every taxonomy status → integer
- `summary.incomplete` — boolean if run aborted
- `isolation` — `{ mode, verified, platform, details, verified_controls[], assumed_controls[] }`
- `binding` — `{ profile_sha256, corpus_sha256, target_entry_sha256, deterministic_report_sha256 }`
- `volatile` — `{ run_id, started_at, finished_at, durations }` documented separately from digest
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

**Conformance claim rule:** For profile demos, `overall: CONFORMANT` only if every corpus vector is `PASS`. Crashes / timeouts / invalid / flood **must not** become `PASS` and **must** appear in `summary.counts`. `summary.divergence` counts `BEHAVIORAL_DIVERGENCE` only (UI compatibility).

## 5. Deterministic digest vs volatile metadata

**Included in `deterministic_report_sha256` / content digest:** schema, product, target binding digests, profile, corpus, isolation mode disclosure (not wall-clock), results semantic fields (vector_id, status, expected, observed.decision/reason), summary counts/overall, divergence_definition, limitations text, binding object.

**Volatile (excluded from deterministic digest):** `run_id`, `started_at`, `finished_at`, per-vector `evidence.durationMs`, `environment` wall identity that changes host-to-host may be bound separately; `reproduction` branch tip strings may update — Challenge 1 binds digests of profile/corpus/target and semantic outcomes.

## 6. Error codes

| Code | HTTP / CLI | Meaning |
|------|------------|---------|
| `unknown_target` | 400 / exit 2 | Target id not in manifest |
| `missing_target_entry` | 500 | Entry file missing |
| `invalid_json` | 400 | Bad request body |
| `invalid_request` | 400 | JSON is not an object |
| `invalid_timeout` / `invalid_run_id` | 400 | Unsupported HTTP execution option |
| `run_id_exists` / `run_in_progress` | 409 | Existing report ID / server executing work |
| `request_too_large` / `request_timeout` | 413 / 408 | Body admission limit |
| `invalid_report_path` / `invalid_recorded_id` / `invalid_path_encoding` | 400 | Invalid HTTP file selector |
| `RUNNER_FAILURE` | 500 / report | Isolation/setup failed |
| `OUTPUT_FLOOD` | in-result | Byte cap hit |
| `TIMEOUT` | in-result | Kill after timeout |
| `INVALID_OUTPUT` | in-result | Bad target stdout |
| `INCOMPLETE` | report | Interrupted |

## 7. Replay request / response

CLI: `npm run replay -- --report <path>`

HTTP `POST /api/replay` accepts an existing regular `.json` file directly inside
this app's `reports/` or `examples/` only (app-relative or absolute). Symlinks and
external paths are refused. The CLI continues to accept operator-selected paths.
Recorded/download routes also reject symlinks and directory escapes. App files
are trusted; these checks do not isolate an attacker who can modify the app.

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
