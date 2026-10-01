import test from 'node:test';
import assert from 'node:assert/strict';
import {createSupabaseBudget} from '../src/supabase-budget.mjs';
const config={url:'https://ptjykejlrbifjbustbuz.supabase.co',token:'test-only-key-not-a-secret'};
test('server RPC accepts only boolean results and fixes request scope',async()=>{
 for(const result of [true,false]){
  let seen;
  const permit=createSupabaseBudget({...config,fetchFn:async(url,options)=>{seen={url,options};return new Response(JSON.stringify(result));}});
  assert.equal(await permit({path:'/api/run'}),result);
  assert.equal(seen.url,config.url+'/rest/v1/rpc/raven_acquire_permit');
  assert.deepEqual(JSON.parse(seen.options.body),{p_kind:'run'});
  assert.equal(seen.options.redirect,'error');
 }
});
test('database errors, wrong shapes and oversized responses refuse',async()=>{
 for(const response of [new Response('true',{status:503}),new Response('{}'),new Response('1'),new Response('null'),new Response('x'.repeat(1025))]){
  await assert.rejects(createSupabaseBudget({...config,fetchFn:async()=>response})({path:'/api/run'}),/HOST_NOT_CONFIGURED/);
 }
 await assert.rejects(createSupabaseBudget({...config,fetchFn:async()=>{throw Error('provider secret');}})({path:'/api/run'}),/HOST_NOT_CONFIGURED/);
});
test('invalid endpoints and unknown operations never contact database',async()=>{
 for(const url of ['http://ptjykejlrbifjbustbuz.supabase.co','https://evil.example','https://ptjykejlrbifjbustbuz.supabase.co/x','https://user@ptjykejlrbifjbustbuz.supabase.co']){
  await assert.rejects(createSupabaseBudget({...config,url,fetchFn:()=>assert.fail('network')})({path:'/api/run'}),/HOST_NOT_CONFIGURED/);
 }
 await assert.rejects(createSupabaseBudget({...config,fetchFn:()=>assert.fail('network')})({path:'/other'}),/HOST_NOT_CONFIGURED/);
});
test('body that never completes is bounded independently of transport',async()=>{
 const permit=createSupabaseBudget({...config,timeoutMs:25,fetchFn:async()=>new Response(new ReadableStream({pull(){return new Promise(()=>{});},cancel(){return new Promise(()=>{});}}))});
 await assert.rejects(permit({path:'/api/transaction'}),/HOST_NOT_CONFIGURED/);
});
