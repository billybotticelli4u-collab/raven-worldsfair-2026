import fs from 'node:fs';
import { capture,verify,parseEnvelope } from './action.mjs';
const [command,input,output,arg1,arg2] = process.argv.slice(2);
try {
  if(command === 'capture') {
    if(!input || !output) throw new Error('Usage: node src/cli.mjs capture transaction.base64 evidence.json');
    const text=fs.readFileSync(input,'utf8');
    if(text.length>24000) throw new Error('Transaction file too large');
    const result=capture(text.trim(),{caller:'agent-invoked-cli (self-declared)'});
    fs.writeFileSync(output,JSON.stringify(result.envelope,null,2)+'\n',{flag:'wx',mode:0o600});
    console.log(JSON.stringify({output,reference:result.reference,execution_complete:result.envelope.body.execution.complete,
      tool_result:result.envelope.body.execution.parsed,note:result.note},null,2));
    process.exitCode=result.envelope.body.execution.complete?0:1;
  } else if(command === 'verify') {
    if(!input) throw new Error('Usage: node src/cli.mjs verify evidence.json [expected-body-sha] [trusted-signer-fingerprint]');
    if(fs.statSync(input).size>128*1024) throw new Error('Evidence file too large');
    const result=verify(parseEnvelope(fs.readFileSync(input,'utf8')),{expectedBodySha:output,trustedSignerFingerprint:arg1});
    console.log(JSON.stringify(result,null,2));
    process.exitCode=result.replay === 'MATCH' && !result.reasons.length?0:1;
  } else throw new Error('Expected capture or verify');
} catch(e) { console.error(e.message); process.exitCode=1; }
