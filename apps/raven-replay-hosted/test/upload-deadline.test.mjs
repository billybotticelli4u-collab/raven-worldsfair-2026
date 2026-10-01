import test from 'node:test';import assert from 'node:assert/strict';
import {createApi} from '../src/api.mjs';
const origin='https://replay.example.com';
function request(body){return new Request(origin+'/api/run',{method:'POST',headers:{origin,'content-type':'application/json'},body,duplex:'half'});}
test('stalled body refuses within six seconds without spending or executing',async()=>{
 let controller,cancelled=false,calls=0;
 const stream=new ReadableStream({start(c){controller=c;},cancel(){cancelled=true;return new Promise(()=>{});}});
 const handler=createApi({origin,acquirePermit:async()=>{calls++;return true;},runIsolatedFn:async()=>{calls++;}});
 let timer;const started=Date.now();let result;
 try{result=await Promise.race([handler(request(stream)),new Promise(resolve=>{timer=setTimeout(()=>resolve(null),6000)})]);assert(result,'request still pending past deadline');assert.equal(result.status,408);assert.equal((await result.json()).error,'REQUEST_TIMEOUT');assert(Date.now()-started<6000);assert.equal(cancelled,true);assert.equal(calls,0);}finally{clearTimeout(timer);if(!cancelled)controller.close();}
});
test('valid upload remains accepted, malformed and oversized remain refused',async()=>{
 let calls=0;const handler=createApi({origin,acquirePermit:async()=>true,runIsolatedFn:async()=>{calls++;return {ok:true,data:{status:'CREATED'}};}});
 const body={op:'create',name:'x',input_base64:'AA==',adapter_id:'solana-kit-tx-decode',intake:null,intake_reference:null};
 assert.equal((await handler(request(JSON.stringify(body)))).status,200);assert.equal(calls,1);
 assert.equal((await handler(request('{'))).status,400);assert.equal((await handler(request('x'.repeat(320*1024+1)))).status,413);assert.equal(calls,1);
});
