# Findings — artifact & replay substitution against the Raven Conformance MVP

Author: CLAUDE (verification lane). **This is author evidence, not independent
review and not owner acceptance.** I wrote both the checker and the attacks; the
verdicts below rest on commands anyone can re-run, not on my authorship.

Subject re-derived from a fresh clone, not taken from the handoff:

```
repo   github.com/billybotticelli4u-collab/raven-worldsfair-2026
branch billy/fair-conformance-mvp-2026-09-16
HEAD   53360df071872a29447993e879add2be9406b7b5
TREE   468b0397c89165160337a53597e8b6533f1f1dec
```

Host: darwin arm64, Node `v24.18.0`. Baseline `npm test` in
`apps/raven-conformance`: **7 pass / 0 fail**. Handoff counts confirmed:
3 targets, 10 vectors, 7 tests, `child_process` + restricted env + 3000 ms
timeout, no container isolation.

Reproduce everything here with:

```bash
cd apps/raven-attest && node harness/substitution.js
```

MEASURED: 28 cases, 28 as-frozen, 0 off-expectation, 0 harness errors,
0 untested guards.

---

## The three most compelling judge-visible divergences

### F-1 — A known-broken target is certified CONFORMANT by shrinking the corpus

Delete the two vectors `BROKEN_SUBTLE` fails, reseal the corpus's own
`content_digest_sha256`, run the **unmodified** engine:

```
$ node src/cli.js --target BROKEN_SUBTLE
Raven Conformance Report  run_4a82a302247c498a
Overall: CONFORMANT  (8 PASS / 0 DIVERGENCE of 8)
Target: BROKEN_SUBTLE  claimed profile: raven-canonical-envelope/1
Corpus: raven-canonical-envelope-demo-corpus/1@1.0.0  sha256=234055a1…
$ echo $?
0
```

The emitted report is internally flawless: `corpus.sha256` matches the corpus,
the corpus's declared digest matches its own vectors, the report digest
recomputes. The corpus **id and version are unchanged** — nothing visible to a
reader says two vectors were removed. Exit code 0.

Harness `S03` REJECTS this via the out-of-band pin. Harness `S16` runs the
identical attack **without** `--pins` and is **ACCEPTED** — that contrast is the
finding, not a bug in the checker. Report-internal consistency cannot detect
bundle substitution, by construction.

Partial mitigation already present, and MEASURED: `npm test` fails 3 of 7 on the
shrunken corpus, because `test/conformance.test.js:12` hardcodes
`vectors.length === 10`. But the README's "CLI reproduction (one command after
clone)" block lists only the `conform` command, and the UI's **Copy reproduction
command** button copies `report.reproduction.one_liner`
(`runner.js:219`), which is also `conform`-only. A judge who follows either path
never runs the test that would have caught it.

**Minimal fixes** (engine-side; not applied by me):
1. `runner.js loadCorpus()` — compare `computed` vs `data.content_digest_sha256`
   at run time and surface the mismatch in the report. Today only the test does.
2. Pin the expected corpus/profile/manifest digests in a file the runner reads,
   and emit `pin_status: MATCH|MISMATCH|ABSENT` in the report.
3. `runner.js:219` — make `one_liner` `npm test && npm run conform -- --target X`,
   and update README's CLI block to match.

### F-2 — The claimed profile is never executed; it is a document, not a spec

MEASURED (`S05`): rewrote `profiles/raven-canonical-envelope-1.json` — version
`1.0.0`→`2.0.0`, `allowed_top_level_keys` extended with `extra` and
`x_extension`, and `rules[0]` inverted to *"Unexpected top-level keys are
permitted."* — then re-ran `BROKEN_SUBTLE` before and after:

```
summary_before      : {test_count:10, pass:8, divergence:2, overall:"DIVERGENT"}
summary_after       : {test_count:10, pass:8, divergence:2, overall:"DIVERGENT"}
outcomes_identical  : true
```

Nothing changed. The profile's digest is displayed beside the verdict and covers
no decision. The corpus is the only operative specification, and the claim
"corpus C encodes profile P" is an authorial assertion the MVP never tests.

