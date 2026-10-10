# Judge provenance appendix

Technical history retained below the judge-facing walkthrough. These records are component-specific; they do not establish deployment identity, external audit, release approval or contest eligibility.

## Corpus and source pins

At the 10 October dry run the hosted page asserted `dba22af0006faa2be9c45268b33534e2d19a543c`. Conformance's reproduction pin is `2cb12875b2a0f65b8a59999ffa33807e35a81e43`; the intervening merge changed only README.md and JUDGE_START_HERE.md. Corpus 1.4 contains 30 vectors. The new `npm run demo` convenience command is introduced by the current guide successor, not by that old corpus pin.

Local saved-case Replay uses the legacy inspector and registered adapters from SDK `dbcee545`. It cannot save Solana version1 results. A separate reviewed version1 CLI successor is not integrated here. Conformance's version1 fixtures do not expand saved-case Replay's scope.

## Recorded component reviews

This combined local candidate descends from non-author reviewed (INTERNAL_ADVERSARIAL_NON_AUTHOR; not EXTERNAL_INDEPENDENT) HEAD
`4be5ff7858b6636108a219f2c4e94a989c08d79e` / TREE
`30471bbd366d726102446ce3240e4b941e292439`. Claude's review was bounded to
the supplied Darwin/local/unpublished package and its stated component scopes.
The later SDK-licence successor `d93cab02758ee8a0b0f92accb0cfe78c37b6497b`
has a KIMI backup changed-scope CHANGES verdict: its four licence changes pass,
but that exact tree fails the guide's Replay checksum step. The condition is
closed in checksum-and-documentation successor
`d39517aac2e0ed8ffd6e6bfa2a3e4af4f6813f89`, which has a bounded Claude PASS.
This review-recording and manifest-completion successor requires its own
non-author review. None of those reviews authorizes a merge, deployment,
publication or submission.

The Agent Trust app's review class remains the Day-2 `a5cd592b` INTERNAL_ADVERSARIAL_NON_AUTHOR GO; the combined review did not exercise that app.


## Historical source tip (Fair product — Day-2; not the current combined candidate)

| Field | Value |
| --- | --- |
| Branch (private Fair worktree) | `billy/worldsfair-2026-day2-malformed-clock-repair-2026-09-14` |
| Fair HEAD | `a5cd592b72d2da1ebf6f0c1e224d05489ff31524` |
| Fair TREE | `3e442f93529bdb5da876b54d484294032535e84a` |
| Worktree | `<home>/raven-rnd-gauntlet-push/wf-day2-malformed-clock-repair` |
| Review | INTERNAL_ADVERSARIAL_NON_AUTHOR GO (Billy copy) — not EXTERNAL_INDEPENDENT |
| Verifier pin | `1b04356a275742752fb7afd8dfcc4269d462a778` |
| Prior public Day-1 HEAD | `feaa1fb452b8e1307979dea7fd1c561fad82aa00` |

---

