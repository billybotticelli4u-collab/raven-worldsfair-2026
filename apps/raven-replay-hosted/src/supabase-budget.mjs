import {IntakeError} from './intake.mjs';
const unavailable=()=>{throw new IntakeError('HOST_NOT_CONFIGURED');};
// Server-only secret key. No caller-supplied limits, clock or namespace.
export function createSupabaseBudget({url,token,fetchFn=fetch,timeoutMs=3000}={}){
 let endpoint;
 try{const u=new URL(url);if(u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&u.pathname==='/'&&!u.search&&!u.hash&&/^[a-z]{20}\.supabase\.co$/.test(u.hostname)&&typeof token==='string'&&token.length>=16)endpoint=u.origin+'/rest/v1/rpc/raven_acquire_permit';}catch{}
 return async({path})=>{
  if(!endpoint||!['/api/run','/api/transaction'].includes(path))return unavailable();
  const controller=new AbortController();let timer,reader;
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('deadline'));},timeoutMs);});
  try{
   const response=await Promise.race([deadline,fetchFn(endpoint,{method:'POST',redirect:'error',headers:{apikey:token,...(token.startsWith('eyJ')?{authorization:'Bearer '+token}:{}),'content-type':'application/json'},body:JSON.stringify({p_kind:path==='/api/run'?'run':'fetch'}),signal:controller.signal})]);
   if(!response.ok||!response.body)return unavailable();
   reader=response.body.getReader();let size=0;const chunks=[];
   while(true){const {done,value}=await Promise.race([deadline,reader.read()]);if(done)break;size+=value.byteLength;if(size>1024)return unavailable();chunks.push(Buffer.from(value));}
   const value=JSON.parse(Buffer.concat(chunks));if(typeof value!=='boolean')return unavailable();return value;
  }catch{return unavailable();}
  finally{clearTimeout(timer);controller.abort();if(reader)void reader.cancel().catch(()=>{});}
 };
}
