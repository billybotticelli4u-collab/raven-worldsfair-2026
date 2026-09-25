import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
for(const entry of ['direct','launcher'])test('cleanup bypass refused before listen: '+entry,()=>{
 const args=entry==='direct'?[path.join(root,'src/cases-server.mjs')]:[path.join(root,'bin/raven-replay'),'--node',process.execPath,'--port','19890'];
 const r=spawnSync(entry==='direct'?process.execPath:'/bin/bash',args,{cwd:root,env:{...process.env,RAVEN_TEST_DISABLE_CLEANUP:'1',RAVEN_REPLAY_PORT:'19890'},encoding:'utf8',timeout:5000});
 assert.equal(r.status,2,r.stdout+r.stderr);assert.match(r.stderr,/refusing startup/);assert.doesNotMatch(r.stdout,/Raven Replay saved cases: http/);
});
