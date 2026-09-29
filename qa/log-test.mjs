import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir,stat,readdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';

const root=process.cwd(), downloads='/tmp/opendrop-log-downloads';
await mkdir(downloads,{recursive:true});
const report={checks:[],errors:[]};
const ok=(name,value,detail)=>{report.checks.push({name,ok:!!value,detail});if(!value)throw Error('Assertion failed: '+name)};
const server=createServer(async(req,res)=>{try{const p=new URL(req.url,'http://local').pathname,f=resolve(root,'.'+(p==='/'?'/index.html':p));if(!f.startsWith(root+'/'))throw Error('path');const b=await readFile(f);res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8'})[extname(f)]||'application/octet-stream');res.end(b);}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(4191,'127.0.0.1',r));
let browser,page;
async function disk(name,timeout=30000){const end=Date.now()+timeout;while(Date.now()<end){try{const p=resolve(downloads,name);await stat(p);if(!(await readdir(downloads)).some(n=>n.endsWith('.crdownload')))return await readFile(p);}catch{}await new Promise(r=>setTimeout(r,250));}throw Error('Download did not finish '+name);}
const prefix='__logqa_'+Date.now()+'_',aName=prefix+'one.txt',bName=prefix+'two.txt',aText='download log single\n',bText='download log zip\n';
try{
 chromium.setGraphicsMode=false;browser=await puppeteer.launch({args:chromium.args,executablePath:await chromium.executablePath(),headless:'shell'});
 page=await browser.newPage();await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true,deviceScaleFactor:1});
 page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text())});page.on('pageerror',e=>report.errors.push(e.message));
 const cdp=await page.createCDPSession();await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads,eventsEnabled:true});
 await page.goto('http://127.0.0.1:4191',{waitUntil:'networkidle0',timeout:60000});await page.waitForFunction(()=>document.querySelector('#connectionStatus').textContent.includes('[ok]'),{timeout:30000});
 await writeFile('/tmp/'+aName,aText);await writeFile('/tmp/'+bName,bText);const input=await page.$('#fileInput');await input.uploadFile('/tmp/'+aName,'/tmp/'+bName);await page.click('#uploadBtn');await page.waitForFunction(()=>!busy&&queue.length===2&&queue.every(q=>q.state==='done'),{timeout:60000});
 const ids=await page.evaluate(([a,b])=>[files.find(f=>f.name===a)?.id,files.find(f=>f.name===b)?.id],[aName,bName]);ok('uploaded-two-files',ids.every(Boolean),ids);
 await page.click('[data-file-id="'+ids[0]+'"] [data-action="download"]');ok('single-download-bytes',(await disk(aName)).equals(Buffer.from(aText)));
 await page.click('#downloadLogBtn');await page.waitForSelector('#downloadLogDialog[open]');await page.waitForFunction(name=>document.querySelector('#downloadLogList').textContent.includes(name),{timeout:15000},aName);
 let text=await page.$eval('#downloadLogList',e=>e.textContent);ok('single-complete-log-visible',text.includes(aName),text);
 await page.click('[data-close="downloadLogDialog"]');
 await page.click('[data-file-id="'+ids[0]+'"] input[type=checkbox]');await page.click('[data-file-id="'+ids[1]+'"] input[type=checkbox]');await page.click('#zipBtn');await disk('OpenDrop.zip');
 await page.click('#downloadLogBtn');await page.waitForFunction(name=>document.querySelector('#downloadLogList').textContent.includes('[zip]')&&document.querySelector('#downloadLogList').textContent.includes(name),{timeout:15000},bName);
 text=await page.$eval('#downloadLogList',e=>e.textContent);ok('zip-complete-log-visible',text.includes('[zip]')&&text.includes(aName)&&text.includes(bName),text);
 const meta=await page.evaluate(async()=>await api('download-logs'));ok('retention-contract',meta.retentionHours===24&&meta.maxLogs===100,{retentionHours:meta.retentionHours,maxLogs:meta.maxLogs});
 await page.screenshot({path:'/tmp/opendrop-log-dialog.png',fullPage:true});report.ok=true;
}catch(e){report.ok=false;report.error=String(e.stack||e);}finally{
 if(page)try{report.cleanup=await page.evaluate(async prefix=>{const own=ownership(),d=await api('files?'+new URLSearchParams({q:prefix}));let n=0;for(const f of d.files){if(own[f.id]){await api('delete-file',{fileId:f.id,uploadSecret:own[f.id].secret});n++;}}return n;},prefix);}catch(e){report.cleanupError=e.message;}
 if(browser)await browser.close();server.close();console.log('OPENDROP_LOG_QA '+JSON.stringify(report));if(!report.ok)process.exitCode=1;
}
