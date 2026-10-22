import { createTestRoot, buildBrowserFixture, serveBrowserFixture, startBrowser } from "./browser-test-harness.mjs";
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = await createTestRoot('source-screen-test-');
const entry=`import React from 'react'; import {createRoot} from 'react-dom/client'; import {SourcesView} from './src/views/Sources_View'; import { I18nProvider } from './src/i18n/provider';
window.calls=[]; window.fixture=Array.from({length:123},(_,i)=>({id:'s'+i,projectId:'project',sourceKind:i===122?'video':'text',title:'Source '+String(i).padStart(3,'0'),notes:'',storagePath:'',originalFileName:'',createdAt:'2026-01-01',updatedAt:'2026-01-01',hasTextContent:true,hasStructuredContent:false,annotationCount:0,objectCount:0}));
window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
window.__TAURI_INTERNALS__={transformCallback:()=>0,convertFileSrc:p=>p,invoke:async(command,args)=>{
 window.calls.push({command,args});
 if(command==='list_source_page_command') { const r=args.request; const scope=fixture.filter(s=>!r.query||s.title.toLowerCase().includes(r.query.toLowerCase())||(r.query==='hidden text'&&s.id==='s121')); const kinds=['text','video'].map(sourceKind=>({sourceKind,count:scope.filter(s=>s.sourceKind===sourceKind).length})); let rows=scope.filter(s=>!r.kind||s.sourceKind===r.kind); rows.sort((a,b)=>a.title.localeCompare(b.title)*(r.descending?-1:1));const offset=r.all?0:Math.min(r.offset,Math.floor(Math.max(0,rows.length-1)/50)*50);return {sources:r.all?rows:rows.slice(offset,offset+50),kinds,total:rows.length,offset,storagePath:''}; }
 if(command==='get_source_details_command') return {...fixture.find(s=>s.id===args.sourceId),textContent:'Selected text',structuredContentJson:'',waveformPeaksJson:'',videoFrameIndexJson:''};
 if(command==='get_source_list_entry_command') return fixture.find(s=>s.id===args.sourceId);
 if(command==='get_postgres_experiment_auth_status_command') return {authenticated:false};
 if(command==='delete_postgres_experiment_source_command') {window.fixture=fixture.filter(s=>s.id!==args.sourceId);return {};}
 if(command.includes('listen')) return 1;
 return [];
}};
const app=createRoot(document.getElementById('root'));window.renderSource=(props={})=>app.render(<I18nProvider initialLocale='en'><SourcesView projectId='project' currentUserId='user' canManageSources={true} canManageAnnotations={false} canManageCodes={false} onOpenPostgresMemoDraft={()=>{}} {...props}/></I18nProvider>); window.renderSource();`;
await buildBrowserFixture(root, entry);
const server = await serveBrowserFixture(root);
let session;
try {
  session = await startBrowser({ root });
  const { call, evaluate, until } = session;
  await session.navigate(server.url);
console.log('Waiting for list');await until('document.querySelectorAll(".case-list-row").length===50');
for (const codingEnabled of [false, true]) {
 await evaluate(`renderSource({codingEnabled:${codingEnabled}})`);
 const center=await evaluate(`(()=>{const column=document.querySelector('.sources-type-column').getBoundingClientRect(),card=document.querySelector('.sources-type-column > .content-card').getBoundingClientRect();return Math.abs((column.top+column.bottom-card.top-card.bottom)/2);})()`);
 assert.ok(center<2, 'Source type card must be vertically centered: '+center);
}
const scrollBounds=await evaluate(`(()=>{const w=document.querySelector('.table-card .data-table-wrap');w.scrollTop=1e8;return {bottom:w.getBoundingClientRect().bottom,last:w.querySelector('tbody tr:last-child').getBoundingClientRect().bottom,viewport:innerHeight};})()`);
assert.ok(scrollBounds.last<=scrollBounds.bottom+2 && scrollBounds.bottom<=scrollBounds.viewport,JSON.stringify(scrollBounds));
const initial=await evaluate('calls.map(c=>c.command).filter(c=>!c.includes("auth_status"))');assert.equal(initial.filter(c=>c==='list_source_page_command').length,1);assert.ok(!initial.some(c=>/annotations|relationships|objects_command|memos|sources_command/.test(c)));
assert.ok((await evaluate('document.body.innerText')).includes('123'));
await evaluate(`document.querySelector('button[aria-label="Next page"]').click()`);await until('document.querySelector(".case-list-row")?.innerText.includes("Source 050")');
await evaluate('document.querySelector(".case-list-row").click()');await until('document.body.innerText.includes("Selected text")');
// Closing the viewer retains the current list page; paging does not load content.
await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>/back/i.test(b.textContent+' '+b.getAttribute('aria-label'))).click()`);
await until('document.querySelector(".case-list-row")?.innerText.includes("Source 050")');
const detailCalls=await evaluate('calls.filter(c=>c.command==="get_source_details_command").length');
await evaluate(`document.querySelector('button[aria-label="Next page"]').click()`);await until('document.querySelector(".case-list-row")?.innerText.includes("Source 100")');assert.equal(await evaluate('calls.filter(c=>c.command==="get_source_details_command").length'),detailCalls);
// Search covers sources not present on the current page.
await evaluate(`(()=>{const i=document.querySelector('input[aria-label=Search]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'hidden text');i.dispatchEvent(new Event('input',{bubbles:true}));})()`);await until('document.querySelectorAll(".case-list-row").length===1');assert.ok((await evaluate('document.querySelector(".case-list-row").innerText')).includes('Source 121'));
await evaluate(`renderSource({initialSourceId:'s5'})`);await until('calls.some(c=>c.command==="get_source_details_command"&&c.args.sourceId==="s5")');await until('document.body.innerText.includes("Selected text")');
// Delete the selected off-page source, then verify the list refresh and global count.
await evaluate(`document.querySelector('button[aria-label="Delete Source"]').click()`);
await until(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Delete')`);
await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Delete').click()`);
await until(`calls.some(c=>c.command==='delete_postgres_experiment_source_command')`);
await until(`document.querySelector('input[aria-label=Search]')!==null`);
await evaluate(`(()=>{const i=document.querySelector('input[aria-label=Search]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'');i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
await until(`document.querySelectorAll('.case-list-row').length===50 && document.body.innerText.includes('122')`);
// The matrix requests the full set, including rows beyond the list page.
await evaluate(`Array.from(document.querySelectorAll('[role=tab]')).find(b=>b.textContent==='Attributes').click()`);
await until(`calls.some(c=>c.command==='list_source_page_command'&&c.args.request.all===true)`);
assert.equal(await evaluate(`calls.filter(c=>c.command==='list_source_page_command').at(-1).args.request.all`),true);
console.log(JSON.stringify({initialRequests:initial,checks:['50-row page','project-wide count','page navigation','closing viewer preserves page','no content refetch on page change','off-page content search','off-page deep link','delete refresh and counts','full attribute-matrix scope']},null,2));
await writeFile(path.join(root,'results.json'),JSON.stringify({initialRequests:initial,passed:true},null,2));
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
await checkLeftScroll();

} finally {
  await session?.close();
  await server.close();
}
