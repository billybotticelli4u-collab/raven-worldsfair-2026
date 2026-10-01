import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {executeRequest} from '../src/worker.mjs';
const fixture=readFileSync(new URL('./fixtures/upgrade.base64',import.meta.url),'utf8').trim();
function baseline(){return executeRequest({op:'create',input_base64:fixture,adapter_id:'kit-3.0.3-tx-decode',name:'Synthetic historical decoder comparison',intake:null,intake_reference:null});}
test('retained historical baseline compares one refusal-reason change without a new baseline',()=>{
 const b=baseline(); const before=JSON.stringify(b);
 const r=executeRequest({op:'compare',envelope:b.envelope,reference:b.reference,candidate_adapter_id:'kit-4.0.0-tx-decode'});
 assert.equal(r.status,'COMPLETE');assert.equal(r.report.comparison_complete,true);assert.equal(r.report.changed,true);
 assert.equal(r.report.baseline.retained_reference,'MATCH');assert.equal(r.report.differences.length,1);
 assert.equal(r.report.baseline.result.decision,'REJECT');assert.equal(r.report.candidate.result.decision,'REJECT');
 assert.equal(JSON.stringify(b),before);
});
test('upgrade refuses wrong retained reference, altered baseline, same decoder and unregistered candidate',()=>{
 const b=baseline();const req={op:'compare',envelope:b.envelope,reference:b.reference,candidate_adapter_id:'kit-4.0.0-tx-decode'};
 assert.throws(()=>executeRequest({...req,reference:'0'.repeat(64)}),{code:'REFERENCE_MISMATCH'});
 const edited=structuredClone(b.envelope);edited.sdk_case.expected_execution.parsed.reason='changed';
 assert.throws(()=>executeRequest({...req,envelope:edited}),{code:'REFERENCE_MISMATCH'});
 assert.throws(()=>executeRequest({...req,candidate_adapter_id:'kit-3.0.3-tx-decode'}),{code:'INVALID_REQUEST'});
 assert.throws(()=>executeRequest({...req,candidate_adapter_id:'control-crash'}),{code:'UNKNOWN_ADAPTER'});
 assert.throws(()=>executeRequest({...req,command:'anything'}),{code:'INVALID_REQUEST'});
});
