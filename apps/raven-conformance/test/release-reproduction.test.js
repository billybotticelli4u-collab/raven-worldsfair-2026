import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runConformance } from '../src/lib/runner.js';
import { checkReportIntegrity } from '../src/lib/replay.js';

const PUBLIC = 'https://github.com/billybotticelli4u-collab/raven-worldsfair-2026.git';
const stale = /billy-d1-correction|challenge2-disclosure-candidate|billy\/fair-conformance-mvp|codex\/challenge2-disclosure-fixes/;
const privateDelivery = /\.bundle|DELIVERY-IDENTITY\.json|DELIVERY_IDENTITY_MISMATCH|AUTHOR-REPORT\.md/;
// The public recipe needs only the public repository; it pins the asserted build commit, or stops at a guard.
function check(recipe) {
  assert.ok(recipe.includes(`git clone ${PUBLIC} raven-worldsfair-2026`), 'recipe must clone the public repository');
  assert.ok(recipe.includes(': "${FAIR_BUILD_COMMIT:?'), 'recipe must stop until the build commit is known');
  assert.ok(recipe.includes('git checkout --detach "$FAIR_BUILD_COMMIT"'), 'recipe must pin the checkout to the asserted commit');
  assert.doesNotMatch(recipe, stale);
  assert.doesNotMatch(recipe, privateDelivery);
}

test('release recipe: live report uses current delivery with an executable identity gate', async () => {
  const report = await runConformance('CONFORMANT_REFERENCE', { write: false });
  check(report.reproduction.clean_clone);
  assert.equal(report.summary.test_count, 12);
  assert.equal(report.summary.pass, 12);
});

test('release handoff contains the live recipe, minus the per-instance commit line', async () => {
  const report = await runConformance('CONFORMANT_REFERENCE', { write: false });
  const handoff = readFileSync(new URL('../RELEASE-HANDOFF.md', import.meta.url), 'utf8');
  // A document cannot carry the commit of the instance that prints the recipe; every other line must match.
  const template = report.reproduction.clean_clone.split('\n').filter((line) => !line.startsWith('FAIR_BUILD_COMMIT=') && !line.startsWith('# Build identity of this instance'));
  assert.ok(template.length >= 12);
  assert.ok(handoff.includes(template.join('\n')), 'RELEASE-HANDOFF.md must contain the public recipe verbatim');
});

for (const name of readdirSync(new URL('../examples/', import.meta.url)).filter(n => /^sample-report-.*\.json$/.test(n))) {
  test(`release recipe: recorded ${name} uses the public route and retains migration provenance`, () => {
    const report = JSON.parse(readFileSync(new URL(`../examples/${name}`, import.meta.url)));
    check(report.reproduction.clean_clone);
    assert.equal(report.reproduction_update.kind, 'instructions_only');
    assert.equal(report.reproduction_update.observations_rerun, false);
    assert.match(report.reproduction_update.previous_file_sha256, /^[a-f0-9]{64}$/);
    const { report_content_digest_sha256, deterministic_report_sha256, ...body } = report;
    assert.equal(report_content_digest_sha256, createHash('sha256').update(JSON.stringify(body, null, 2) + '\n').digest('hex'));
    if (report.binding) assert.deepEqual(checkReportIntegrity(report), { ok: true, diffs: [] });
  });
}
