# Challenge 2 review repairs

Base: b8c1b47ce88a5fa21bf6494a80240bbe2ff549bc, tree ae75c5534996767368a9cab772609840084d3998.
This branch repairs the confirmed base-review findings. It is separate from both
frozen Phase 1 candidates and from the accepted standalone Foundry.

- A nonzero exit or signal is TARGET_CRASH even when stdout contains the correct
  decision. The owned crash probe now emits a valid decision before its fatal error.
- Target profile name and explicit claimed_conformance_profile_version must equal
  the loaded profile name and version. Missing/mismatched values fail closed with
  PROFILE_MISMATCH. Corpus profile identifiers must agree. No profile rules changed.
- Runtime loading rejects declared/computed corpus digest mismatches with
  CORPUS_DIGEST_MISMATCH. This checks stale digests, not an authenticated corpus root;
  replacement plus recomputation of the corpus's own digest remains outside this fix.
- Replay recomputes both stored digests before execution. The deterministic digest
  projection excludes its own binding field, identically before and after sealing.
  Mandatory bindings must agree with every corresponding local artifact identity.
- Semantic replay compares the full ordered vector list, descriptions, expected and
  observed values/reasons, exit codes and summary counts. Missing, duplicated or
  reordered rows and resealed omissions cannot pass merely by shrinking the loop.

Seventeen targeted regressions cover the untouched base, including a positive check that the crash probe actually emits valid output. Existing coverage
is retained, including the crash taxonomy test strengthened to require TARGET_CRASH.
This is author evidence, not independent acceptance. Hash self-consistency is not
independent authentication: hashing uses the existing producer serialization helper;
actual replay is the additional behavioral check. No execution attestation exists.

Known limits retained: original isolation implementation, probe interpretation,
platform boundaries, curated-demo filesystem/network behavior, skipped-vector
policy, and unsigned self-resealed fully consistent evidence are not certified or
newly repaired by this change. No Foundry integration, profile/corpus expansion,
reference-target repair, deployment, governance work, or Phase 2 inspection occurs.
Old recorded fallbacks remain labeled as historical recordings, not newly executed
runs. Their replay may be refused where mandatory current profile-version bindings
are absent. Regenerate a live report for this candidate's acceptance.

Independent review must bind to the new frozen HEAD/TREE supplied separately and
rerun the original six blockers. Do not inherit the old base's review or the
standalone Foundry GO as acceptance of this branch.
