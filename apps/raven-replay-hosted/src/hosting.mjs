// Public-host adapter. Local development keeps its separate, explicitly local budget.
import {Snapshot} from '@vercel/sandbox';
import {createApi,securityHeaders} from './api.mjs';
import {runIsolated} from './sandbox.mjs';
const unavailable=()=>Response.json({ok:false,error:'HOST_NOT_CONFIGURED'},{status:503,headers:securityHeaders});
function validConfig(config){
 try {
  const url=new URL(config.origin);
  return url.protocol==='https:' && !url.username && !url.password && !url.port && url.origin===config.origin && /^snap_[A-Za-z0-9_-]+$/.test(config.snapshotId) && /^[a-f0-9]{64}$/.test(config.enginePinSha256);
 }catch{return false;}
}
export function createHostedApi({config,acquirePermit,now=Date.now,readSnapshot=opts=>Snapshot.get(opts),execute=runIsolated,fetchTransactionFn}={}){
 if(!validConfig(config)||typeof acquirePermit!=='function')return async()=>unavailable();
 return createApi({origin:config.origin,fetchTransactionFn,
  acquirePermit:async context=>{
   if(context.path==='/api/run'){
    try{
     const snapshot=await readSnapshot({snapshotId:config.snapshotId,signal:AbortSignal.timeout(5000)});
     const expiry=snapshot?.expiresAt;
     // Undefined is the provider's explicit non-expiring snapshot representation.
     if(!snapshot||snapshot.snapshotId!==config.snapshotId||snapshot.status!=='created'||(expiry!==undefined&&(!(expiry instanceof Date)||!Number.isFinite(expiry.getTime())||expiry.getTime()-now()<120000)))throw Error();
    }catch{throw Object.assign(Error(),{code:'HOST_NOT_CONFIGURED'});}
   }
   return acquirePermit(context);
  },
  runIsolatedFn:request=>execute(request,{snapshotId:config.snapshotId,enginePinSha256:config.enginePinSha256}),
 });
}
