import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,cpSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {classifyResult,runConformance,computeDeterministicDigest} from '../src/lib/runner.js';
import {compareSemantic,replayReport,checkBundleIdentities} from '../src/lib/replay.js';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('..',import.meta.url));
async function fixture(t){
 const dir=mkdtempSync(path.join(os.tmpdir(),'raven-c2-fix-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 for(const n of ['src','targets','profiles','corpus','package.json'])cpSync(path.join(root,n),path.join(dir,n),{recursive:true});
 const runner=await import(pathToFileURL(path.join(dir,'src/lib/runner.js')));
 return {dir,runner};
}
for(const exec of [{exitCode:17,signal:null},{exitCode:null,signal:'SIGTERM'}])test(`review B2 valid output cannot conceal ${JSON.stringify(exec)}`,()=>{
 assert.equal(classifyResult({...exec,observed:{decision:'ACCEPT'},parseError:null,timedOut:false,flooded:false},'ACCEPT').status,'TARGET_CRASH');
});
test('review B2 full correct target that exits 17 cannot become CONFORMANT',async t=>{
 const f=await fixture(t);const target=path.join(f.dir,'targets/CONFORMANT_REFERENCE.mjs');
 writeFileSync(target,readFileSync(target,'utf8')+'\nprocess.exitCode=17;\n');
 const r=await f.runner.runConformance('CONFORMANT_REFERENCE',{write:false});
 assert.equal(r.summary.pass,0);assert.equal(r.summary.counts.TARGET_CRASH,10);assert.equal(r.summary.behavioral_divergence,0);assert.notEqual(r.summary.overall,'CONFORMANT');
});
for(const [field,value] of [['claimed_conformance_profile','different/99'],['claimed_conformance_profile_version','99.0.0'],['claimed_conformance_profile_version',null]])test(`review B1 refuses ${field}=${value}`,async t=>{
 const f=await fixture(t);const p=path.join(f.dir,'targets/manifests.json');const m=JSON.parse(readFileSync(p));m.targets[0][field]=value;writeFileSync(p,JSON.stringify(m));
 await assert.rejects(f.runner.runConformance('CONFORMANT_REFERENCE',{write:false}),e=>e.code==='PROFILE_MISMATCH');
});
test('review B5 rejects stale corpus expectation digest before running',async t=>{
 const f=await fixture(t);const p=path.join(f.dir,'corpus/raven-canonical-envelope-demo-corpus-1.json');const c=JSON.parse(readFileSync(p));c.vectors[6].expected.decision='ACCEPT';writeFileSync(p,JSON.stringify(c));
 await assert.rejects(f.runner.runConformance('BROKEN_SUBTLE',{write:false}),e=>e.code==='CORPUS_DIGEST_MISMATCH');
});
const sample=()=>({summary:{overall:'DIVERGENT',counts:{PASS:1,BEHAVIORAL_DIVERGENCE:1},test_count:2,pass:1,divergence:1},results:[{vector_id:'good',status:'PASS',expected:{decision:'ACCEPT'},observed:{decision:'ACCEPT',reason:'valid'}},{vector_id:'bad',status:'BEHAVIORAL_DIVERGENCE',expected:{decision:'REJECT'},observed:{decision:'ACCEPT',reason:'extra'}}]});
for(const [label,mutate] of [
 ['expected',r=>r.results[0].expected.decision='REJECT'],
 ['empty',r=>r.results=[]],
 ['selective suppression',r=>r.results=r.results.filter(v=>v.status==='PASS')],
 ['duplicate',r=>r.results[1]=structuredClone(r.results[0])],
 ['summary',r=>r.summary.pass=100],
 ['reason',r=>r.results[0].observed.reason='invented'],
])test(`review B3 semantic comparison refuses ${label}`,()=>{
 const honest=sample(),altered=structuredClone(honest);assert.equal(compareSemantic(honest,structuredClone(honest)).ok,true);mutate(altered);assert.equal(compareSemantic(altered,honest).ok,false);
});
test('review B3 stored digest recomputes and all tampering is rejected before replay',async t=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'raven-c2-report-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'report.json');
 const honest=await runConformance('BROKEN_SUBTLE',{write:false});
 assert.equal(computeDeterministicDigest(honest),honest.deterministic_report_sha256);
 writeFileSync(file,JSON.stringify(honest));assert.equal((await replayReport(file)).ok,true);
 for(const mutate of [r=>r.results[0].expected.decision='REJECT',r=>r.results=[],r=>r.results=r.results.filter(x=>x.status==='PASS'),r=>r.deterministic_report_sha256='0'.repeat(64),r=>r.results[0].evidence.stdout+='forged']){
  const r=structuredClone(honest);mutate(r);writeFileSync(file,JSON.stringify(r));const checked=await replayReport(file);assert.equal(checked.ok,false);assert.equal(checked.error,'report_integrity_mismatch');
 }
});
test('review B3 identities cannot disappear to bypass checking',async()=>{
 const r=await runConformance('CONFORMANT_REFERENCE',{write:false});delete r.binding;delete r.claimed_profile.sha256;delete r.corpus.sha256;delete r.target.entry_sha256;
 assert.equal(checkBundleIdentities(r).ok,false);
});
test('review B3 resealing a suppressed report cannot make live replay succeed',async t=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'raven-c2-reseal-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'report.json');
 const r=await runConformance('BROKEN_SUBTLE',{write:false});r.results=r.results.filter(x=>x.status==='PASS');
 // Test attacker controls BOTH digest fields; this is not an authenticity assertion.
 delete r.binding.deterministic_report_sha256;r.deterministic_report_sha256=computeDeterministicDigest(r);r.binding.deterministic_report_sha256=r.deterministic_report_sha256;
 const {_written_path,report_content_digest_sha256,deterministic_report_sha256,...body}=r;
 r.report_content_digest_sha256=createHash('sha256').update(JSON.stringify(body,null,2)+'\n').digest('hex');
 writeFileSync(file,JSON.stringify(r));assert.equal((await replayReport(file)).ok,false);
});
test('review crash probe really emits valid output before failure',async()=>{
 const {runProbe}=await import('../src/lib/runner.js');const r=await runProbe('HOSTILE_EXIT_CRASH',{write:false});
 assert.equal(JSON.parse(r.evidence.stdout.trim()).decision,'ACCEPT');assert.equal(r.status,'TARGET_CRASH');
});
