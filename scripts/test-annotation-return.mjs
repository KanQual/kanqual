import { build } from 'esbuild';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
await mkdir('.tmp', {recursive:true});
const root=await mkdtemp(path.resolve('.tmp/annotation-return-test-'));
const entry=`import {ListVisitCacheProvider} from "./src/lib/listVisitCache"; import React from 'react'; import {createRoot} from 'react-dom/client'; import {AnnotationsView} from './src/views/Project_Annotations_View'; import {I18nProvider} from './src/i18n/provider';
window.calls=[];window.callbacks={};let cb=0;window.listeners=[];
window.fixture=Array.from({length:123},(_,i)=>({id:'a'+String(i).padStart(3,'0'),displayId:i+1,sourceId:'s'+i,sourceKind:'text',primaryCodeId:i<60?'c1':'c2',primaryCodeLabel:i<60?'First':'Second',codeIds:[i<60?'c1':'c2'],quote:'Quote '+i,note:'',createdAt:'2026-01-01',createdByName:'Author'}));
window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
window.__TAURI_INTERNALS__={transformCallback:f=>{callbacks[++cb]=f;return cb},convertFileSrc:p=>p,invoke:async(command,args)=>{
 calls.push({command,args});
 if(command==='plugin:event|listen'){listeners.push(args);return listeners.length;}
 if(command==='list_annotation_page_command'){if(window.deferAnnotations)await new Promise(resolve=>(window.pendingAnnotations??=[]).push(resolve));const r=args.request;let scope=fixture.filter(a=>!r.query||a.quote.toLowerCase().includes(r.query.toLowerCase())).filter(a=>!r.codeId||a.primaryCodeId===r.codeId);scope.sort((a,b)=>a.id.localeCompare(b.id)*(r.descending?-1:1));const offset=Math.min(r.offset,Math.floor(Math.max(0,scope.length-1)/50)*50);return {annotations:scope.slice(offset,offset+50),selected:fixture.find(a=>a.id===r.annotationId)||null,total:scope.length,offset,counts:{c1:fixture.filter(a=>a.primaryCodeId==='c1').length,c2:fixture.filter(a=>a.primaryCodeId==='c2').length}};}
 if(command==='list_source_summaries_command')return args.sourceIds.map(id=>({id,title:'Source '+id,sourceKind:'text'}));
 if(command==='list_postgres_experiment_codes_command')return [{id:'c1',label:'First'},{id:'c2',label:'Second'}];
 return [];
}};
window.emitChange=()=>listeners.filter(l=>l.event==='postgres-project-changed').forEach(l=>callbacks[l.handler]({payload:{projectId:'project',entityType:'annotation'}}));
const app=createRoot(document.getElementById('root'));window.renderAnnotations=(props={})=>app.render(<ListVisitCacheProvider projectId="project"><I18nProvider initialLocale='en'><AnnotationsView key={window.visitKey??0} postgresProjectId='project' postgresCurrentUserId='u' {...props}/></I18nProvider></ListVisitCacheProvider>);renderAnnotations();`;
await build({stdin:{contents:entry,loader:'tsx',resolveDir:process.cwd()},bundle:true,format:'esm',outfile:path.join(root,'app.js'),loader:{'.css':'empty','.svg':'text'},plugins:[{name:'worker-url',setup(b){b.onResolve({filter:/\?url$/},a=>({path:a.path,namespace:'worker'}));b.onLoad({filter:/.*/,namespace:'worker'},()=>({contents:'export default "";'}));}}],define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent'});
const css=await readFile('src/App.css','utf8');
const server=createServer(async(req,res)=>{try{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?await readFile(path.join(root,'app.js')):'<style>'+css+'</style><div id="root"></div><script type="module" src="/app.js"></script>');}catch{res.statusCode=500;res.end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const delay=ms=>new Promise(r=>setTimeout(r,ms));let browser,ws;
try{
const profile=path.join(root,'chrome');browser=spawn(process.env.MEDIA_TEST_BROWSER||'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--remote-debugging-port=0','--user-data-dir='+profile,'--no-first-run','--window-size=1400,900','about:blank'],{windowsHide:true,stdio:'ignore'});
let debug;for(let i=0;i<100;i++){try{debug=(await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split(/\r?\n/)[0];break;}catch{await delay(100);}}if(!debug)throw Error('Chrome did not start');
const targets=await(await fetch('http://127.0.0.1:'+debug+'/json',{signal:AbortSignal.timeout(10000)})).json();ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));let id=0;const pending=new Map();ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')console.error(JSON.stringify(m.params));if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);}});const call=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;const timer=setTimeout(()=>reject(Error('CDP timeout: '+method+' '+JSON.stringify(params))),10000);pending.set(n,{resolve:v=>{clearTimeout(timer);resolve(v)},reject:e=>{clearTimeout(timer);reject(e)}});ws.send(JSON.stringify({id:n,method,params}));});const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
await call('Runtime.enable');console.log('Browser connected');
await call('Page.navigate',{url:'http://127.0.0.1:'+server.address().port});
async function until(expression){for(let i=0;i<100;i++){if(await evaluate(expression))return;await delay(100);}throw Error('Timed out: '+expression+'\n'+await evaluate('document.body.innerText'));}
await until(`document.querySelectorAll('.annotations-list-row').length===50`);
await evaluate(`document.querySelector('button[aria-label="Next page"]').click()`);await until(`document.querySelector('.annotations-list-row').innerText.includes('A51')`);
await evaluate(`window.deferAnnotations=true;window.visitKey=1;renderAnnotations()`);await until(`window.pendingAnnotations?.length===1`);
assert.ok(await evaluate(`document.querySelector('.annotations-list-row')?.innerText.includes('A51')`));
assert.equal(await evaluate(`document.querySelector('.table-pagination-counter').textContent`),'2 / 3');
await delay(300);assert.equal(await evaluate(`pendingAnnotations.length`),1);
await evaluate(`pendingAnnotations.shift()()`);await delay(100);
console.log('Annotation repeat visit: cached rows and page restored while revalidation is pending');
await call('Browser.close');ws.close();browser=undefined;
} finally {if(ws)ws.close();if(browser)browser.kill();server.close();}
