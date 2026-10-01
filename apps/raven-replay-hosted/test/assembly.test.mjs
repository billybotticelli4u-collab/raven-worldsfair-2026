import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url);
const sha=b=>createHash('sha256').update(b).digest('hex');
test('assembly preserves all reviewed source except explicitly extended registry',()=>{
 const sourceBytes=readFileSync(new URL('ENGINE-SOURCE.json',root));
 const source=JSON.parse(sourceBytes),assembly=JSON.parse(readFileSync(new URL('ENGINE-ASSEMBLY.json',root)));
 assert.equal(assembly.base_source_manifest_sha256,sha(sourceBytes));
 assert.deepEqual(assembly.changed_base_paths,['adapters/registry.json']);
 assert.equal(assembly.files.length,source.files.length+6);
 assert.equal(new Set(assembly.files.map(f=>f.path)).size,assembly.files.length);
 for(const file of source.files){
   assert.ok(assembly.files.some(f=>f.path===file.path));
   if(file.path!=='adapters/registry.json')assert.equal(sha(readFileSync(new URL('engine/'+file.path,root))),file.sha256,file.path);
 }
 for(const file of assembly.files)assert.equal(sha(readFileSync(new URL('engine/'+file.path,root))),file.sha256,file.path);
 for(const [v,hash] of [['3.0.3','1fd6f9ea75f16a9868714a4f645d60bd76c8e0f2af44660654658c14f960c293'],['4.0.0','53d0580133f656b67a8534a1218fafc0f0e509f867c6500eaf2b4c63b64c0930']]) assert.equal(sha(readFileSync(new URL(`engine/adapters/kit-${v}-tx-decode/bundle.mjs`,root))),hash);
});
