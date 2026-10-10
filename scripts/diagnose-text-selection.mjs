import { build } from 'esbuild';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
await mkdir('.tmp', {recursive:true});
const root=await mkdtemp(path.resolve('.tmp/selection-diagnostic-'));
const entry=await readFile("scripts/fixtures/selection-diagnostic.tsx","utf8");
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
await until(`typeof renderCoding==='function'`);
const results=[];
async function ready(mode,locked=true){await evaluate(`renderCoding(${JSON.stringify(mode)},${locked})`);await until(`document.querySelector('.doc-text > div')?.textContent.includes('Alpha')`);await delay(100);}
async function selectText(target='inside') {
 await evaluate(`(()=>{const root=document.querySelector('.doc-text > div');const node=document.createTreeWalker(root,NodeFilter.SHOW_TEXT).nextNode();const range=document.createRange();range.setStart(node,0);range.setEnd(node,10);const s=getSelection();s.removeAllRanges();s.addRange(range);if(${JSON.stringify(target)}!=='none')(${JSON.stringify(target)}==='inside'?root:document.querySelector('.doc-text')).dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));})()`);
 await delay(150);
 return await evaluate(`({selected:getSelection().toString(),annotationMode:!!document.querySelector('.code-item--annotatable')})`);
}
for(const mode of ['manual','ai']) {
 await ready(mode);const normal=await selectText();assert.equal(normal.annotationMode,true);results.push({mode,scenario:'Mouse release inside text',...normal});
 await ready(mode);
 const points=await evaluate(`(()=>{const viewer=document.querySelector('.doc-text'),root=viewer.firstElementChild,node=document.createTreeWalker(root,NodeFilter.SHOW_TEXT).nextNode(),r=document.createRange();r.setStart(node,0);r.setEnd(node,1);const a=r.getBoundingClientRect(),b=root.getBoundingClientRect(),v=viewer.getBoundingClientRect();return {start:{x:a.left+1,y:a.top+a.height/2},end:{x:a.left+30,y:Math.min(v.bottom-8,b.bottom+25)}};})()`);
 await call('Input.dispatchMouseEvent',{type:'mousePressed',...points.start,button:'left',clickCount:1});
 await call('Input.dispatchMouseEvent',{type:'mouseMoved',...points.end,button:'left',buttons:1});
 await delay(150);assert.equal(await evaluate(`!!document.querySelector('.code-item--annotatable')`),false);
 await call('Input.dispatchMouseEvent',{type:'mouseReleased',...points.end,button:'left',clickCount:1});
 await delay(150);
 const drag=await evaluate(`({selected:getSelection().toString(),annotationMode:!!document.querySelector('.code-item--annotatable')})`);
 assert.ok(drag.selected.length>0);assert.equal(drag.annotationMode,true);results.push({mode,scenario:'Real browser drag ending below text in viewer',...drag});
 await ready(mode);const outside=await selectText('outside');assert.equal(outside.selected,'Alpha beta');assert.equal(outside.annotationMode,true);results.push({mode,scenario:'Selection intact, mouse release in surrounding viewer',...outside});
 await ready(mode);const keyboard=await selectText('none');assert.equal(keyboard.annotationMode,true);results.push({mode,scenario:'Selection change without mouseup (keyboard/touch path)',...keyboard});
 await ready(mode);await selectText('none');
 const codePoint=await evaluate(`(()=>{const r=document.querySelector('.code-item--annotatable').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
 await call('Input.dispatchMouseEvent',{type:'mousePressed',...codePoint,button:'left',clickCount:1});
 await call('Input.dispatchMouseEvent',{type:'mouseReleased',...codePoint,button:'left',clickCount:1});await delay(150);
 const created=await evaluate(`createdAnnotations.at(-1)[1]`);assert.deepEqual(created,{startOffset:0,endOffset:10,quote:'Alpha beta'});results.push({mode,scenario:'Applying a code preserves captured offsets',created});
 await ready(mode);await selectText('none');await evaluate(`getSelection().removeAllRanges()`);await delay(150);assert.equal(await evaluate(`!!document.querySelector('.code-item--annotatable')`),false);
 await ready(mode);
 await evaluate(`(()=>{const root=document.querySelector('.doc-text > div'),node=document.createTreeWalker(root,NodeFilter.SHOW_TEXT).nextNode();root.tabIndex=0;root.focus();getSelection().setBaseAndExtent(node,10,node,0);})()`);await delay(150);assert.equal(await evaluate(`!!document.querySelector('.code-item--annotatable')`),true);results.push({mode,scenario:'Backward selection activates coding'});
 await evaluate(`(()=>{const root=document.querySelector('.doc-text > div'),node=document.createTreeWalker(root,NodeFilter.SHOW_TEXT).nextNode();getSelection().collapse(node,0);})()`);await delay(150);
 await evaluate(`getSelection().modify('extend','forward','character')`);await delay(150);
 assert.equal(await evaluate(`!!document.querySelector('.code-item--annotatable')`),true);results.push({mode,scenario:'Browser keyboard-style range extension without mouse activates coding'});
 await evaluate(`(()=>{const h=document.querySelector('h1');const r=document.createRange();r.selectNodeContents(h);const s=getSelection();s.removeAllRanges();s.addRange(r);})()`);await delay(150);assert.equal(await evaluate(`!!document.querySelector('.code-item--annotatable')`),false);results.push({mode,scenario:'Selection outside source clears coding mode'});
 await ready(mode,false);await selectText();await evaluate(`renderCoding(${JSON.stringify(mode)},true,false)`);await delay(150);const lock=await evaluate(`({selected:getSelection().toString(),annotationMode:!!document.querySelector('.code-item--annotatable')})`);assert.equal(lock.selected,'Alpha beta');assert.equal(lock.annotationMode,false);results.push({mode,scenario:'Selection made before edit lock arrives',...lock});
}
console.log(JSON.stringify({diagnostic:'Selection regression checks passed',results},null,2));
await writeFile(path.join(root,'results.json'),JSON.stringify(results,null,2));
await call('Browser.close');ws.close();browser=undefined;
} finally {if(ws)ws.close();if(browser)browser.kill();server.close();}
