# Adapter contract (milestone 1 — C1C6R2 successor)

Shared with CODEX/Claude for later UI coordination. CLI may proceed independently. **No competing UI/server in this package.** This delivery is a **separate CLI module**; the accepted Replay capture/saved-case UI is **not** integrated here.

## Case schema `raven-replay-adapter-case/1`

Cases are **data**. A case may identify an already registered `adapter_id`. A case **must not** supply code, commands, paths, package names to install, URLs, shell arguments or environment variables. Unknown identities and schema mismatches refuse before execution (`INVALID_CASE`).

Required fields: `schema`, `name`, `adapter_id`, `bindings`, `input_base64`, `input_sha256`, `expected_execution`, `comparison_policy`.

### Bindings

| Field | Meaning |
| --- | --- |
| `runtime` | Exact Node version string (milestone 1: `v22.18.0`) |
| `tool` | Tool identity string |
| `adapter_id` | Must match case `adapter_id` |
| `adapter_source_sha256` | SHA-256 of registered entrypoint file bytes |
| `dependency_binding_sha256` | Digest of **full execution closure** inventory: transitive npm packages resolved from declared `dependency_packages` **plus** the entire `adapters/` allowed tree (not merely the entrypoint's immediate directory). Closure rule (DCB-2 S1): `dependencies` (missing → refuse, unless also optional), **installed** `optionalDependencies`, **installed** `peerDependencies` (absent optional / optional-peer → skipped; absent required peer → refuse); nested-only layouts refuse. Shared helpers under `adapters/<other>/` participate in the binding. The four SDK files that execute in the child (`src/watchdog-exec.mjs`, `src/closure-guard.cjs`, `src/adapter-observe-hook.mjs`, `src/process-identity.mjs`) are bound byte-exact as kind `sdk_child_runtime`, so their bytes cannot change without changing this digest. Unreadable/oversized files and symlink targets outside the measured closure **refuse** (no silent skip). Immediate-directory inventory alone is **not** claimed to be the full local closure. |
| `policy_sha256` | Digest of execution policy `raven-replay-adapter-offline/2` (hard-deadline semantics, closure rule, closure guard, exit-126 convention, ws flag state). Cases bound to `/1` are `INVALID_CASE`; see `docs/MIGRATION-POLICY-2.md`. |
| `comparison_policy_sha256` | Digest of comparison policy |

A lockfile alone is **not** proof installed execution bytes are unchanged. Digests establish **consistency**, not publisher authentication. Changed closure bytes are refused **before** adapter execution on rerun.

### Expected execution

Must be `complete: true`, `exit_code: 0`, `signal: null`, `error_code: null`, `protocol_ok: true`. Infrastructure failures cannot become passing baselines.

### Parsed result

```
{ decision: "ACCEPT"|"REJECT", version: "legacy"|0|null, reason: string, decoded: object|null }
```

- `ACCEPT` requires `decoded` object (normalised).
- `REJECT` requires `decoded: null`.
- Expected parser refusal can **MATCH**.
- Crash, missing dependency, timeout/hard-deadline, excess output, invalid protocol, unknown/internal errors → incomplete → **RUN_ERROR**, never MATCH as refusal.

### Decode-boundary error classification (SDK-C2)

Decoders are **constructed outside** the input-refusal catch. Only a **narrow allowlist** of `@solana/errors` codes demonstrated to arise from malformed bytes during supported decode calls map to parser `REJECT`. The entire CODECS numeric range is **not** an input whitelist. Construction / encoder-decoder pairing faults (notably `8078004 ENCODER_DECODER_SIZE_COMPATIBILITY_MISMATCH`) exit non-zero → **RUN_ERROR** and must not become a saved REJECT baseline. Plain `Error`, unknown codes, projection failures, and infrastructure faults likewise → **RUN_ERROR**. Message-regex classification is forbidden. Allowlisted codes carry symbolic names + source justification in the Kit adapter.

## Registry `raven-replay-adapter-registry/1`

Local explicit file `adapters/registry.json`. Operator adds adapters by editing registry + files under `adapters/` only — **no engine edit**.

## CLI exits (preserved)

| Status | Exit |
| --- | --- |
| MATCH | 0 |
| REGRESSION | 1 |
| INVALID_CASE | 2 |
| RUN_ERROR | 3 |

Batch exit = max of per-case exits.

## Reports (SDK-C3 — pin-map + structured path provenance)

- **Default** `report` / `rerun` / default `compare-versions` summaries: statuses, identities, value digests. Human-readable `reason_code` and decoded / difference field path labels are emitted **only** when the string **exactly** matches the pinned allowlists in `src/report-pin-map.mjs` (`PINNED_REASON_CODES` / `PINNED_FIELD_NAMES`). All other adapter-provided reason text and dynamic keys/path components are **digest-only** (`reason_sha256` / `field_<sha12>`). This is exact pin-map matching — **not** a regex/length heuristic (short values like `AA==` and identifier-shaped payload keys are digested unless pinned). **No** reconstructible wire / message / signature bytes and **no** reason-echo of input. Flag `report_omits_reconstructible_wire: true` remains. Not a covert-channel or sandbox claim.
- **Difference paths (C3PATH):** `differences()` builds a structured segment list (`root` / `key` / `index`). Each complete literal object key is pin-mapped or `field_<sha12>` of the **entire** key before rendering. Readable `[n]` appears **only** for segments produced by actual array traversal (`kind: 'index'`). Default reports never recover provenance by parsing brackets out of a flattened untrusted string. Applies to ordinary reports, completed and incomplete version comparisons, and the fresh-experiment path.
- **Opt-in** `report --detailed`: schema `raven-replay-adapter-case-report/1-detailed`, explicitly labelled; may contain full parsed payloads and unsanitized difference field paths. Case **export** still contains raw `input_base64` and is labelled `contains_raw_input=YES`.

## Version comparison (SDK-C5 closed; schema `raven-replay-version-comparison/3` after C3 report repair)

**Primary:** `compare-versions --baseline-case <case.json> --expect-sha256 <digest> --candidate <id> [--detailed]`

1. Validate saved baseline case against independently retained digest.
2. Resolve baseline + candidate identities; require same `output_contract`.
3. Verify installed baseline adapter/deps match **saved case bindings** before candidate execution; refuse baseline replacement/drift (`RUN_ERROR`).
4. Execute candidate only; return leaf field diffs (e.g. `comparison.parsed.decoded.label`).
5. **Default** comparison reports use safe summaries + digests only (`result_full_from_saved_baseline: null`). Full baseline/candidate parsed payloads are available only behind explicit `--detailed` / `detailed:true`, labelled `FULL_BASELINE_PARSED_OPT_IN`. The original baseline **case file** remains intact and unchanged. Distinguish `status: COMPLETE` vs `INCOMPLETE`.

**C5 retained-baseline requirement remains CLOSED** — this R2 only adjusts report payload minimization (C3); it does not redo C5 semantics.

**Separate fresh experiment:** `compare-versions-fresh --baseline <id> --candidate <id>` — clearly labelled `FRESH_EXPERIMENT`; does **not** claim retained baseline. Coordinate schema with Claude; **no** competing UI/server in this package.

## JSON normalisation (SDK-C4) — Option A (JSON data only)

See `src/normalize.mjs`. **Bounded choice A:** native `Map`, `Uint8Array` / TypedArray views, and `bigint` are **rejected** at the case/hash API boundary. Adapters must emit JSON-ready plain data. Plain JSON objects that spell `$type` tags are ordinary objects — there is no native↔JSON lookalike collision because natives never enter canonicalisation.

- Own enumerable keys preserved (including `__proto__`, `constructor`, `prototype`) via `defineProperty` for `__proto__` — never ordinary `{}` setters.
- Distinct plain objects remain distinct (including Map-lookalike plain objects used as data).
- Unsupported prototypes/types rejected before hashing/execution.

## Subprocess / hard deadline (SDK-C6)

Bounded timeout/output/minimal env via `watchdog-exec.mjs`: detached process-group + **SIGKILL** at `timeout_ms` even if the child ignores SIGTERM; outer spawnSync SIGKILL grace. **Not a security sandbox.**

- **Overflow:** stdout or stderr above `max_output_bytes` is a hard failure (watchdog exit `125` → `RUN_ERROR`) even when a valid JSON prefix was already emitted. Overflow state is persisted; the process group is terminated.
- **Cleanup:** process-group SIGKILL runs on **every** terminal path (success, overflow, timeout, spawn error) so non-detached same-group descendants cannot survive parent completion. No host-wide killing.
- Darwin arm64 measured; Linux UNMEASURED.

## Execution closure guard (DCB-2 S1)

The adapter child may load modules **only** from the byte-inventoried closure: every closure package directory (`node_modules/<pkg>`), the `adapters/` tree, and four exact SDK child-runtime files (`src/watchdog-exec.mjs`, `src/closure-guard.cjs`, `src/adapter-observe-hook.mjs`, `src/process-identity.mjs`). The runner derives this set from the same closure it just inventoried and passes it as `RAVEN_CLOSURE_ROOTS`; `src/closure-guard.cjs` is preloaded via `NODE_OPTIONS=--require` (double-quoted, so package paths with spaces work; a path containing `"` refuses) into the watchdog, the adapter, and ordinary children that inherit the environment.

- A module that resolves anywhere else — an ancestor `node_modules`, a hoisted package that no closure member declares, an optional dependency that was absent at binding time, a realpath outside the closure — is **refused at load**: one JSON diagnostic line on stderr (`{"closure_guard":"REFUSED", reason, specifier, resolved, realpath, parent}`) then `process.exit(126)`. Exit rather than throw, because optional `try { require(x) } catch {}` probes would swallow a throw.
- Missing or malformed `RAVEN_CLOSURE_ROOTS` fails closed (only builtins load). Realpath lookup failure refuses.
- **Exit 126 is a reserved convention, not provenance.** An adapter can exit 126 itself. The runner labels `error_code: CLOSURE_ESCAPE` only when the diagnostic line is present and `EXIT_126_RESERVED` otherwise; both are incomplete → `RUN_ERROR`, and a create refuses to save either as an expectation.
- "Permitted" and "inventoried" are the same set — closure packages, `adapters/`, **and** the four SDK child-runtime files (one list, `CHILD_RUNTIME_FILES`, drives both) — so a permitted file cannot change without changing `dependency_binding_sha256`; changed bytes are refused before execution on rerun (existing rule).
- Parent-side SDK code (`runner`, `cases`, `binding`, `cli`) is the verifier itself, identified by the `tool` string; it is not self-bound into cases. Bytes are hashed when identity is resolved and re-read when the child starts; a change inside that window is not detected (as for every inventoried file).
- **Not a sandbox.** Code that bypasses the module loader is not seen: `fs` + `vm`/`eval` of outside files, native addons loaded by path, children that replace their environment, or a child whose failure the adapter ignores. Adapters are registered, trusted code; the guard bounds accidental and dependency-level escapes, not hostile adapters.

## Dependencies honesty

This successor **introduces npm dependencies** (`@solana/kit@8.3.0` and transitive closure). The accepted legacy Replay package had **none**. Kit scope = offline wire/message decode only.
