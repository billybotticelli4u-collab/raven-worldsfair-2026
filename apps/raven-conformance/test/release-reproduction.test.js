import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runConformance } from '../src/lib/runner.js';
import { checkReportIntegrity } from '../src/lib/replay.js';

const bundle = 'raven-c2-release-successor-2026-09-19.bundle';
const branch = 'codex/c2-release-successor-2026-09-19';
const stale = /billy-d1-correction|challenge2-disclosure-candidate|billy\/fair-conformance-mvp|codex\/challenge2-disclosure-fixes/;
function check(recipe) {
  assert.ok(recipe.includes(bundle), 'recipe must name current bundle');
  assert.ok(recipe.includes(branch), 'recipe must name current branch');
  assert.ok(recipe.includes('DELIVERY-IDENTITY.json'), 'recipe must bind external identity');
  assert.ok(recipe.includes('DELIVERY_IDENTITY_MISMATCH'), 'identity mismatch must stop reproduction');
  assert.doesNotMatch(recipe, stale);
  assert.ok(recipe.includes(`git clone --branch ${branch} ./${bundle} raven-worldsfair-2026`));
}

test('release recipe: live report uses current delivery with an executable identity gate', async () => {
  const report = await runConformance('CONFORMANT_REFERENCE', { write: false });
  check(report.reproduction.clean_clone);
  assert.equal(report.summary.test_count, 12);
  assert.equal(report.summary.pass, 12);
});

test('release handoff contains the same executable live recipe', async () => {
  const report = await runConformance('CONFORMANT_REFERENCE', { write: false });
  const handoff = readFileSync(new URL('../RELEASE-HANDOFF.md', import.meta.url), 'utf8');
  assert.ok(handoff.includes(report.reproduction.clean_clone));
});

for (const name of readdirSync(new URL('../examples/', import.meta.url)).filter(n => /^sample-report-.*\.json$/.test(n))) {
  test(`release recipe: recorded ${name} uses current delivery and retains migration provenance`, () => {
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
