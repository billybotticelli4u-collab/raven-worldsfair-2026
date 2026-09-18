import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {canonicalJson,sha256Hex} from '../src/lib/canonical.js';

const app=fileURLToPath(new URL('../',import.meta.url));
const target=path.join(app,'targets/CONFORMANT_REFERENCE.mjs');
const corpus=JSON.parse(readFileSync(path.join(app,'corpus/raven-canonical-envelope-demo-corpus-1.json')));
const payload=JSON.parse('{"__proto__":1}');
const run=digest=>JSON.parse(spawnSync(process.execPath,[target],{
 input:JSON.stringify({schema:'raven-canonical-envelope/1',id:'proto',payload,digest}),
 encoding:'utf8',
}).stdout);

test('Challenge 2 /1 helper and reference target preserve own __proto__',()=>{
 assert.equal(canonicalJson(payload),'{"__proto__":1}');
 assert.equal(run(sha256Hex('{"__proto__":1}')).decision,'ACCEPT');
 assert.equal(run(sha256Hex('{}')).decision,'REJECT');
});

test('Challenge 2 corpus contains the paired __proto__ vectors',()=>{
 assert.deepEqual(corpus.vectors.slice(-2).map(vector=>[vector.id,vector.expected.decision]),[
  ['V11_proto_digest_includes_member','ACCEPT'],
  ['V12_proto_digest_omits_member','REJECT'],
 ]);
});
