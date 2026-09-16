import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const root = fileURLToPath(new URL('..', import.meta.url));
async function fixture(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'raven-phase1-test-'));
  for (const name of ['src','targets','profiles','corpus','package.json']) cpSync(path.join(root,name),path.join(dir,name),{recursive:true});
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const runner = await import(pathToFileURL(path.join(dir,'src/lib/runner.js')));
  const manifest = path.join(dir,'targets/manifests.json');
  const data = JSON.parse(readFileSync(manifest));
  return {dir,runner,data,save:()=>writeFileSync(manifest,JSON.stringify(data)), target:code=>writeFileSync(path.join(dir,'targets/CONFORMANT_REFERENCE.mjs'),code)};
}
const correct = 'console.log(JSON.stringify({decision:"ACCEPT",reason:"test"}));';
const seal = r => { delete r.report_content_digest_sha256; r.report_content_digest_sha256 = createHash('sha256').update(JSON.stringify(r,null,2)+'\n').digest('hex'); return r; };
test('F1 mismatched profile is refused before target execution', async t=>{
  const f=await fixture(t); f.data.targets[0].claimed_conformance_profile='some-totally-different-profile/99'; f.save();
  await assert.rejects(f.runner.runConformance('CONFORMANT_REFERENCE',{write:false}),e=>e.code==='PROFILE_MISMATCH');
});
test('F1 explicit profile version must match exactly',async t=>{
  const f=await fixture(t); f.data.targets[0].claimed_conformance_profile_version='99.0.0'; f.save();
  await assert.rejects(f.runner.runConformance('CONFORMANT_REFERENCE',{write:false}),e=>e.code==='PROFILE_MISMATCH');
});
test('F2 fatal exit after valid output is HARNESS_ERROR, excluded from graded denominator',async t=>{
  const f=await fixture(t); f.target(correct+'console.error("fatal internal error");process.exit(3);');
  const r=await f.runner.runConformance('CONFORMANT_REFERENCE',{write:false});
  assert.equal(r.results[0].status,'HARNESS_ERROR'); assert.equal(r.summary.harness_error,10);
  assert.equal(r.summary.pass,0); assert.equal(r.summary.divergence,0); assert.equal(r.summary.graded_count,0); assert.equal(r.summary.overall,'HARNESS_ERROR');
});
for(const [name,code,error] of [ ['timeout','setInterval(()=>{},1000)','TIMEOUT'],['invalid','console.log("not-json")','INVALID_OUTPUT'],['absent','','INVALID_OUTPUT'],['signal','process.kill(process.pid,"SIGTERM")','TARGET_CRASH'] ]) {
  test(`F2 ${name} is an execution error, not divergence`,async t=>{
    const f=await fixture(t); f.target(code); const r=await f.runner.runConformance('CONFORMANT_REFERENCE',{write:false,timeoutMs:200});
    assert.equal(r.summary.harness_error,10); assert.equal(r.results[0].evidence.error_code,error); assert.equal(r.summary.divergence,0);
  });
}
test('F6 stale corpus digest refuses runtime execution',async t=>{
  const f=await fixture(t); const p=path.join(f.dir,'corpus/raven-canonical-envelope-demo-corpus-1.json');
  const c=JSON.parse(readFileSync(p)); c.vectors[6].expected.decision='ACCEPT'; writeFileSync(p,JSON.stringify(c));
  await assert.rejects(f.runner.runConformance('BROKEN_SUBTLE',{write:false}),e=>e.code==='CORPUS_DIGEST_MISMATCH');
});
test('F5 detached descendant creation is denied and leaves no heartbeat',async t=>{
  const f=await fixture(t); const marker=path.join(f.dir,'heartbeat'); const pidfile=path.join(f.dir,'pid');
  // Positive control proves the same child can run and write without runner restrictions.
  const control=spawnSync(process.execPath,['-e',`require('node:fs').writeFileSync(${JSON.stringify(marker)},'control')`]);
  assert.equal(control.status,0); assert.equal(readFileSync(marker,'utf8'),'control'); rmSync(marker);
  f.target(`import {spawn} from 'node:child_process'; import {writeFileSync} from 'node:fs';
const child=spawn(process.execPath,['-e',${JSON.stringify(`setInterval(()=>require('node:fs').appendFileSync(${JSON.stringify(marker)},'tick'),30)`)}],{detached:true,stdio:'ignore'});writeFileSync(${JSON.stringify(pidfile)},String(child.pid));child.unref();setInterval(()=>{},1000);`);
  t.after(()=>{if(existsSync(pidfile)){try{process.kill(-Number(readFileSync(pidfile)),'SIGKILL')}catch{}}});
  const r=await f.runner.runVector(path.join(f.dir,'targets/CONFORMANT_REFERENCE.mjs'),{},250);
  await new Promise(resolve=>setTimeout(resolve,180));
  assert.equal(existsSync(marker),false,'detached heartbeat survived runner'); assert.equal(r.ok,false);
});
test('bounded output is explicitly truncated and cannot be graded',async t=>{
  const f=await fixture(t); f.target(`process.stdout.write('x'.repeat(2*1024*1024));${correct}`);
  const r=await f.runner.runConformance('CONFORMANT_REFERENCE',{write:false});
  assert.equal(r.results[0].status,'HARNESS_ERROR'); assert.equal(r.results[0].evidence.output_truncated,true);
  assert.ok(Buffer.byteLength(r.results[0].evidence.stdout)<=65536); assert.equal(r.results[0].evidence.error_code,'OUTPUT_LIMIT');
});
test('resource disclosure does not claim network denial',async t=>{
  const f=await fixture(t); const r=await f.runner.runConformance('CONFORMANT_REFERENCE',{write:false});
  assert.equal(r.allowed_resources.network,'not_restricted');
  assert.match(r.allowed_resources.filesystem,/Node permission/);
});
test('summary exposes vector identity when counts match',async t=>{
  const f=await fixture(t); const subtle=await f.runner.runConformance('BROKEN_SUBTLE',{write:false});
  f.target('console.log(JSON.stringify({decision:"REJECT"}))'); const reject=await f.runner.runConformance('CONFORMANT_REFERENCE',{write:false});
  assert.equal(subtle.summary.divergence,reject.summary.divergence);
  assert.deepEqual(subtle.summary.divergent_vector_ids,['V07_unexpected_top_level_field','V08_unexpected_extension_key']);
  assert.notDeepEqual(subtle.summary.divergent_vector_ids,reject.summary.divergent_vector_ids);
});
test('F4 independent verify CLI accepts genuine report and rejects tampering and self-resealed lies',async t=>{
  const f=await fixture(t); const report=await f.runner.runConformance('BROKEN_SUBTLE',{write:false});
  const p=path.join(f.dir,'report.json');
  const verify=r=>{writeFileSync(p,JSON.stringify(r));return spawnSync(process.execPath,[path.join(f.dir,'src/verify.js'),p],{encoding:'utf8'});};
  assert.equal(verify(report).status,0,'genuine report must verify');
  const changed=structuredClone(report); changed.summary.overall='CONFORMANT'; assert.notEqual(verify(changed).status,0);
  assert.notEqual(verify(seal(changed)).status,0,'self-hash must not authorize an inconsistent verdict');
  const missing=structuredClone(report); missing.results=[]; assert.notEqual(verify(seal(missing)).status,0);
  const expectation=structuredClone(report); expectation.results[0].expected.decision='REJECT'; assert.notEqual(verify(seal(expectation)).status,0);
  const corpus=structuredClone(report); corpus.corpus.declared_content_digest_sha256='0'.repeat(64); assert.notEqual(verify(seal(corpus)).status,0);
});
test('compatibility: four concurrent reports retain exact results and unique identities',async t=>{
  const f=await fixture(t);
  const reports=await Promise.all(Array.from({length:4},()=>f.runner.runConformance('CONFORMANT_REFERENCE')));
  assert.equal(new Set(reports.map(r=>r.run_id)).size,4);
  for(const r of reports){assert.equal(r.summary.pass,10);assert.equal(r.summary.divergence,0);assert.ok(existsSync(r._written_path));}
  const obvious=await f.runner.runConformance('BROKEN_OBVIOUS',{write:false});
  assert.equal(obvious.summary.pass,2);assert.equal(obvious.summary.divergence,8);
});
test('compatibility: SIGINT leaves no partial report',async t=>{
  const f=await fixture(t);f.target('setTimeout(()=>console.log(JSON.stringify({decision:"ACCEPT"})),2000)');
  const {spawn}=await import('node:child_process');
  const child=spawn(process.execPath,[path.join(f.dir,'src/cli.js'),'--target','CONFORMANT_REFERENCE'],{stdio:'ignore'});
  const closed=new Promise(resolve=>child.on('close',(code,signal)=>resolve({code,signal})));
  await new Promise(resolve=>setTimeout(resolve,250));child.kill('SIGINT');const result=await closed;
  assert.ok(result.code===130||result.signal==='SIGINT');assert.equal(existsSync(path.join(f.dir,'reports')),false);
});
