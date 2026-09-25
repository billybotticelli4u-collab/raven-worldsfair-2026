// FIXTURE GENERATOR — not end-to-end evidence. Authored by Claude.
// Writes the exact response bodies the SDK paths of the local server return, by calling the same accepted SDK
// engine functions the backend worker calls (createCase / runCases), plus the adapter list shaped as the r3
// backend's GET /cases/adapters. It never starts a server and never writes into the SDK tree.
// Usage (pinned runtime required by the SDK): node test/fixtures/sdk-ui/generate-fixtures.mjs <accepted-sdk-package-root>
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const sdkRoot = path.resolve(process.argv[2] ?? '');
const out = path.dirname(fileURLToPath(import.meta.url));
const sdk = await import(pathToFileURL(path.join(sdkRoot, 'src', 'cases.mjs')).href);
const registry = JSON.parse(fs.readFileSync(path.join(sdkRoot, 'adapters', 'registry.json'), 'utf8'));
const write = (name, value) => fs.writeFileSync(path.join(out, name), JSON.stringify(value, null, 2) + '\n');
const ZERO = '0'.repeat(64);

// GET /cases/adapters, shaped exactly as the r3 backend maps the vendored registry (id, label, schema only).
write('adapters-list.fixture.json', { schema: 'raven-replay-adapter-list/1',
  adapters: registry.adapters.map(a => ({ id: a.id, label: a.label || a.id, schema: sdk.CASE_SCHEMA })) });

// POST /cases/create with adapter_id: the server returns createCase(...) unchanged.
const input = fs.readFileSync(path.join(sdkRoot, 'fixtures', 'legacy-transaction.base64'), 'utf8').trim();
const created = sdk.createCase(input, { name: 'kit-legacy-accept', adapterId: 'solana-kit-tx-decode' });
write('create-sdk.fixture.json', created);
const base = created.case;
const digest = created.case_content_sha256;

// A second SDK case whose expected result is a parser REJECT (truncated synthetic bytes), if the adapter refuses them.
let rejectCase = null;
try {
  const truncated = Buffer.from(input, 'base64').subarray(0, 40).toString('base64');
  rejectCase = sdk.createCase(truncated, { name: 'kit-truncated-reject', adapterId: 'solana-kit-tx-decode' }).case;
  write('create-sdk-reject.fixture.json', { case: rejectCase, case_content_sha256: sdk.caseDigest(rejectCase) });
} catch (error) {
  write('create-sdk-reject.error.fixture.json', { kind: error.kind ?? null, error: error.message });
}

// Tampered variants, each with a distinct name so they can share one batch.
const changed = structuredClone(base);
changed.name = 'kit-changed-expectation-control';
const decodedKeys = Object.keys(changed.expected_execution.parsed.decoded ?? {});
const header = changed.expected_execution.parsed.decoded?.message?.header;
if (header && typeof header.numSignerAccounts === 'number') header.numSignerAccounts += 6;
else if (decodedKeys.length) changed.expected_execution.parsed.decoded[decodedKeys[0]] = 'synthetic changed expectation';
const drifted = structuredClone(base);
drifted.name = 'kit-binding-drift-control';
drifted.bindings.adapter_source_sha256 = ZERO;
const replaced = structuredClone(base);
replaced.name = 'kit-reference-mismatch-control';

const report = (cases, options) => sdk.runCases(cases, options);
write('run-sdk-match.fixture.json', report([base], { expectedCaseSha256s: [digest] }));
write('run-sdk-no-reference.fixture.json', report([base]));
write('run-sdk-regression.fixture.json', report([changed]));
write('run-sdk-reference-mismatch.fixture.json', report([base], { expectedCaseSha256s: [ZERO] }));
write('run-sdk-run-error.fixture.json', report([drifted]));
// One homogeneous SDK batch carrying all four outcomes (MATCH, REGRESSION, INVALID_CASE, RUN_ERROR).
write('run-sdk-four-outcomes.fixture.json', report([base, changed, replaced, drifted, ...(rejectCase ? [rejectCase] : [])],
  { expectedCaseSha256s: [digest, undefined, ZERO, undefined, ...(rejectCase ? [undefined] : [])] }));
write('run-sdk-detailed-regression.fixture.json', report([changed], { detailed: true }));
write('case-sdk.fixture.json', base);

write('MANIFEST.json', {
  label: 'FIXTURES — generated from the accepted SDK engine for UI tests; NOT end-to-end evidence of the integrated server',
  generator: 'test/fixtures/sdk-ui/generate-fixtures.mjs',
  sdk_package_root_basename: path.basename(sdkRoot),
  sdk_case_schema: sdk.CASE_SCHEMA,
  node: process.version,
  generated_utc: new Date().toISOString(),
  adapter_list_shape: 'mirrors the r3 backend loadSdkAdapters(): {id, label, schema}',
});
console.log('fixtures written to', out);
