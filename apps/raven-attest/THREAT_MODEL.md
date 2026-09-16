# Threat model — Raven Conformance report & replay boundary

Subject: `apps/raven-conformance` at HEAD `53360df071872a29447993e879add2be9406b7b5`,
TREE `468b0397c89165160337a53597e8b6533f1f1dec` (identity re-derived from a fresh
clone). Measurements on darwin/arm64, Node `v24.18.0`.

## 1. What the report is, structurally

A conformance report is an **unsigned self-description**. Every identity field in
it was computed by the runner from the bundle that happened to be on disk at run
time, and the report's own `report_content_digest_sha256` is a checksum the
presenter can recompute at will.

That is not a criticism of the checksum — it is the correct reading of what it
covers. It detects *editing of one report file*. It does not detect *substituting
what the report was about*, and it does not establish *who produced it*.

## 2. Field-by-field: what bytes are covered, and by whom

| Report field | Covers | Checked by the MVP at run time? | Classification |
|---|---|---|---|
| `report_content_digest_sha256` | every other field of the same report, serialised `JSON.stringify(…,2)+"\n"` | No consumer reads a report back at all | **Self-sealed** — presenter-recomputable |
| `target.entry_sha256` | raw bytes of `targets/<entry>` at run time | Computed, never re-checked | Covering (vs. that file) |
| `target.entry` | a path joined onto `targets/` with **no containment check** | No | **Unbounded reference** (F-3) |
| `target.id/name/version/description/invocation_interface` | copied from `manifests.json` | No | Descriptive |
| *(manifest digest)* | — | **Absent from the report entirely** | **Uncovered** (F-4) |
| `claimed_profile.sha256` | raw bytes of the profile file | Computed, never re-checked | Covering (vs. that file) — but see F-2 |
| `claimed_profile.name/version` | strings, not covered by the sha beside them | No | Descriptive (S23) |
| `corpus.sha256` | `{id,version,profile,description,vectors}` re-serialised | Computed, never re-checked | Covering (vs. that corpus) |
| `corpus.declared_content_digest_sha256` | the corpus file's own claim about itself | **Carried but never compared** to `corpus.sha256` at run time (only `npm test` compares) | Uncovered at run time (F-1c) |
| `corpus.vector_count` | an integer | No | Descriptive |
| `results[].observed` | a summary of `results[].evidence.stdout` | Never re-derived from the stdout it ships beside | Uncovered (F-6) |
| `results[].expected` | copied from the corpus | Never re-compared to the corpus | Uncovered (F-6) |
| `summary.*` | counts over `results[]` | Never recomputed | Uncovered (F-6) |
| `started_at` / `finished_at` / `run_id` / `evidence.durationMs` | execution metadata | n/a | **Variable** — not reproducible (F-5) |
| `environment.*` | host identity | n/a | **Host-dependent** — stable per host only |

"A displayed hash is not verification": `public/app.js` prints the profile,
corpus, target-entry and report digests (lines 48–54, 102–108) and verifies none
of them. *(Read from source; the browser UI was not executed — see FINDINGS
"What I did not verify".)*

## 3. Attacker models

| # | Model | Can do | Cannot do |
|---|---|---|---|
| M1 | **Report presenter** | edit any report bytes and reseal the digest | change the bundle the checker reads |
| M2 | **Bundle supplier** | ship any corpus/profile/manifest/target bytes and re-run the real engine | forge a pin the consumer fetched independently |
| M3 | **Manifest committer** | change what a target id points at, including outside `targets/` | — |
| M4 | **Stale presenter** | re-present an old genuine report, or two reports under one run_id | — |

M1 is defeated by cross-checking the report against the bundle and against
itself (attest B-rows). M2 is defeated **only** by an out-of-band pin (C1) —
case `S16` is the measured proof that without a pin M2 wins. M3 is defeated by
containment + manifest pinning (A7/C1). M4 is defeated only by a verifier-side
ledger (G1); a lone report cannot establish its own freshness.

## 4. Deterministic vs variable content

MEASURED (`D01`): two honest `--target CONFORMANT_REFERENCE` runs over
byte-identical inputs.

