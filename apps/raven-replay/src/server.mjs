import http from 'node:http';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {capture,verify,challenge} from './action.mjs';
const root=new URL('../',import.meta.url);
export function createServer() {
  return http.createServer(async(req,res)=>{
    const origin='http://127.0.0.1:'+req.socket.localPort;
    const send=(status,data,type='application/json')=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store',
      'X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});res.end(type==='application/json'?JSON.stringify(data):data);};
    if(req.headers.host !== '127.0.0.1:'+req.socket.localPort) return send(403,{error:'Loopback host required'});
    const files={'/':['public/index.html','text/html; charset=utf-8'],'/app.js':['public/app.js','text/javascript'],
      '/style.css':['public/style.css','text/css'],'/sample':['examples/legacy-transaction.base64','text/plain']};
    if(req.method==='GET' && Object.hasOwn(files,req.url)) {
      const [file,type]=files[req.url]; return send(200,fs.readFileSync(new URL(file,root)),type);
    }
    if(req.method!=='POST' || !['/capture','/verify','/challenge'].includes(req.url)) return send(404,{error:'Not found'});
    if(req.headers.origin!==origin || req.headers['content-type']!=='application/json') return send(403,{error:'Same-origin JSON request required'});
    try {
      const chunks=[];let size=0;
      for await (const chunk of req) {size+=chunk.length;if(size>128*1024) {send(413,{error:'Request too large'});req.resume();return;}chunks.push(chunk);}
      const payload=JSON.parse(Buffer.concat(chunks).toString());
      if(req.url==='/capture') return send(200,capture(payload.tx,{caller:'local browser user (self-declared)'}));
      if(req.url==='/verify') return send(200,verify(payload.envelope,payload.options));
      const altered=challenge(payload.envelope,payload.kind);
      return send(200,{envelope:altered,verification:verify(altered,payload.options)});
    } catch(e) {send(400,{error:e.message});}
  });
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
  const port=Number(process.env.RAVEN_REPLAY_PORT || 8794);
  const server=createServer();
  server.listen(port,'127.0.0.1',()=>console.log('Raven Replay local prototype: http://127.0.0.1:'+server.address().port));
}
