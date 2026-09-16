import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {classifyResult as classifyExecution, runConformance} from '../src/lib/runner.js';
import {classifyResult as classifyDisplay} from '../src/lib/displayAdapter.js';
import {createRunWorkdir, cleanupWorkdir, resolveIsolation, spawnIsolated} from '../src/lib/isolation.js';

for (const observed of [{decision:'ACCEPT'}, null]) {
  test(`N2 crash disclosure does not deny a decision: ${JSON.stringify(observed)}`, () => {
    const execution = classifyExecution({exitCode:17, signal:null, observed,
      parseError:observed ? null : 'unparseable_stdout', timedOut:false, flooded:false}, 'ACCEPT');
    assert.equal(execution.status, 'TARGET_CRASH');
    const display = classifyDisplay({...execution, observed});
    assert.equal(display.kind, 'TARGET_CRASH');
    assert.doesNotMatch(display.plainLanguage, /without a usable decision/i);
    assert.match(display.plainLanguage, /even if .*usable decision/i);
    assert.match(display.plainLanguage, /not treated as PASS/);
  });
}

test('N1 real Seatbelt reads and temporary writes agree with report disclosures', async t => {
  if (process.platform !== 'darwin') { t.skip('Seatbelt is Darwin-only'); return; }
  const workDir = createRunWorkdir('disclosure');
  t.after(() => cleanupWorkdir(workDir));
  const isolation = resolveIsolation(workDir);
  if (!isolation.verified || isolation.mode !== 'sandbox_exec') {
    t.skip(`Seatbelt unavailable: ${isolation.probe_reason}`); return;
  }
  // Owned canaries only: never inspect real credentials or unrelated user data.
  const homeDir = mkdtempSync(path.join(os.homedir(), '.raven-disclosure-canary-'));
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'raven-disclosure-canary-'));
  t.after(() => rmSync(homeDir, {recursive:true, force:true}));
  t.after(() => rmSync(tempDir, {recursive:true, force:true}));
  const input = {read:path.join(homeDir,'read.txt'), homeWrite:path.join(homeDir,'write.txt'),
    tempWrite:path.join(tempDir,'write.txt')};
  writeFileSync(input.read, 'owned-disclosure-canary');
  const entryAbs = path.join(workDir,'canary.mjs');
  writeFileSync(entryAbs, `import {readFileSync,writeFileSync} from 'node:fs';
const input=JSON.parse(readFileSync(0,'utf8'));
const attempt=fn=>{try{return fn();}catch{return false;}};
console.log(JSON.stringify({decision:'ACCEPT',
 read:attempt(()=>readFileSync(input.read,'utf8')==='owned-disclosure-canary'),
 homeWrite:attempt(()=>{writeFileSync(input.homeWrite,'owned');return true;}),
 tempWrite:attempt(()=>{writeFileSync(input.tempWrite,'owned');return true;})}));`);
  const positive = spawnSync(process.execPath, [entryAbs], {input:JSON.stringify(input), encoding:'utf8', timeout:3000});
  assert.equal(positive.status, 0, positive.stderr);
  assert.deepEqual(JSON.parse(positive.stdout), {decision:'ACCEPT', read:true, homeWrite:true, tempWrite:true});
  rmSync(input.homeWrite); rmSync(input.tempWrite);
  const sandboxed = await spawnIsolated({entryAbs, inputObj:input, workDir, isolation});
  assert.equal(sandboxed.exitCode, 0, sandboxed.stderr);
  assert.deepEqual(sandboxed.observed, {decision:'ACCEPT', read:true, homeWrite:false, tempWrite:true});
  t.diagnostic('Positive control: home read/write and separate temp write succeed. Seatbelt: home read and separate temp write succeed; home write denied.');
  const report = await runConformance('CONFORMANT_REFERENCE', {write:false});
  assert.equal(report.summary.pass, 10);
  assert.equal(report.isolation.mode, 'sandbox_exec');
  for (const [field, text] of [['allowed_resources.filesystem', report.allowed_resources.filesystem], ['isolation.details', report.isolation.details]]) {
    await t.test(field, () => {
      assert.match(text, /broad file reads/i);
      for (const resource of ['workdir', '/dev', '/private/tmp', '/tmp', '/private/var/folders']) assert.ok(text.includes(resource), resource);
      assert.match(text, /app.*denied/i);
      assert.doesNotMatch(text, /write only|write confined to ephemeral workdir/i);
    });
  }
  await t.test('verified_controls', () => assert.ok(!report.isolation.verified_controls.includes('deny_write_outside_workdir')));
});
