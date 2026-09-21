# Raven Conformance — Developer Reproduction

These commands run entirely against committed fixtures. They do not query a Solana cluster and do not claim that any transaction executed on-chain.

## Bootstrap from the review package

From the extracted package folder containing `DELIVERY-IDENTITY.json`, the bundle, and the patch:

```bash
set -e
shasum -a 256 -c SHA256SUMS.txt
git clone ./raven-solana-profile-base-fa205f85.bundle raven-worldsfair-2026
cd raven-worldsfair-2026
git checkout fa205f8580ac29a72188698a27974a8e63975a1c
git rev-parse HEAD
git rev-parse 'HEAD^{tree}'
node -e 'const fs=require("node:fs"),cp=require("node:child_process"),id=JSON.parse(fs.readFileSync("../DELIVERY-IDENTITY.json","utf8"));const head=cp.execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),tree=cp.execFileSync("git",["rev-parse","HEAD^{tree}"],{encoding:"utf8"}).trim();if(id.schema!=="raven-solana-feature-delivery/1"||id.base_commit!==head||id.base_tree!==tree||id.artifacts?.base_bundle?.path!=="raven-solana-profile-base-fa205f85.bundle"||id.artifacts?.full_patch?.path!=="raven-solana-profile-r4-bootstrap-fix.patch")throw Error("DELIVERY_IDENTITY_MISMATCH");'
git apply --check ../raven-solana-profile-r4-bootstrap-fix.patch
git apply ../raven-solana-profile-r4-bootstrap-fix.patch
```

Expected base identity before applying the patch:

```text
HEAD fa205f8580ac29a72188698a27974a8e63975a1c
TREE ad0cad8bd8a450777881fd05c9501d5c2fba714a
```

The checkout is pinned to the base commit. The Solana integration is the separately hashed patch; both are required.

## Requirements

- Node.js 22 or newer
- A clean extraction or clone of the candidate package under review
- No dependency installation for the conformance runner

## Run the full package suite

From the repository root:

```bash
cd apps/raven-conformance
node --version
npm test
```

`npm test` must exit `0` before interpreting any target result.

## List profiles and Solana targets

```bash
npm run conform -- --profiles
npm run conform -- --profile solana --list
```

The Solana selector resolves to `raven-solana-txversion-experimental/0`.

The local Judge UI exposes the same allowlisted registry:

```bash
npm start
# open http://127.0.0.1:8791 and select "Solana transaction versions"
```

The UI passes the selected profile through metadata, target discovery, live SSE execution, report rendering, download, and replay. It does not recompute the engine verdict.

## Run the Solana reference target

```bash
npm run conform -- \
  --profile solana \
  --target SOL_CONFORMANT_REFERENCE \
  --run-id solana-reference
```

Expected exit code: `0`. The report must say `CONFORMANT`, with every vector `PASS`, and is written to `reports/solana-reference.json`.

## Run the deliberately broken target

```bash
set +e
npm run conform -- \
  --profile solana \
  --target SOL_BROKEN_SUBTLE \
  --run-id solana-broken-subtle
test "$?" -eq 1
set -e
```

Expected result: the command exits `1` because the target is `DIVERGENT`, with exactly two behavioral divergence rows: `V03_valid_v1` and `V16_valid_v1_two_instructions`. Behavioral divergence is only an expected-versus-observed mismatch for this named corpus; it does not state exploitability or an on-chain result.

## Replay the bound reference report

```bash
npm run replay -- --report reports/solana-reference.json
```

Expected exit code: `0`, with `ok`, `bundle_match`, and `semantic_match` all `true`.

## Run the developer-adapter example

The example implements the runner's one-JSON-object-in / one-JSON-object-out process boundary and delegates to the bundled reference target. Replace `IMPLEMENTATION_ENTRY` in the example with a developer-owned compatible entry point.

```bash
jq -c '.vectors[0].input' corpus/raven-solana-txversion-demo-corpus-1.2.json \
  | npm run example:solana-adapter
```

Expected output has `"decision":"ACCEPT"` and `"version":"legacy"`. The full app suite executes the adapter against all 12 vectors.

## CI example

`.github/workflows/solana-profile-example.yml` is a zero-install GitHub Actions example. It runs the full app suite, the existing envelope reference, both required Solana targets, an exact `V03`/`V16` divergence assertion, and deterministic replay.

## Coverage inventory

`SOLANA_COVERAGE_INVENTORY.json` lists all 26 source vectors as exactly one of `included_from_source` or `omitted_from_source`, and separately identifies `V15_unexpected_input_key` as Raven-local. The inventory is test-checked against both the source corpus and the integrated 12-vector corpus.

## Run the shared fail-closed probes

```bash
npm run probes
```

The probe report distinguishes behavioral divergence from crash, timeout, invalid output, output flood, runner failure, and boundary escape. The exact isolation disclosure in the report controls; a Node child process alone is not represented as a security sandbox.

## Demonstration-slice limits

The 12-vector corpus is a Fair demonstration slice selected from the reviewed 26-vector corpus `1.1.0`. The cut preserves one ACCEPT path per transaction version and the named behavior classes above, but it intentionally drops some per-arm mutation detections from the larger corpus: legacy-size-only, signature-cap-only, address-cap-only, heap-only, and v1-duplicate-address-only mutants can survive this slice. V15 exercises the fail-closed input-shape guard. Strict-base64 discrimination is not covered: the runner compares decision and detected version, not reason, so a permissive decoder can still refuse V14-class bytes for a different reason. Legacy/v0 header-inconsistency call sites and `writable_unsigned_overflow` are unvectored in both this slice and its 26-vector source corpus; V23 covers the v1 `ro_signed_gte_req` site only. Prior family-level mutant kills establish at least one covered site per named family, not site-by-site coverage across every target call site. A `CONFORMANT` result means only that the target matched this named corpus at its pinned digest.

Use this claim for the experimental profile: **"The target matched this named experimental corpus."** Do not infer signature verification, transaction safety, wallet/Blink coverage, simulation, or on-chain execution.