```
engine report_content_digest_sha256 equal across runs : false
top-level keys that differ : run_id, started_at, finished_at, results, report_content_digest_sha256
attest conformance_core_digest equal across runs      : true
conformance_core_digest                              : 48c492024b783de611406dd3c7ab0cdd7922f2a5a29d5dde344b9d40004e9629
```

`conformance_core_digest` covers target, claimed_profile, corpus, allowed_resources,
summary, divergence_definition, limitations, reproduction, and each result's
vector_id / description / expected / observed / status / stdout / stderr / exitCode.

It deliberately **excludes** `run_id`, `started_at`, `finished_at`,
`evidence.durationMs`, and the `environment` block. No promise is made that
runtime metadata is identical across runs or across hosts, because it is not.

## 5. Coverage matrix — requirement → check → case → measured outcome

Full machine-readable form: `results/SUBSTITUTION_RESULTS.json`
(`runs[]` and `detector_coverage[]`). 28 cases, 28 as-frozen, 0 untested guards.

| Requirement the report implies | attest check | Attack case | Measured |
|---|---|---|---|
| Report is about *this* profile's bytes | A1 | S17 profile bytes swapped post-run | REJECTED |
| Profile identity strings are the profile's own | A1b | S23 name/version restated | REJECTED |
| Report is about *this* corpus content | A2 | S24 corpus digest rewritten in report | REJECTED |
| Corpus's self-claim matches its own vectors | A3 | S04 expectation flipped, digest not resealed | REJECTED |
| Report carries the corpus's claim unaltered | A3b | S18 carried digest rewritten | REJECTED |
| Vector count is the corpus's | A4 | S18 count rewritten | REJECTED |
| Target identity is the manifest's | A5 | S19 fields rewritten · S22 unknown target id | REJECTED |
| Report is about *these* executed bytes | A6 | S01 target bytes swapped post-run | REJECTED |
| Replay reference stays inside `targets/` | A7 | S12 `../` escape in manifest entry | REJECTED |
| Report has not been edited since sealing | B1 | S09 edit without reseal | REJECTED |
| Summary follows from the rows | B2 | S08 summary inflated · S09 | REJECTED |
| Row status follows from its own fields | B3 | S20 status flipped, summary aligned | REJECTED |
| Observed decision is the stdout it ships | B4 | S07 observations rewritten | REJECTED |
| Rows cover the corpus, in order | B5 | S10 rows reordered | REJECTED |
| Expectations are the corpus's | B6 | S06 expectations rewritten | REJECTED |
| Timestamps well-formed and ordered | B7 | S21 inverted | REJECTED |
| Bundle is the pinned bundle | C1 | S01,S02,S03,S04,S05,S11,S12,S17,S22 | REJECTED |
| Corpus expectations follow from the profile | D1 | S04, S05, S17 | REJECTED |
| No unqualified trust/deployment/on-chain claim | E1 | S15 forged claim · S19 "certified" | REJECTED |
| Deterministic content is separable | F1 | — (INFO; tested by D01 instead) | core digest equal, report digest not |
| run_id is fresh / not colliding | G1 | S13 stale reuse · S14 collision | REJECTED |
| Filename binds to run_id | G2 | S25 renamed report | **UNDERSPECIFIED** — no contract |
| Valid replay still works | all | P01 conformant · P02 divergent-but-honest · P03 foreign cwd | ACCEPTED |
| Report alone (no pin) cannot catch bundle swap | — | S16 | **ACCEPTED — this is the gap** |

Every non-INFO check has at least one case in which it fails. A guard that never
fails anywhere in the pack is an untested guard, not a passing one; the harness
prints that classification and currently reports zero.

## 6. Claims this pack does **not** establish

- **Not** that the report's author is who they say they are. There is no
  signature anywhere in the loop. Byte binding ≠ authorship.
- **Not** that a CONFORMANT verdict means the target is safe, secure, or free of
  defects outside the 10 vectors.
- **Not** that the pin is authentic — only that the bundle matches the pin I
  froze. Pin distribution is out of scope and unsolved here.
- **Not** anything about isolation strength. The runner is a `child_process` with
  a restricted env and a 3 s timeout; no sandbox escape was attempted.
- **Not** anything about third-party systems. Nothing outside this repository was
  tested.
