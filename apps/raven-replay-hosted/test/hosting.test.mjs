import test from 'node:test';
import assert from 'node:assert/strict';
import {createHostedApi} from '../src/hosting.mjs';
const origin='https://replay.example.com';
const now=Date.parse('2026-10-02T00:00:00Z');
const config={origin,snapshotId:'snap_fixed',enginePinSha256:'a'.repeat(64)};
const body={op:'create',name:'case',input_base64:'AA==',adapter_id:'solana-kit-tx-decode',intake:null,intake_reference:null};
const request=()=>new Request(origin+'/api/run',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
function setup(overrides={}){const calls=[];const handler=createHostedApi({config,now:()=>now,readSnapshot:async()=>({snapshotId:'snap_fixed',status:'created',expiresAt:new Date(now+3600000)}),acquirePermit:async()=>{calls.push('permit');return true;},execute:async()=>{calls.push('execute');return {ok:true,data:{status:'CREATED'}};},...overrides});return {calls,handler};}
test('hosted run checks actual snapshot before permit and execution',async()=>{const {handler,calls}=setup();assert.equal((await handler(request())).status,200);assert.deepEqual(calls,['permit','execute']);});
test('expired, near-expired, missing, unavailable and wrong snapshots cannot start jobs',async()=>{
 for(const snapshot of [null,{snapshotId:'snap_other',status:'created',expiresAt:new Date(now+3600000)},{snapshotId:'snap_fixed',status:'failed',expiresAt:new Date(now+3600000)},{snapshotId:'snap_fixed',status:'created',expiresAt:new Date(now-1)},{snapshotId:'snap_fixed',status:'created',expiresAt:new Date(now+60000)},{snapshotId:'snap_fixed',status:'created',expiresAt:new Date('invalid')}]){
 const {handler,calls}=setup({readSnapshot:async()=>snapshot});const r=await handler(request());assert.equal(r.status,503);assert.deepEqual(calls,[]);assert.equal((await r.json()).error,'HOST_NOT_CONFIGURED');}
 const {handler,calls}=setup({readSnapshot:async()=>{throw Error('provider-secret');}});assert.equal((await handler(request())).status,503);assert.deepEqual(calls,[]);
});
test('missing shared budget and invalid canonical HTTPS origin fail closed',async()=>{
 for(const cfg of [{...config,origin:'http://replay.example.com'}, {...config,origin:origin+'/path'}, {...config,origin:'https://user:secret@replay.example.com'}, {...config,enginePinSha256:'x'}]){const {handler,calls}=setup({config:cfg});assert.equal((await handler(request())).status,503);assert.deepEqual(calls,[]);}
 const {handler,calls}=setup({acquirePermit:undefined});assert.equal((await handler(request())).status,503);assert.deepEqual(calls,[]);
});
test('snapshot refreshed per request; denied budget never executes',async()=>{
 let count=0;const {handler,calls}=setup({readSnapshot:async()=>({snapshotId:'snap_fixed',status:'created',expiresAt:new Date(now+(++count===1?3600000:0))})});assert.equal((await handler(request())).status,200);assert.equal((await handler(request())).status,503);assert.deepEqual(calls,['permit','execute']);
 const denied=setup({acquirePermit:async()=>false});assert.equal((await denied.handler(request())).status,429);assert.deepEqual(denied.calls,[]);
});
