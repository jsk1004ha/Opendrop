import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
const root=process.cwd();await mkdir('_qa',{recursive:true});
const redact=s=>String(s).replace(/(https?:\/\/[^\s"']+)\?[^\s"']*/g,'$1?[redacted]').replace(/eyJ[A-Za-z0-9_.-]{30,}/g,'[token]');
const report={at:new Date().toISOString(),console:[],failed:[],requests:[],checks:[]};
const server=createServer(async(req,res)=>{try{const p=new URL(req.url,'http://localhost').pathname;const f=resolve(root,'.'+(p==='/'?'/index.html':p));if(!f.startsWith(root+'/'))throw Error('path');const b=await readFile(f);res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png'})[extname(f)]||'application/octet-stream');res.end(b);}catch{res.writeHead(404);res.end();}});await new Promise(r=>server.listen(4173,'127.0.0.1',r));
let browser;
try{
 chromium.setGraphicsMode=false;
 browser=await puppeteer.launch({args:chromium.args,executablePath:await chromium.executablePath(),headless:'shell'});
 const page=await browser.newPage();await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true,deviceScaleFactor:1});
 page.on('console',m=>{if(m.type()==='error')report.console.push(redact(m.text()));});page.on('pageerror',e=>report.console.push(redact(e.message)));
 page.on('requestfailed',r=>report.failed.push({url:redact(r.url()),error:r.failure()?.errorText}));
 page.on('response',r=>{if(r.url().includes('supabase.co'))report.requests.push({url:redact(r.url()),status:r.status()});});
 await page.goto('http://127.0.0.1:4173',{waitUntil:'networkidle0',timeout:60000});
 report.checks.push({name:'initial-page',title:await page.title(),overflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),text:await page.$eval('body',e=>e.innerText.slice(0,1200))});
 await page.screenshot({path:'_qa/mobile.png',fullPage:true});
 await writeFile('/tmp/opendrop-browser-test.txt','OpenDrop browser verification — 2026-09-29\n');
 const input=await page.$('input[type=file]');if(input){await input.uploadFile('/tmp/opendrop-browser-test.txt');
  if(await page.$('#ttlSelect'))await page.select('#ttlSelect','600');
  if(await page.$('#ttl'))await page.select('#ttl','600');
  const btn=await page.$('#uploadBtn, #upload');if(btn){await btn.click();await new Promise(r=>setTimeout(r,15000));report.checks.push({name:'upload',text:await page.$eval('body',e=>e.innerText.slice(-1800))});}
 }
 await page.screenshot({path:'_qa/mobile-after.png',fullPage:true});
}catch(e){report.error=redact(e.stack||e);}
finally{if(browser)await browser.close();server.close();await writeFile('_qa/report.json',JSON.stringify(report,null,2));console.log('OPENDROP_BROWSER_REPORT '+JSON.stringify(report));}
