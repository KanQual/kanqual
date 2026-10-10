import { build } from 'esbuild';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
await mkdir('.tmp', {recursive:true});
const root=await mkdtemp(path.resolve('.tmp/navigation-test-'));
const entry=await readFile("scripts/fixtures/table-screen.tsx","utf8");
await build({stdin:{contents:entry,loader:'tsx',resolveDir:process.cwd()},bundle:true,format:'esm',outfile:path.join(root,'app.js'),loader:{'.css':'empty','.svg':'text','.png':'dataurl','.md':'text'},plugins:[{name:'worker-url',setup(b){b.onResolve({filter:/\?url$/},a=>({path:a.path,namespace:'worker'}));b.onLoad({filter:/.*/,namespace:'worker'},()=>({contents:'export default "";'}));}}],define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent'});
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
await until(`typeof renderScreen==='function'`);
await evaluate(`renderScreen('home')`);await until(`document.querySelector('.sidebar')!==null`);await delay(1200);
await evaluate(`window.calls=[];window.initialMain=document.querySelector('.app-main').innerText;const button=Array.from(document.querySelectorAll('.sidebar button')).find(b=>b.title==='Codebook'||b.textContent.trim()==='Codebook');button.dispatchEvent(new PointerEvent('pointerover',{bubbles:true,pointerType:'mouse'}));button.focus()`);
await delay(200);
assert.deepEqual(await evaluate(`calls.map(c=>c.command).filter(c=>!c.startsWith('plugin:'))`),[]);
assert.equal(await evaluate(`document.querySelector('.app-main').innerText===initialMain`),true);
const measurements=[];
for (const name of ['Objects','Relationships','Users','Objects']) {
 await evaluate(`window.calls=[]`);const started=performance.now();
 await evaluate(`Array.from(document.querySelectorAll('.sidebar button')).find(b=>b.title===${JSON.stringify(name)}||b.textContent.trim()===${JSON.stringify(name)}).click()`);
 await until(`document.querySelector('.table-pagination-counter')?.innerText==='1 / 3'`);await delay(100);
 measurements.push({view:name,elapsedMs:Math.round(performance.now()-started),commands:await evaluate(`calls.map(c=>c.command).filter(c=>!c.startsWith('plugin:'))`)});
}
for(const measurement of measurements)assert.deepEqual(measurement.commands,[],JSON.stringify(measurement));
await evaluate(`window.calls=[];fixtureObjects[0].title='Updated externally';emit('object')`);
await until(`document.body.innerText.includes('Updated externally')`);
assert.equal(await evaluate(`calls.filter(c=>c.command==='list_postgres_experiment_objects_command').length`),1);
await evaluate(`Array.from(document.querySelectorAll('.sidebar button')).find(b=>b.title==='Users'||b.textContent.trim()==='Users').click()`);await delay(100);
await evaluate(`window.calls=[];fixtureObjects[0].title='Changed while viewing users';emit('object')`);
await until(`calls.some(c=>c.command==='list_postgres_experiment_objects_command')`);await delay(100);
await evaluate(`window.calls=[];Array.from(document.querySelectorAll('.sidebar button')).find(b=>b.title==='Objects'||b.textContent.trim()==='Objects').click()`);
await until(`document.body.innerText.includes('Changed while viewing users')`);
assert.equal(await evaluate(`calls.filter(c=>c.command==='list_postgres_experiment_objects_command').length`),0);
await evaluate(`window.calls=[];emit('saved_drawing')`);await delay(100);
assert.equal(await evaluate(`calls.filter(c=>c.command==='list_postgres_experiment_saved_drawing_summaries_command').length`),1);
assert.equal(await evaluate(`calls.filter(c=>c.command==='list_postgres_experiment_objects_command').length`),0);
console.log(JSON.stringify({measurements,checks:['no navigation reload','external changes refresh visible objects','updates received while viewing users persist on return','saved drawing changes use focused refresh']},null,2));
await writeFile(path.join(root,'results.json'),JSON.stringify(measurements,null,2));
await call('Browser.close');ws.close();browser=undefined;
} finally {if(ws)ws.close();if(browser)browser.kill();server.close();}