Counter-evidence I produced: attest check `D1` re-derives the expected decision
for every corpus vector from the profile's own `allowed_top_level_keys`,
`required_top_level_keys`, `schema_value`, `digest_algorithm` and `rules[]`,
reading no target file. MEASURED: **all 10 corpus expectations agree with the
profile-derived oracle.** So the corpus does faithfully encode the profile for
these 10 vectors — but that is now *my* independent evidence, produced outside
the MVP, and it should not be described as something the MVP establishes.

**Minimal fix:** port a `D1`-style profile→corpus derivation into
`test/conformance.test.js`, or state in the report that expectations are
corpus-asserted rather than profile-derived.

### F-3 — `target.entry` is an unbounded path and the engine executes it

`runner.js:171` does `path.join(TARGETS_DIR, target.entry)` with no containment
check, then spawns it.

MEASURED (`S12`): manifest entry set to `../src/traversal-probe.mjs`; the
**unmodified** engine spawned the file outside `targets/`:

```
engine_executed_escaped_path : true
reported_entry               : "../src/traversal-probe.mjs"
```

The report then carries a perfectly valid `entry_sha256` for a file that is not
a target. The trust boundary here is "who can edit `manifests.json`" — i.e. a
pull request — so this is a review-surface hole rather than a remote exploit, but
the replay reference itself is unbounded.

**Minimal fix** (3 lines, engine-side, not applied by me):

```js
const entryAbs = path.resolve(TARGETS_DIR, target.entry);
if (entryAbs !== TARGETS_DIR && !entryAbs.startsWith(TARGETS_DIR + path.sep))
  throw new Error(`entry_outside_targets_dir:${target.entry}`);
```

---

## Remaining findings

### F-4 — `manifests.json` is covered by nothing (MEDIUM)

The report copies target id/version/profile/description out of the manifest and
digests none of it. MEASURED (`S02`): re-point `CONFORMANT_REFERENCE.entry` at
`BROKEN_OBVIOUS.mjs`, re-run — the emitted report is fully self-consistent under
the id `CONFORMANT_REFERENCE`. Only the pin (`C1`) catches it.
**Minimal fix:** add `target.manifest_sha256` to the report.

### F-5 — The report digest is not reproducible, and no consumer verifies it (MEDIUM)

MEASURED (`D01`): two honest runs over byte-identical inputs produce **different**
`report_content_digest_sha256`; the differing keys are `run_id`, `started_at`,
`finished_at`, `results` (per-vector `durationMs`). So the digest cannot be used
to compare two runs — only to detect editing of one file. Separately, no code
path in the MVP reads a report back; `reports/*.json` is gitignored; `public/app.js`
displays four digests and checks none.
**Minimal fix:** emit a second, deterministic `conformance_core_digest` (the
partition is implemented in `src/lib/stable.js` and is a purely additive schema
change), and ship a `verify` script so the loop has a consumer.

### F-6 — Report edits are cheap; the seal is self-computed (MEDIUM)

`S06` (expectations rewritten), `S07` (observations rewritten, status and summary
made to agree), and `S08` (summary inflated) each produce a report whose own
`report_content_digest_sha256` verifies correctly. They were caught only by
cross-checks the MVP performs nowhere: against the corpus (`B6`), against the raw
stdout the report ships beside its own summary (`B4`), and by recomputing the
arithmetic (`B2`).
**Consequence for copy:** the report must not be described as tamper-evident. It
is checksum-sealed against accidental edits by a party who does not recompute.

---

## Underspecified — could not establish a contract

| id | Case | Why |
|---|---|---|
| U-1 | Canonicalization | The profile defines canonical JSON in prose (`rules[5]`) and ships **no canonicalization test vector**. My oracle is an independent reading of that prose; prose agreement is weaker evidence than a spec vector. Duplicate keys, non-UTF-8 input, number formatting (`1` vs `1.0`), and non-ASCII key ordering are all unspecified. |
| U-2 | Report filename vs `run_id` | The engine writes `reports/<run_id>.json`, but no contract makes the filename authoritative. `S25` renames a report; attest classifies `G2` **UNDERSPECIFIED** and does not reject. |
| U-3 | Freshness | A lone report cannot establish its own freshness: no nonce, no signature, no timestamp authority. `G1` needs a verifier-side ledger — `S13`/`S14` are REJECTED with `--ledger` and **SKIPPED** without it. |
| U-4 | Pin distribution | A pin committed to the branch an attacker can edit is not an out-of-band anchor. `pins/bundle-pins-53360df.json` is only as good as the channel the consumer fetches it through. Unsolved here. |

