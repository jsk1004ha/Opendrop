/* No app-shell caching: deployments always load current HTML/JS. */
importScripts('./transfer.js?v=030');
const T=OpenDropTransfer;
const jobs=new Map();
const DB='opendrop-transfers-v1';
function database(){return new Promise((resolve,reject)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>r.result.createObjectStore('jobs',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function store(action,value){const db=await database();try{return await new Promise((resolve,reject)=>{const tx=db.transaction('jobs',action==='get'?'readonly':'readwrite'),s=tx.objectStore('jobs');const r=action==='get'?s.get(value):action==='delete'?s.delete(value):s.put(value);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}finally{db.close();}}
self.addEventListener('install',e=>{self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(self.clients.claim());});
self.addEventListener('message',e=>{
 if(e.data?.type!=='register-transfer'||!e.ports[0])return;
 e.waitUntil((async()=>{try{const client=await self.clients.get(e.source.id);if(!client||new URL(client.url).origin!==self.location.origin)throw Error('Invalid client');const j=e.data.job;if(!/^[a-z0-9-]{16,80}$/i.test(j.id)||!Array.isArray(j.manifests)||!j.manifests.length||j.manifests.length>100)throw Error('Invalid transfer');
 for(const m of j.manifests){if(!m._token||!m.file||!Array.isArray(m.parts))throw Error('Invalid manifest');for(const p of m.parts){const u=new URL(p.url);if(u.protocol!=='https:'||!['jxsbgblbmkfnzgtnaata.supabase.co','jxsbgblbmkfnzgtnaata.storage.supabase.co'].includes(u.hostname))throw Error('Invalid storage host');}}
 if(j.logMode){if(!['single','zip'].includes(j.logMode)||!/^[0-9a-f-]{36}$/i.test(j.eventId||''))throw Error('Invalid log event');}j.expires=Date.now()+3600000;j.clientId=client.id;jobs.set(j.id,j);await store('put',j).catch(()=>{});e.ports[0].postMessage({ok:true});
 }catch(err){e.ports[0].postMessage({ok:false,error:String(err)});}})());
});
async function writeDownloadLog(j){
 if(!j.logMode||!j.eventId)return;
 const payload={eventId:j.eventId,mode:j.logMode,files:j.manifests.map(m=>({id:m.file.id,token:m._token}))};
 const client=await self.clients.get(j.clientId);
 try{const r=await fetch(API+'/log-download',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'log HTTP '+r.status);client?.postMessage({type:'download-log-updated'});}
 catch(err){client?.postMessage({type:'download-log-error',message:String(err.message||err)});}
}
async function handle(req,id){const j=jobs.get(id)||await store('get',id).catch(()=>null);if(!j||j.expires<Date.now()){jobs.delete(id);store('delete',id).catch(()=>{});return new Response('파일을 다시 열어 다운로드해 주세요.',{status:410,headers:{'Content-Type':'text/plain; charset=utf-8'}});}jobs.set(id,j);
 const m=j.manifests[0],size=j.zip?T.zipSize(j.manifests):Number(m.file.size),r=j.zip?null:req.headers.get('range'),selected=T.range(r,size);
 if(!selected)return new Response(null,{status:416,headers:{'Content-Range':'bytes */'+size}});
 const [start,end]=selected;const h=new Headers({'Content-Type':j.zip?'application/zip':j.inline?(j.mime||'application/octet-stream'):'application/octet-stream','Content-Disposition':T.disposition(j.name,!!j.inline),'Content-Length':String(end-start+1),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Accept-Ranges':j.zip?'none':'bytes'});
 if(r)h.set('Content-Range','bytes '+start+'-'+end+'/'+size);
 if(req.method==='HEAD')return new Response(null,{status:r?206:200,headers:h});
 const iterator=j.zip?T.zipBytes(j.manifests):T.fileBytes(m,start,end);
 const tracked=(async function*(){let complete=false;try{for await(const chunk of iterator)yield chunk;complete=true;}finally{if(complete&&!j.inline&&!r)await writeDownloadLog(j);}})();
 const body=T.stream(tracked,async err=>{const client=await self.clients.get(j.clientId);client?.postMessage({type:'transfer-error',message:String(err.message||err)});});
 return new Response(body,{status:r?206:200,headers:h});
}
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(u.origin!==self.location.origin||!u.pathname.startsWith('/__transfer/'))return;e.respondWith(handle(e.request,u.pathname.split('/')[2]).catch(()=>new Response('전송 정보를 다시 준비해 주세요.',{status:503})));});
