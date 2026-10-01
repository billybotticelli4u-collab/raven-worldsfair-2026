# Raven Conformance — Developer Reproduction

These commands run entirely against committed fixtures. They do not query a Solana cluster and do not claim that any transaction executed on-chain.

## Bootstrap from the public repository

No delivery folder is needed. Pin the checkout to the commit the instance you are reproducing asserts
(`/api/build-info`, `fairBuildCommit`); the claim is asserted, not proof of served bytes.

```bash
set -e
: "${FAIR_BUILD_COMMIT:?set FAIR_BUILD_COMMIT to the fairBuildCommit shown by /api/build-info}"
git clone https://github.com/billybotticelli4u-collab/raven-worldsfair-2026.git raven-worldsfair-2026
cd raven-worldsfair-2026
git checkout --detach "$FAIR_BUILD_COMMIT"
git rev-parse HEAD
git rev-parse 'HEAD^{tree}'
cd apps/raven-conformance
npm test
npm run conform -- --profile raven-solana-txversion-experimental/0 --target SOL_BROKEN_SUBTLE
# SOL_BROKEN_SUBTLE intentionally returns exit 1 for V03/V10/V16 divergence; reference returns 0.
```

## Bootstrap from the review package (holders of the sealed delivery)

From the extracted delivery folder, verify SHA256SUMS.txt and clone the complete bundle. The external identity binds the finished commit (no patch application).

```bash
set -e
shasum -a 256 -c SHA256SUMS.txt
git clone --branch codex/solana-coverage-repair-20260925 ./raven-solana-coverage-repair.bundle raven-worldsfair-2026
cd raven-worldsfair-2026
node -e 'const fs=require("node:fs"),cp=require("node:child_process"),id=JSON.parse(fs.readFileSync("../DELIVERY-IDENTITY.json","utf8"));const head=cp.execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),tree=cp.execFileSync("git",["rev-parse","HEAD^{tree}"],{encoding:"utf8"}).trim();if(id.head!==head||id.tree!==tree||id.branch!=="codex/solana-coverage-repair-20260925"||id.bundle!=="raven-solana-coverage-repair.bundle")throw Error("DELIVERY_IDENTITY_MISMATCH");'
```

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

Expected result: the command exits `1` because the target is `DIVERGENT`, with three behavioral divergence rows: `V03_valid_v1`, `V10_noncanonical_shortvec_sigcount` and `V16_valid_v1_two_instructions`. Behavioral divergence is only an expected-versus-observed mismatch for this named corpus; it does not state exploitability or an on-chain result.

## Replay the bound reference report

```bash
npm run replay -- --report reports/solana-reference.json
```

Expected exit code: `0`, with `ok`, `bundle_match`, and `semantic_match` all `true`.

## Run the developer-adapter example

The example implements the runner's one-JSON-object-in / one-JSON-object-out process boundary and delegates to the bundled reference target. Replace `IMPLEMENTATION_ENTRY` in the example with a developer-owned compatible entry point.

```bash
jq -c '.vectors[0].input' corpus/raven-solana-txversion-demo-corpus-1.3.json \
  | npm run example:solana-adapter
```

Expected output has `"decision":"ACCEPT"` and `"version":"legacy"`. The full app suite executes the adapter against all 27 vectors.

## CI example

`.github/workflows/solana-profile-example.yml` is a zero-install GitHub Actions example. It runs the full app suite, the existing envelope reference, both required Solana targets, an exact `V03`/`V16` divergence assertion, and deterministic replay.

## Coverage inventory

`SOLANA_COVERAGE_INVENTORY.json` lists all 26 source vectors as exactly one of `included_from_source` or `omitted_from_source`, and separately identifies `V15_unexpected_input_key` as Raven-local. The inventory is test-checked against both the source corpus and the integrated 27-vector corpus.

## Run the shared fail-closed probes

```bash
npm run probes
```

The probe report distinguishes behavioral divergence from crash, timeout, invalid output, output flood, runner failure, and boundary escape. The exact isolation disclosure in the report controls; a Node child process alone is not represented as a security sandbox.

## Coverage and limits

Corpus 1.3 restores the 15 omitted source rows: all 26 source coverage properties plus the existing exact-key control are present. Source corpus bytes are retained under corpus/source with their original hash; restored inputs and expectations are unchanged. All 26 inputs and expectations match the pinned source, including V21’s 4202-byte witness. The subtle target now diverges on V03, V10 and V16: two defect classes, three rows. Target and profile bytes are unchanged.

Restored metadata binds local profile rules, not a claim of complete external-spec conformity. Strict-base64 rejection is present, but reason discrimination is still outside the runner's decision/version comparison. Unvectored header sites and known profile/spec gaps remain; 27 passing rows do not establish complete Solana support, signature validity or transaction safety.
