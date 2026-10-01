# Saved-case migration: execution policy `/1` → `/2` (DCB-2 S1)

## What changed
`POLICY.id` moved from `raven-replay-adapter-offline/1` to `raven-replay-adapter-offline/2`, so `policy_sha256` changed. The new policy declares the DCB-2 closure rule (installed optional/peer dependencies are part of the inventoried closure), the closure guard (adapter-side module loads are limited to exactly that closure), the exit-126 refusal convention, and the state of the `ws` native-addon flags.

## Effect on existing saved cases
Every case created under policy `/1` carries `bindings.policy_sha256` of `/1`. Under `/2` such a case is refused **before execution**:

- `rerun`, `compare-versions`, `report`: `INVALID_CASE` / `NOT_RUN`, error `Unsupported policy binding`.
- CLI exit `2`.

That refusal is the intended behaviour. It means "this saved expectation was produced under a different execution policy", not "the adapter regressed".

## What is preserved
- Old case files and their independently retained `case_content_sha256` digests remain valid evidence of what was measured under `/1`. Keep them. Do not edit them.
- Nothing in this package rewrites, relabels or re-signs an old case. There is no `--migrate`, no automatic acceptance, and no compatibility shim that treats a `/1` binding as `/2`.

## How to continue under `/2`
1. Keep the old case file and its retained digest in the evidence record, labelled with policy `/1`.
2. `create` a **new** case for the same adapter and input under `/2`; retain its new `case_content_sha256` independently (this is the C5 rule, unchanged).
3. Compare expectations across the policy boundary **by hand** if needed (the parsed results are in the case files); the tool does not claim equivalence between `/1` and `/2` cases.
4. Reference the new digest from then on.

## Within `/2`: the S2 revision
S2 binds four SDK child-runtime files into `dependency_binding_sha256`: the watchdog, closure guard, adapter observer hook and process-identity helper. It also adds three policy statements, so both `dependency_binding_sha256` and `policy_sha256` differ from the unreleased S1 build. Any case made with an S1 build is refused the same way and must be recreated; S1 was never released, so no published case is affected by this step. A later documentation correction changed the bound closure-guard comment bytes, so cases from the first local S2 browser assembly are also refused by its successor and must be recreated; neither assembly was released.

## Why no automatic migration
A `/1` case was measured without the closure guard and without optional/peer packages in the binding. Relabelling it as `/2` would assert a measurement that was never made. The honest record is two cases with two policies.
