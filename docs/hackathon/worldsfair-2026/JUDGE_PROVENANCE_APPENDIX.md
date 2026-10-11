# Judge provenance appendix

Public attribution uses stable role labels: contributor A (integration/packaging), contributor B (frontend/documentation and internal review), contributor C (decoder measurements/Linux operations), contributor D (recording/reconstruction), and reviewer E (backup/decoder review). These are AI-assisted internal contributors and reviews, not external audits. Role labels preserve author/reviewer separation; historical commits and sealed evidence remain unchanged. Private packet filenames are omitted here; retained hashes identify the exact records.

Technical history retained below the judge-facing walkthrough. These records are component-specific; they do not establish deployment identity, external audit, release approval or contest eligibility.

## Corpus and source pins

contributor B's 9 and 10 October rechecks recorded the hosted page (`/api/build-info`) asserting `dba22af0006faa2be9c45268b33534e2d19a543c`; this is an unverified platform assertion, not proof of served bytes. `1db786e63766cc2671209331a555b0d9c58c3cbb` is the 10 October docs commit that added `npm run demo`; it has not been the asserted hosted build. Conformance's reproduction pin is `2cb12875b2a0f65b8a59999ffa33807e35a81e43`; `apps/raven-conformance` is byte-identical between those commits, but other product files differ. Corpus 1.4 contains 30 vectors. The `npm run demo` convenience command is present in 1db786e6 and this successor, not in the old corpus pin.

Local saved-case Replay uses the legacy inspector and registered adapters from SDK `dbcee545`. It cannot save Solana version1 results. A separate reviewed version1 CLI successor is not integrated here. Conformance's version1 fixtures do not expand saved-case Replay's scope.

## Recorded component reviews

Role-based internal attribution is retained here and in the [editorial source map](submission/SOURCE-MAP.md); judge-facing summaries use role descriptions. These are internal non-author reviews, not external audits.

### Kit V10 independent confirmation

contributor C authored the original decoder measurements and the later two-adapter reconciliation. reviewer E's internal non-author review (private archive record; identified by the adjacent hash) (SHA-256 `ac43c83e3fe7a9d869374e03e7af84274e2cfdf875443d7a1ecdc24fb9590655`) independently confirmed both verbatim Kit 8.4.0 adapters row by row on Node 22.18.0, macOS arm64. Each 30-row report reproduced its retained record with zero row differences. V10 is the sole cross-adapter difference: transaction-decoder-only accepts; the two-call adapter's compiled-message decoder rejects with layout error #8078001, not length-minimality enforcement. The other 29 rows agree.

The confirmation covers those two adapters, not all diagnostic variants or every API. Environment-bound report digests differ across platforms. The displayed structural scores retain the original measurement run's mapping; the V17/V19 taxonomy difference remains disclosed. Kit's trailing-byte tolerance is a documented maintainer-accepted tradeoff (kit#1963); impact unassessed. The original files and full review lineage remain in the [confirmation source record](submission/SOURCE-MAP.md#kit-v10-independent-confirmation). contributor A performed this source/documentation import; its checks are author evidence, with a separate contributor B documentation tick required before any requested landing.

This combined local candidate descends from non-author reviewed (INTERNAL_ADVERSARIAL_NON_AUTHOR; not EXTERNAL_INDEPENDENT) HEAD
`4be5ff7858b6636108a219f2c4e94a989c08d79e` / TREE
`30471bbd366d726102446ce3240e4b941e292439`. contributor B's review was bounded to
the supplied Darwin/local/unpublished package and its stated component scopes.
The later SDK-licence successor `d93cab02758ee8a0b0f92accb0cfe78c37b6497b`
has a reviewer E backup changed-scope CHANGES verdict: its four licence changes pass,
but that exact tree fails the guide's Replay checksum step. The condition is
closed in checksum-and-documentation successor
`d39517aac2e0ed8ffd6e6bfa2a3e4af4f6813f89`, which has a bounded contributor B PASS.
This review-recording and manifest-completion successor requires its own
non-author review. None of those reviews authorizes a merge, deployment,
publication or submission.

The Agent Trust app's review class remains the Day-2 `a5cd592b` INTERNAL_ADVERSARIAL_NON_AUTHOR GO; the combined review did not exercise that app.


## Historical source tip (Fair product — Day-2; not the current combined candidate)

| Field | Value |
| --- | --- |
| Branch (private Fair worktree) | (private archive record; identified by the adjacent hash) |
| Fair HEAD | `a5cd592b72d2da1ebf6f0c1e224d05489ff31524` |
| Fair TREE | `3e442f93529bdb5da876b54d484294032535e84a` |
| Worktree | `<home>/raven-rnd-gauntlet-push/wf-day2-malformed-clock-repair` |
| Review | INTERNAL_ADVERSARIAL_NON_AUTHOR GO (contributor C copy) — not EXTERNAL_INDEPENDENT |
| Verifier pin | `1b04356a275742752fb7afd8dfcc4269d462a778` |
| Prior public Day-1 HEAD | `feaa1fb452b8e1307979dea7fd1c561fad82aa00` |

---
