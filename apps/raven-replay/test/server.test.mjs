import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {createServer} from '../src/server.mjs';
const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
after(()=>new Promise(r=>server.close(r)));
const base='http://127.0.0.1:'+server.address().port;
const tx=fs.readFileSync(new URL('../examples/legacy-transaction.base64',import.meta.url),'utf8').trim();
const post=(route,body,origin=base)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(body)});
test('HTTP capture, replay and challenge execute actual engine; original remains replayable',async()=>{
  const response=await post('/capture',{tx});assert.equal(response.status,200);const c=await response.json();
  const options={expectedBodySha:c.reference.body_sha256,trustedSignerFingerprint:c.reference.signer_fingerprint};
  assert.equal((await(await post('/verify',{envelope:c.envelope,options})).json()).replay,'MATCH');
  const attack=await(await post('/challenge',{envelope:c.envelope,options,kind:'resigned-output'})).json();
  assert.equal(attack.verification.reference,'MISMATCH');
  assert.equal((await(await post('/verify',{envelope:c.envelope,options})).json()).replay,'MATCH');
});
test('foreign origins and missing origin cannot invoke local capture',async()=>{
  assert.equal((await post('/capture',{tx},'https://unrelated.invalid')).status,403);
  assert.equal((await fetch(base+'/capture',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tx})})).status,403);
});
test('unapproved host refused; source and filesystem paths not served',async()=>{
  const status=await new Promise((resolve,reject)=>{const r=http.get(base,{headers:{Host:'unrelated.invalid'}},res=>{res.resume();resolve(res.statusCode);});r.on('error',reject);});
  assert.equal(status,403);
  assert.equal((await fetch(base+'/src/action.mjs')).status,404);
  assert.equal((await fetch(base+'/../package.json')).status,404);
});
test('bad requests cannot issue successful capture; oversized bounded',async()=>{
  assert.equal((await post('/capture',{tx:'bad'})).status,400);
  assert.equal((await post('/capture',{tx:'a'.repeat(130*1024)})).status,413);
});
