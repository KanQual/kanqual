import { createTestRoot, buildBrowserFixture, serveBrowserFixture, startBrowser, delay } from "./browser-test-harness.mjs";
import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = await createTestRoot('selection-diagnostic-');
const entry=await readFile("scripts/fixtures/selection-diagnostic.tsx","utf8");
await buildBrowserFixture(root, entry);
const server = await serveBrowserFixture(root);
let session;
try {
  session = await startBrowser({ root });
  const { call, evaluate, evaluateFunction, until } = session;
  await session.navigate(server.url);
await until(`typeof renderCoding==='function'`);
const results=[];
async function ready(mode,locked=true){await evaluateFunction((arg0, arg1) => { renderCoding(arg0,arg1); }, mode, locked);await until(`document.querySelector('.doc-text > div')?.textContent.includes('Alpha')`);await delay(100);}
async function selectText(target='inside') {
 await evaluateFunction((arg0, arg1) => { (()=>{const root=document.querySelector('.doc-text > div');const node=document.createTreeWalker(root,NodeFilter.SHOW_TEXT).nextNode();const range=document.createRange();range.setStart(node,0);range.setEnd(node,10);const s=getSelection();s.removeAllRanges();s.addRange(range);if(arg0!=='none')(arg1==='inside'?root:document.querySelector('.doc-text')).dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));})(); }, target, target);
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
 await ready(mode,false);await selectText();await evaluateFunction((arg0) => { renderCoding(arg0,true,false); }, mode);await delay(150);const lock=await evaluate(`({selected:getSelection().toString(),annotationMode:!!document.querySelector('.code-item--annotatable')})`);assert.equal(lock.selected,'Alpha beta');assert.equal(lock.annotationMode,false);results.push({mode,scenario:'Selection made before edit lock arrives',...lock});
}
console.log(JSON.stringify({diagnostic:'Selection regression checks passed',results},null,2));
await writeFile(path.join(root,'results.json'),JSON.stringify(results,null,2));

} finally {
  await session?.close();
  await server.close();
}
