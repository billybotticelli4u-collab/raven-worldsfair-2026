import {randomUUID} from 'node:crypto';
import {IntakeError} from './intake.mjs';
// All regions must use one writable Redis database and the same stable namespace.
// Counters use Redis time, not caller/instance time; failed attempts are not refunded.
export const ACQUIRE_LUA = `
local tm=redis.call('TIME')
local now=tonumber(tm[1])*1000+math.floor(tonumber(tm[2])/1000)
local minute=tonumber(ARGV[1])
local day=tonumber(ARGV[2])
redis.call('ZREMRANGEBYSCORE',KEYS[1],'-inf',now-60000)
redis.call('ZREMRANGEBYSCORE',KEYS[2],'-inf',now-86400000)
if redis.call('ZCARD',KEYS[1])>=minute or redis.call('ZCARD',KEYS[2])>=day then return 0 end
redis.call('ZADD',KEYS[1],now,ARGV[3])
redis.call('ZADD',KEYS[2],now,ARGV[3])
redis.call('PEXPIRE',KEYS[1],61000)
redis.call('PEXPIRE',KEYS[2],86401000)
return 1
`;
const unavailable=()=>{throw new IntakeError('HOST_NOT_CONFIGURED');};
export function createSharedBudget({url,token,namespace,runPerMinute,runPerDay,fetchPerMinute,fetchPerDay,fetchFn=fetch}={}){
 let configured=false;
 try{const u=new URL(url);configured=u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&u.pathname==='/'&&!u.search&&!u.hash&&/^[a-z0-9-]+\.upstash\.io$/.test(u.hostname)&&typeof token==='string'&&token.length>=16&&/^[a-zA-Z0-9_-]{1,64}$/.test(namespace)&&[runPerMinute,runPerDay,fetchPerMinute,fetchPerDay].every(n=>Number.isSafeInteger(n)&&n>0&&n<=10000)&&runPerMinute<=runPerDay&&fetchPerMinute<=fetchPerDay;}catch{}
 return async({path})=>{
  if(!configured||!['/api/run','/api/transaction'].includes(path))return unavailable();
  const run=path==='/api/run',kind=run?'run':'fetch';
  const key=`raven-replay:{${namespace}}:${kind}`;
  try{
   const response=await fetchFn(url,{method:'POST',redirect:'error',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(['EVAL',ACQUIRE_LUA,2,key+':minute',key+':day',run?runPerMinute:fetchPerMinute,run?runPerDay:fetchPerDay,randomUUID()]),signal:AbortSignal.timeout(3000)});
   if(!response.ok||!response.body)return unavailable();
   const reader=response.body.getReader();let size=0;const chunks=[];
   try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1024)return unavailable();chunks.push(Buffer.from(value));}}finally{void reader.cancel().catch(()=>{});}
   const value=JSON.parse(Buffer.concat(chunks));
   if(!value||Object.keys(value).length!==1||!Object.hasOwn(value,'result')||![0,1].includes(value.result))return unavailable();
   return value.result===1;
  }catch{return unavailable();}
 };
}