---

## Compatible change proposal (routed, not applied)

I did not edit `apps/raven-conformance` or the report schema. Proposed additive
changes, in priority order, all backward-compatible — existing consumers ignore
new keys:

1. `corpus.pin_status` and `claimed_profile.pin_status` and
   `target.manifest_sha256` — new keys in the report object.
2. `conformance_core_digest` — new sibling of `report_content_digest_sha256`.
   Implementation available verbatim in `apps/raven-attest/src/lib/stable.js`.
3. Containment assert on `target.entry` in `runConformance` (behavioural, rejects
   only inputs that are already outside the documented contract).
4. `reproduction.one_liner` prefixed with `npm test &&`.

Items 1–2 are pure additions. Item 3 changes behaviour only for manifests that
already violate the stated interface. Item 4 changes a string.

---

## Three decisions the owner actually needs to make

1. **Does the pin ship inside the engine, or stay external in `raven-attest`?**
   As it stands, a judge who runs only `apps/raven-conformance` is not protected
   against F-1. Moving the pin into the runner protects that judge but puts a new
   failure mode (`pin_status: MISMATCH`) on the demo path.
2. **Accept `conformance_core_digest` into the report schema?** It is additive
   and already implemented. Without it there is no value two runs can be compared
   on, and "reproducible" has to mean "re-runnable", not "reproduces the same
   evidence".
3. **Is the F-3 containment fix in scope for this branch, or deferred?** It is a
   3-line change to Billy's engine, which I am not authorised to make, and it
   touches the same file another lane may be editing tonight.

---

## Process notes — where my own frozen expectations were wrong

Expected detections are frozen in `harness/substitution.js` before execution. Four
froze wrong. In every case I revised the freeze and left the checker alone,
except one where the checker was genuinely deficient. All revisions are recorded
inline as `freeze_revision` on the case and appear in the JSON output.

- `S04`, `S05`, `S19` — my freeze was **incomplete**; the extra detections (`D1`,
  `D1`, `E1`) were correct behaviour I had not anticipated. Freeze widened.
- `S12` — my freeze was **wrong**: `A6` is SKIPPED by design once `A7` shows the
  reference escapes `targets/`, because attest refuses to read a file outside the
  boundary in order to digest it. Freeze corrected.
- `S01` — the **checker was deficient**. `C1` compared the pinned target digest
  only against what the *report* said, not against the bytes on disk, so swapping
  the target file after the run went unnoticed by the pin. `C1` now checks both.
  Recorded in `src/attest.js` as "checker revision 1".

---

## What I did not do, skipped, or could not verify

- **Did not execute the browser UI.** All statements about `public/app.js` and
  `src/server.js` are read from source. That the UI displays four digests and
  verifies none is DERIVED from code, not observed in a browser.
- **Did not edit** the engine, the shared schema, the corpus, the profile, the
  manifests, or any other lane's files. `git status` on my branch shows additions
  under `apps/raven-attest/` only.
- **Did not test any third-party system**, and made no claim about one.
- **Did not attempt sandbox escape** from a target process, and make no claim
  about isolation strength beyond quoting the engine's own documented limits.
- **Did not test signing, authorship, or authorization** — there is none in this
  loop. Nothing here establishes signer trust, authorization, deployment, or
  on-chain execution.
- **One host only**: darwin/arm64, Node v24.18.0. Not run on Linux and not run in
  CI. Cross-host determinism of `conformance_core_digest` is DERIVED from what
  the partition excludes, not MEASURED across hosts.
- **Did not review** the other three R&D assignments in this thread, and have not
  reconciled these findings with any other lane's output.
- **Negative claims are scoped**: "no consumer verifies the report" means no code
  path under `apps/raven-conformance/` at TREE `468b0397…` reads a report file
  back. I did not search the rest of the repository or any deployed surface.
