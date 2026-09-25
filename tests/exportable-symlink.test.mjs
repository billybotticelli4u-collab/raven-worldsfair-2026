import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const checker=fileURLToPath(new URL('../scripts/check-exportable-cleanliness.mjs',import.meta.url));
for (const kind of ['absolute-existing','absolute-missing','relative-existing']) {
  test('cleanliness refuses '+kind+' symlink without following it',()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'raven-symlink-control-'));
    try {
      const scan=path.join(root,'scan');fs.mkdirSync(scan);
      const target=path.join(root,'target.json');
      if(kind!=='absolute-missing')fs.writeFileSync(target,'{"clean":true}\n');
      fs.symlinkSync(kind==='relative-existing'?'../target.json':target,path.join(scan,'link.json'));
      const result=spawnSync(process.execPath,[checker,scan],{encoding:'utf8'});
      assert.equal(result.status,3,result.stdout+result.stderr);
      assert.match(result.stderr,/SYMLINK_REFUSE/);
      if(kind!=='absolute-missing')assert.equal(fs.readFileSync(target,'utf8'),'{"clean":true}\n');
    }finally{fs.rmSync(root,{recursive:true,force:true});}
  });
}
