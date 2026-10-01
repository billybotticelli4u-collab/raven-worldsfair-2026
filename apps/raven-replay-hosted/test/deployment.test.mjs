import test from 'node:test';import assert from 'node:assert/strict';
import run from '../api/run.mjs';import transaction from '../api/transaction.mjs';
import {fromEnvironment} from '../src/deployment.mjs';
test('public entrypoints and empty environment stay closed without credentials or budget',async()=>{
 for(const handle of [run.fetch,transaction.fetch,fromEnvironment({})]){
 const response=await handle(new Request('https://example.com/api/run',{method:'POST',body:'{}'}));
 assert.equal(response.status,503);assert.deepEqual(await response.json(),{ok:false,error:'HOST_NOT_CONFIGURED'});
 }
});
