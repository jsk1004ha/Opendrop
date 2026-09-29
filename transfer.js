/* OpenDrop transfer engine. Shared by the page and its service worker. */
(function(root){
'use strict';
const API='https://jxsbgblbmkfnzgtnaata.supabase.co/functions/v1/opendrop-api';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const table=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;table[n]=c>>>0;}
function crc32(data,crc=0xffffffff){for(let i=0;i<data.length;i++)crc=table[(crc^data[i])&255]^(crc>>>8);return crc>>>0;}
function range(value,size){if(!value)return[0,size-1];const m=/^bytes=(\d*)-(\d*)$/.exec(value);if(!m||(!m[1]&&!m[2]))return null;let a,b;if(!m[1]){const n=Number(m[2]);if(!n)return null;a=Math.max(0,size-n);b=size-1;}else{a=Number(m[1]);b=m[2]?Math.min(Number(m[2]),size-1):size-1;}return Number.isSafeInteger(a)&&Number.isSafeInteger(b)&&a>=0&&a<size&&b>=a?[a,b]:null;}
function filename(s){return String(s||'file').replace(/[\u0000-\u001f\u007f/\\]/g,'_').replace(/^\.+/,'_').trim().slice(0,240)||'file';}
function disposition(name,inline=false){const n=filename(name),ascii=n.replace(/[^\x20-\x7e]|["\\]/g,'_');return(inline?'inline':'attachment')+'; filename="'+ascii+'"; filename*=UTF-8\'\''+encodeURIComponent(n).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16));}
async function response(m,p,start,end,proxy){const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),45000);const url=proxy?API+'/read-part?file='+encodeURIComponent(m.file.id)+'&index='+p.index:p.url;try{const r=await fetch(url,{credentials:'omit',cache:'no-store',headers:{Range:'bytes='+start+'-'+end,...(proxy?{'x-opendrop-token':m._token}:{})},signal:controller.signal});if(!r.ok||!r.body){await r.body?.cancel();throw new Error('파일 전송 실패 (HTTP '+r.status+')');}return r;}finally{clearTimeout(timer);}}
async function readWithTimeout(reader){let timer;try{return await Promise.race([reader.read(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('다운로드 연결이 지연되었습니다.')),60000);})]);}finally{clearTimeout(timer);}}
async function* fileBytes(m,first=0,last=Number(m.file.size)-1){
 if(!m?.parts?.length)throw new Error('파일 정보가 없습니다.');
 for(const p of m.parts){if(p.end<first||p.start>last)continue;let cursor=Math.max(0,first-p.start);const end=Math.min(p.size-1,last-p.start);let failures=0;
  while(cursor<=end){let reader;try{const r=await response(m,p,cursor,end,!!m._proxy||failures>0);reader=r.body.getReader();let skip=r.status===206?0:cursor;let received=false;
   while(cursor<=end){const z=await readWithTimeout(reader);if(z.done)break;let v=z.value;if(skip){const n=Math.min(skip,v.byteLength);skip-=n;v=v.subarray(n);}if(!v.byteLength)continue;v=v.subarray(0,end-cursor+1);cursor+=v.byteLength;received=true;yield v;}
   if(cursor<=end)throw new Error('파일 조각이 끝까지 전송되지 않았습니다.');
  }catch(e){failures++;m._proxy=true;if(failures>=3)throw e;await sleep(500*failures);}finally{if(reader){await reader.cancel().catch(()=>{});reader.releaseLock();}}}
 }
}
function dates(iso){let d=new Date(iso||Date.now());if(!Number.isFinite(+d))d=new Date();const y=Math.max(1980,Math.min(2107,d.getFullYear()));return[((d.getHours()<<11)|(d.getMinutes()<<5)|(d.getSeconds()>>1)),(((y-1980)<<9)|((d.getMonth()+1)<<5)|d.getDate())];}
function entries(ms){const used=new Set();return ms.map(m=>{let base=filename(m.file.name),name=base,n=2;while(used.has(name)){const i=base.lastIndexOf('.');name=i>0?base.slice(0,i)+' ('+n+++')'+base.slice(i):base+' ('+n+++')';}used.add(name);return{m,name:new TextEncoder().encode(name),stamp:dates(m.file.createdAt)};});}
function header(length){const a=new Uint8Array(length);const d=new DataView(a.buffer);return{a,u16:(p,v)=>d.setUint16(p,v,true),u32:(p,v)=>d.setUint32(p,v>>>0,true)};}
function zipSize(ms){return entries(ms).reduce((n,e)=>n+Number(e.m.file.size)+30+e.name.length+16+46+e.name.length,22);}
async function* zipBytes(ms){const all=entries(ms);if(!all.length||all.length>100||zipSize(ms)>=0xffffffff)throw new Error('ZIP 선택 범위가 너무 큽니다.');const central=[];let offset=0;
 for(const e of all){const local=header(30+e.name.length),start=offset;local.u32(0,0x04034b50);local.u16(4,20);local.u16(6,0x0808);local.u16(10,e.stamp[0]);local.u16(12,e.stamp[1]);local.u16(26,e.name.length);local.a.set(e.name,30);yield local.a;offset+=local.a.length;let crc=0xffffffff,size=0;
  for await(const b of fileBytes(e.m)){crc=crc32(b,crc);size+=b.length;offset+=b.length;yield b;}if(size!==Number(e.m.file.size))throw new Error('파일 크기 검증에 실패했습니다.');crc=(crc^0xffffffff)>>>0;
  const desc=header(16);desc.u32(0,0x08074b50);desc.u32(4,crc);desc.u32(8,size);desc.u32(12,size);yield desc.a;offset+=16;
  const c=header(46+e.name.length);c.u32(0,0x02014b50);c.u16(4,20);c.u16(6,20);c.u16(8,0x0808);c.u16(12,e.stamp[0]);c.u16(14,e.stamp[1]);c.u32(16,crc);c.u32(20,size);c.u32(24,size);c.u16(28,e.name.length);c.u32(42,start);c.a.set(e.name,46);central.push(c.a);
 }
 const start=offset;for(const c of central){yield c;offset+=c.length;}const end=header(22);end.u32(0,0x06054b50);end.u16(8,all.length);end.u16(10,all.length);end.u32(12,offset-start);end.u32(16,start);yield end.a;
}
function stream(iterator,onError){return new ReadableStream({async pull(c){try{const r=await iterator.next();r.done?c.close():c.enqueue(r.value);}catch(e){onError?.(e);c.error(e);}},async cancel(){await iterator.return?.();}});}
async function blob(m,type){const a=[];for await(const b of fileBytes(m))a.push(b);return new Blob(a,{type:type||'application/octet-stream'});}
root.OpenDropTransfer={fileBytes,zipBytes,zipSize,range,filename,disposition,stream,blob,crc32};
})(globalThis);
