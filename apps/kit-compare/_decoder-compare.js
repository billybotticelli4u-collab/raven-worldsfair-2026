'use strict';
(() => {
  const $ = id => document.getElementById(id);
  function unlockInput(){ $('input-bytes').disabled=false; $('encoding').disabled=false; }
  let cases = {}, report = null, worker = null, timer = null, generation = 0;
  function cancel() { generation++; worker?.terminate(); worker=null; clearTimeout(timer); report=null; $('download').disabled=true; }
  function invalidate(){ cancel(); $('run').disabled=false; $('results').replaceChildren(); $('status').textContent='Input changed. Run again to produce fresh results.'; }
  $('input-bytes').addEventListener('input',invalidate); $('encoding').addEventListener('change',invalidate);
  $('fixture').addEventListener('change',()=>{ $('input-bytes').value=cases[$('fixture').value]; $('encoding').value='hex'; invalidate(); });
  function decodeInput(){
    const text=$('input-bytes').value.replace(/\s/g,'');
    if(!text) throw Error('Enter transaction bytes first.');
    let bytes;
    if($('encoding').value==='hex') { if(!/^(?:[0-9a-fA-F]{2})+$/.test(text)) throw Error('Hex must contain complete byte pairs using 0–9 and A–F.'); bytes=Uint8Array.from(text.match(/../g),x=>parseInt(x,16)); }
    else { if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) throw Error('Use canonical, padded base64.'); const raw=atob(text); if(btoa(raw)!==text) throw Error('Base64 is not canonical.'); bytes=Uint8Array.from(raw,c=>c.charCodeAt(0)); }
    if(bytes.length>4096) throw Error('This browser comparison is limited to 4,096 bytes.');
    return bytes;
  }
  $('run').addEventListener('click',async()=>{
    cancel(); const current=generation; $('results').replaceChildren();
    try {
      const bytes=decodeInput(); $('run').disabled=true; $('status').textContent='Running three real Kit versions locally…';
      const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
      if(current!==generation) return;
      worker=new Worker('_decoder-worker.js');
      const fail=message=>{if(current!==generation)return;cancel();$('run').disabled=false;$('status').textContent=message;};
      timer=setTimeout(()=>fail('Comparison exceeded 8 seconds and was stopped. No report was produced.'),8000);
      worker.onerror=()=>fail('A decoder worker could not load or run. No comparison result was produced. Please retry.');
      worker.onmessage=event=>{
        if(current!==generation)return;clearTimeout(timer);worker.terminate();worker=null;
        report={schema:'raven-browser-kit-comparison/v1',observedAt:new Date().toISOString(),inputHex:Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join(''),inputSha256:hash,byteLength:bytes.length,api:['getTransactionDecoder().decode(bytes)','getCompiledTransactionMessageDecoder().decode(transaction.messageBytes)'],scope:'Local parse comparison only; unsigned; synthetic examples or user-supplied bytes; no signature or safety validation',results:event.data};
        for(const result of report.results){ const row=document.createElement('tr'); for(const value of [`${result.library} ${result.version}`,result.decision,result.decodedVersion===null?'—':String(result.decodedVersion),result.detail]){const cell=document.createElement('td');cell.textContent=value;if(value===result.decision)cell.className=result.decision.toLowerCase();row.append(cell);} $('results').append(row); }
        const distinct=new Set(report.results.map(r=>JSON.stringify([r.decision,r.decodedVersion]))).size;
        $('status').textContent=distinct>1?'Disagreement reproduced. Inspect each library’s decision below.':'All three produced the same decision and version. This is not a safety verdict.';
        $('run').disabled=false; $('download').disabled=false;
      };
      worker.postMessage(bytes.buffer);
    } catch(error){cancel();$('status').textContent=error.message;$('run').disabled=false;}
  });
  $('download').addEventListener('click',()=>{if(!report)return;const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='raven-kit-comparison.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
  fetch('decoder-cases.json').then(r=>{if(!r.ok)throw Error();return r.json();}).then(data=>{cases=data;$('fixture').disabled=false;$('fixture').replaceChildren();for(const name of Object.keys(cases)){const option=document.createElement('option');option.value=name;option.textContent=name.replaceAll('_',' ');$('fixture').append(option);}const initial=Object.keys(cases).find(k=>k.startsWith('E_'));$('fixture').value=initial;$('input-bytes').value=cases[initial];unlockInput();$('run').disabled=false;$('status').textContent='Ready. Run the comparison—results are calculated, not pre-filled.';}).catch(()=>{unlockInput();$('status').textContent='Examples could not load. You can paste your own public bytes and run.';$('run').disabled=false;});
})();
