import { callBrowserFunction } from "./browser-function.mjs";
import { build } from 'esbuild';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
await mkdir('.tmp', {recursive:true});
const root=await mkdtemp(path.resolve('.tmp/annotation-screen-test-'));
const entry=`import React from 'react'; import {createRoot} from 'react-dom/client'; import {AnnotationsView} from './src/views/Project_Annotations_View'; import {I18nProvider} from './src/i18n/provider';
window.calls=[];window.callbacks={};let cb=0;window.listeners=[];
window.fixture=Array.from({length:123},(_,i)=>({id:'a'+String(i).padStart(3,'0'),displayId:i+1,sourceId:'s'+i,sourceKind:'text',primaryCodeId:i<60?'c1':'c2',primaryCodeLabel:i<60?'First':'Second',codeIds:[i<60?'c1':'c2'],quote:'Quote '+i,note:'',createdAt:'2026-01-01',createdByName:'Author'}));
window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
window.__TAURI_INTERNALS__={transformCallback:f=>{callbacks[++cb]=f;return cb},convertFileSrc:p=>p,invoke:async(command,args)=>{
 calls.push({command,args});
 if(command==='plugin:event|listen'){listeners.push(args);return listeners.length;}
 if(command==='list_annotation_page_command'){const r=args.request;let scope=fixture.filter(a=>!r.query||a.quote.toLowerCase().includes(r.query.toLowerCase())).filter(a=>!r.codeId||a.primaryCodeId===r.codeId);scope.sort((a,b)=>a.id.localeCompare(b.id)*(r.descending?-1:1));const offset=Math.min(r.offset,Math.floor(Math.max(0,scope.length-1)/50)*50);return {annotations:scope.slice(offset,offset+50),selected:fixture.find(a=>a.id===r.annotationId)||null,total:scope.length,offset,counts:{c1:fixture.filter(a=>a.primaryCodeId==='c1').length,c2:fixture.filter(a=>a.primaryCodeId==='c2').length}};}
 if(command==='list_source_summaries_command')return args.sourceIds.map(id=>({id,title:'Source '+id,sourceKind:'text'}));
 if(command==='list_postgres_experiment_codes_command')return [{id:'c1',label:'First'},{id:'c2',label:'Second'}];
 return [];
}};
window.emitChange=()=>listeners.filter(l=>l.event==='postgres-project-changed').forEach(l=>callbacks[l.handler]({payload:{projectId:'project',entityType:'annotation'}}));
const app=createRoot(document.getElementById('root'));window.renderAnnotations=(props={})=>app.render(<I18nProvider initialLocale='en'><AnnotationsView postgresProjectId='project' postgresCurrentUserId='u' {...props}/></I18nProvider>);renderAnnotations();`;
await build({stdin:{contents:entry,loader:'tsx',resolveDir:process.cwd()},bundle:true,format:'esm',outfile:path.join(root,'app.js'),loader:{'.css':'empty','.svg':'text'},plugins:[{name:'worker-url',setup(b){b.onResolve({filter:/\?url$/},a=>({path:a.path,namespace:'worker'}));b.onLoad({filter:/.*/,namespace:'worker'},()=>({contents:'export default "";'}));}}],define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent'});
const css=await readFile('src/App.css','utf8');
const server=createServer(async(req,res)=>{try{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?await readFile(path.join(root,'app.js')):'<style>'+css+'</style><div id="root"></div><script type="module" src="/app.js"></script>');}catch{res.statusCode=500;res.end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const delay=ms=>new Promise(r=>setTimeout(r,ms));let browser,ws;
try{
const profile=path.join(root,'chrome');browser=spawn(process.env.MEDIA_TEST_BROWSER||'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--remote-debugging-port=0','--user-data-dir='+profile,'--no-first-run','--window-size=1400,900','about:blank'],{windowsHide:true,stdio:'ignore'});
let debug;for(let i=0;i<100;i++){try{debug=(await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split(/\r?\n/)[0];break;}catch{await delay(100);}}if(!debug)throw Error('Chrome did not start');
const targets=await(await fetch('http://127.0.0.1:'+debug+'/json',{signal:AbortSignal.timeout(10000)})).json();ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));let id=0;const pending=new Map();ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')console.error(JSON.stringify(m.params));if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);}});const call=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;const timer=setTimeout(()=>reject(Error('CDP timeout: '+method+' '+JSON.stringify(params))),10000);pending.set(n,{resolve:v=>{clearTimeout(timer);resolve(v)},reject:e=>{clearTimeout(timer);reject(e)}});ws.send(JSON.stringify({id:n,method,params}));});const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
const evaluateFunction = (fn, ...args) => callBrowserFunction(call, fn, ...args);
await call('Runtime.enable');console.log('Browser connected');
await call('Page.navigate',{url:'http://127.0.0.1:'+server.address().port});
async function until(expression){for(let i=0;i<100;i++){if(await evaluate(expression))return;await delay(100);}throw Error('Timed out: '+expression+'\n'+await evaluate('document.body.innerText'));}
await until(`document.querySelectorAll('.annotations-list-row').length===50`);
await checkLeftScroll();
const scrollCheck=async()=>{
 return await evaluate(`(()=>{const w=document.querySelector('.table-card .data-table-wrap');w.scrollTop=1e8;const last=w.querySelector('tbody tr:last-child').getBoundingClientRect();const rect=w.getBoundingClientRect();return {last:last.bottom,bottom:rect.bottom,viewport:innerHeight,height:w.clientHeight,scroll:w.scrollHeight}})()`);
};
let measurements=[];
for(const [width,height] of [[1400,900],[900,700],[1400,600]]){
 await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await delay(100);
 const m=await scrollCheck();measurements.push({width,windowHeight:height,...m});assert.ok(m.height>50 && m.last<=m.bottom+2 && m.bottom<=height,JSON.stringify(m));
}
await call('Emulation.clearDeviceMetricsOverride');
assert.ok(await evaluate(`document.querySelector('.table-pagination').innerText.includes('/ 3')`));
await evaluate(`(()=>{const input=document.querySelector('.sources-list-toolbar input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Quote 122');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
await until(`document.querySelectorAll('.annotations-list-row').length===1 && document.querySelector('.table-pagination-counter').innerText==='1 / 1'`);
await evaluate(`(()=>{const input=document.querySelector('.sources-list-toolbar input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
await until(`document.querySelectorAll('.annotations-list-row').length===50 && document.querySelector('.table-pagination-counter').innerText==='1 / 3'`);

await evaluate(`document.querySelector('.table-pagination button[aria-label="Next page"]').click()`);
await until(`document.querySelector('.annotations-list-row').innerText.includes('A51')`);
await evaluate(`document.querySelector('.annotations-list-row').click()`);
await until(`document.body.innerText.includes('Quote 50')`);
await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.getAttribute('aria-label')==='Back to Annotations'||b.title==='Back to Annotations'||b.textContent.includes('Back to Annotations')).click()`);
await until(`document.querySelector('.annotations-list-row')?.innerText.includes('A51')`);
await evaluate(`renderAnnotations({initialPostgresAnnotationId:'a122'})`);
await until(`document.body.innerText.includes('Quote 122')`);
await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.getAttribute('aria-label')==='Back to Annotations'||b.title==='Back to Annotations'||b.textContent.includes('Back to Annotations')).click()`);
await until(`document.querySelectorAll('.annotations-list-row').length===50`);
await evaluate(`Array.from(document.querySelectorAll('td[role=button]')).find(e=>e.textContent.trim()==='First').click()`);
await until(`document.querySelector('.table-pagination').innerText.includes('/ 2')`);
assert.ok(await evaluate(`document.querySelector('.annotations-list-row').innerText.includes('A1')`));
await evaluate(`document.querySelector('.table-pagination button[aria-label="Next page"]').click()`);
await until(`document.querySelectorAll('.annotations-list-row').length===10`);
await evaluate(`window.fixture=fixture.filter(a=>a.primaryCodeId!=='c1'||Number(a.id.slice(1))<50);emitChange()`);
await until(`document.querySelector('.table-pagination').innerText.includes('/ 1') && document.querySelectorAll('.annotations-list-row').length===50`);
await delay(150);
await until(`document.querySelector('.annotations-list-row')?.innerText.includes('A1')`);
assert.ok(!await evaluate(`calls.some(c=>c.command==='list_postgres_experiment_annotation_summaries_command'||c.command==='list_postgres_experiment_sources_command')`));
// Large unpaginated tables must also scroll correctly with the shared layout.
await evaluate(`(()=>{const body=document.querySelector('.table-card tbody');const row=body.firstElementChild.outerHTML;body.innerHTML=row.repeat(250);})()`);
const unpaginated=await scrollCheck();assert.ok(unpaginated.last<=unpaginated.viewport && unpaginated.last<=unpaginated.bottom+2);
for(const kind of ['codebook','report','ai']) {
 await evaluateFunction((arg0, arg1, arg2, arg3) => { (()=>{const rows='<tr><td class="data-table-cell">Row</td></tr>'.repeat(250);const table='<div class="data-table-wrap '+(arg0==='codebook'?'codebook-table-wrap':'')+'"><table class="data-table"><thead><tr><th class="data-table-header">Name</th></tr></thead><tbody>'+rows+'</tbody></table></div>';const card=arg1==='report'?'<section class="report-layout-main">'+table+'</section>':'<div class="content-card '+(arg2==='ai'?'ai-process-doc-source-card':'table-card codebook-table-card')+'"><div class="card-header">Title</div>'+table+'</div>';document.getElementById('root').innerHTML='<div class="view view-shell"><header class="view-header">List</header><div class="view-content '+(arg3==='codebook'?'codebook-table-shell':'')+'">'+card+'</div></div>';})(); }, kind, kind, kind, kind);
 for(const [width,height] of [[1400,900],[900,600]]) {
  await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
  const m=await evaluate(`(()=>{const w=document.querySelector('.data-table-wrap');w.scrollTop=1e8;return {height:w.clientHeight,bottom:w.getBoundingClientRect().bottom,last:w.querySelector('tr:last-child').getBoundingClientRect().bottom,viewport:innerHeight};})()`);
  assert.ok(m.height>50 && m.last<=m.bottom+2 && m.bottom<=height,kind+JSON.stringify(m));
 }
}
console.log(JSON.stringify({passed:true,measurements,checks:['viewport scrolling','50-row pages','global counts','page preserved on close','off-page deep link','code filter','mutation refresh','last-page clamp','focused queries']},null,2));
async function checkLeftScroll() {
 for (const width of [1400, 900, 600]) {
  await call('Emulation.setDeviceMetricsOverride',{width,height:600,deviceScaleFactor:1,mobile:false});
  const bounds=await evaluate(`(()=>{const left=document.querySelector('.master-detail-grid > .home-primary-column');const body=left.querySelector('tbody');if(!body.dataset.expanded){const row=body.lastElementChild;for(let i=0;i<35;i++)body.append(row.cloneNode(true));body.dataset.expanded='true';}left.scrollTop=0;const first=body.firstElementChild.getBoundingClientRect(),box=left.getBoundingClientRect();left.scrollTop=1e8;const last=body.lastElementChild.getBoundingClientRect();return {top:box.top,bottom:box.bottom,first:first.top,last:last.bottom,scroll:left.scrollTop,height:left.clientHeight,viewport:innerHeight};})()`);
  assert.ok(bounds.first>=bounds.top-1 && bounds.scroll>0 && bounds.last<=bounds.bottom+2 && bounds.bottom<=bounds.viewport,JSON.stringify({width,...bounds}));
  const pointer=await evaluate(`(()=>{const left=document.querySelector('.master-detail-grid > .home-primary-column');left.scrollTop=0;const r=left.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);
  await call('Input.dispatchMouseEvent',{type:'mouseWheel',...pointer,deltaX:0,deltaY:300});
  await until(`document.querySelector('.master-detail-grid > .home-primary-column').scrollTop>0`);

 }
 await call('Emulation.setDeviceMetricsOverride',{width:1400,height:900,deviceScaleFactor:1,mobile:false});
 await evaluate(`(()=>{const left=document.querySelector('.master-detail-grid > .home-primary-column'),body=left.querySelector('tbody');for(let i=0;i<35;i++)body.lastElementChild.remove();delete body.dataset.expanded;left.scrollTop=0;})()`);
}
await call('Browser.close');ws.close();browser=undefined;
} finally {if(ws)ws.close();if(browser)browser.kill();server.close();}

