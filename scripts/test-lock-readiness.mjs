import { build } from 'esbuild';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
await mkdir('.tmp', {recursive:true});
const root=await mkdtemp(path.resolve('.tmp/lock-readiness-test-'));
const entry=`import React from 'react'; import {createRoot} from 'react-dom/client'; import {SourcesView} from './src/views/Sources_View'; import {I18nProvider} from './src/i18n/provider';
const nativeInterval=window.setInterval;window.setInterval=(fn,ms,...args)=>{if(ms===15000)window.lockHeartbeat=fn;return nativeInterval(fn,ms,...args)};window.lockRequests=[]; window.calls=[]; window.fixture=Array.from({length:123},(_,i)=>({id:'s'+i,projectId:'project',sourceKind:i===122?'video':'text',title:'Source '+String(i).padStart(3,'0'),notes:'',storagePath:'',originalFileName:'',createdAt:'2026-01-01',updatedAt:'2026-01-01',hasTextContent:true,hasStructuredContent:false,annotationCount:0,objectCount:0}));
window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
window.__TAURI_INTERNALS__={transformCallback:()=>0,convertFileSrc:p=>p,invoke:async(command,args)=>{
 window.calls.push({command,args});
 if(command==='acquire_postgres_experiment_source_lock_command')return new Promise((resolve,reject)=>lockRequests.push({resolve,reject,args}));
 if(command==='list_source_page_command') { const r=args.request; const scope=fixture.filter(s=>!r.query||s.title.toLowerCase().includes(r.query.toLowerCase())||(r.query==='hidden text'&&s.id==='s121')); const kinds=['text','video'].map(sourceKind=>({sourceKind,count:scope.filter(s=>s.sourceKind===sourceKind).length})); let rows=scope.filter(s=>!r.kind||s.sourceKind===r.kind); rows.sort((a,b)=>a.title.localeCompare(b.title)*(r.descending?-1:1));const offset=r.all?0:Math.min(r.offset,Math.floor(Math.max(0,rows.length-1)/50)*50);return {sources:r.all?rows:rows.slice(offset,offset+50),kinds,total:rows.length,offset,storagePath:''}; }
 if(command==='get_source_details_command') return {...fixture.find(s=>s.id===args.sourceId),textContent:'Selected text',structuredContentJson:'',waveformPeaksJson:'',videoFrameIndexJson:''};
 if(command==='get_source_list_entry_command') return fixture.find(s=>s.id===args.sourceId);
 if(command==='get_postgres_experiment_auth_status_command') return {authenticated:false};
 if(command==='delete_postgres_experiment_source_command') {window.fixture=fixture.filter(s=>s.id!==args.sourceId);return {};}
 if(command.includes('listen')) return 1;
 return [];
}};
const app=createRoot(document.getElementById('root'));window.renderSource=(props={})=>app.render(<I18nProvider initialLocale='en'><SourcesView projectId='project' currentUserId='user' canManageSources={true} codingEnabled canManageAnnotations={true} canManageCodes={false} onOpenPostgresMemoDraft={()=>{}} {...props}/></I18nProvider>); window.renderSource();`;
await build({stdin:{contents:entry,loader:'tsx',resolveDir:process.cwd()},bundle:true,format:'esm',outfile:path.join(root,'app.js'),loader:{'.css':'empty','.svg':'text'},plugins:[{name:'worker-url',setup(b){b.onResolve({filter:/\?url$/},a=>({path:a.path,namespace:'worker'}));b.onLoad({filter:/.*/,namespace:'worker'},()=>({contents:'export default "";'}));}}],define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent'});
const css=await readFile("src/App.css", "utf8");
const server=createServer(async(req,res)=>{try{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?await readFile(path.join(root,'app.js')):'<style>'+css+'</style><div id="root"></div><script type="module" src="/app.js"></script>');}catch{res.statusCode=500;res.end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const delay=ms=>new Promise(r=>setTimeout(r,ms));let browser,ws;
try{
const profile=path.join(root,'chrome');browser=spawn(process.env.MEDIA_TEST_BROWSER||'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--remote-debugging-port=0','--user-data-dir='+profile,'--no-first-run','--window-size=1400,900','about:blank'],{windowsHide:true,stdio:'ignore'});
let debug;for(let i=0;i<100;i++){try{debug=(await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split(/\r?\n/)[0];break;}catch{await delay(100);}}if(!debug)throw Error('Chrome did not start');
const targets=await(await fetch('http://127.0.0.1:'+debug+'/json',{signal:AbortSignal.timeout(10000)})).json();ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));let id=0;const pending=new Map();ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')console.error(JSON.stringify(m.params));if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);}});const call=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;const timer=setTimeout(()=>reject(Error('CDP timeout: '+method+' '+JSON.stringify(params))),10000);pending.set(n,{resolve:v=>{clearTimeout(timer);resolve(v)},reject:e=>{clearTimeout(timer);reject(e)}});ws.send(JSON.stringify({id:n,method,params}));});const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
await call('Runtime.enable');console.log('Browser connected');
await call('Page.navigate',{url:'http://127.0.0.1:'+server.address().port});
async function until(expression){for(let i=0;i<100;i++){if(await evaluate(expression))return;await delay(100);}throw Error('Timed out: '+expression+'\n'+await evaluate('document.body.innerText'));}

await until(`document.querySelectorAll('.case-list-row').length===50`);
const results=[];
async function open(mode='manual') {
 await evaluate(`renderSource({textCodingMode:${JSON.stringify(mode)}})`);
 await evaluate(`document.querySelector('.case-list-row').click()`);
 await until(`document.body.innerText.includes('Preparing coding workspace') && lockRequests.length>0`);
 assert.equal(await evaluate(`!!document.querySelector('.doc-text')`),false);
}
async function resolveLock(conflict=false) {
 await evaluate(`(()=>{const r=lockRequests.shift();r.resolve(${conflict}?{ok:false,conflict:{id:'other-lock',sourceId:'s0',userId:'other',userName:'Another coder',reason:'locked'}}:{ok:true,lock:{id:'lock',sourceId:'s0',userId:'user',userName:'Tester'}})})()`);
 await until(`!!document.querySelector('.doc-text')`);
}
async function back(){await evaluate(`document.querySelector('.view-header-back-button').click()`);await until(`document.querySelectorAll('.case-list-row').length===50`);}
for (const mode of ['manual','ai-assisted']) {
 await open(mode);await delay(150);assert.equal(await evaluate(`document.body.innerText.includes('Selected text')`),false);
 await resolveLock();assert.ok(await evaluate(`document.body.innerText.includes('Selected text')`));results.push(mode+' waits for lock success');
 await evaluate(`lockHeartbeat()`);await until(`lockRequests.length===1`);assert.equal(await evaluate(`!!document.querySelector('.doc-text')`),true);await resolveLock();
 await evaluate(`lockHeartbeat()`);await until(`lockRequests.length===1`);await evaluate(`lockRequests.shift().reject(new Error('Heartbeat failure'))`);await delay(100);assert.equal(await evaluate(`!!document.querySelector('.doc-text')`),true);results.push(mode+' heartbeat does not unmount workspace');await back();
}
await open();await resolveLock(true);assert.ok(await evaluate(`document.body.innerText.includes('Another coder')`));results.push('conflict opens read-only coding view');await back();
await open();await evaluate(`lockRequests.shift().reject(new Error('Simulated lock failure'))`);await until(`document.body.innerText.includes('Simulated lock failure')`);assert.equal(await evaluate(`!!document.querySelector('.doc-text')`),false);
await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Retry').click()`);await until(`lockRequests.length===1`);await resolveLock();results.push('failure remains gated; retry opens workspace');await back();
await evaluate(`renderSource({codingEnabled:true,canManageAnnotations:false})`);await delay(50);await evaluate(`document.querySelector('.case-list-row').click()`);await until(`!!document.querySelector('.doc-text')`);assert.equal(await evaluate(`lockRequests.length`),0);results.push('read-only users do not wait or request a lock');await back();
await evaluate(`renderSource({canManageAnnotations:true})`);await delay(50);await open();await back();await evaluate(`lockRequests.shift().resolve({ok:true,lock:{id:'late',sourceId:'s0',userId:'user'}})`);await delay(100);assert.equal(await evaluate(`!!document.querySelector('.doc-text')`),false);results.push('late completion does not reopen closed source');
console.log(JSON.stringify({passed:true,results},null,2));
await call('Browser.close');ws.close();browser=undefined;
} finally {if(ws)ws.close();if(browser)browser.kill();server.close();}
