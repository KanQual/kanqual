import { createTestRoot, buildBrowserFixture, serveBrowserFixture, startBrowser, delay } from "./browser-test-harness.mjs";
import assert from 'node:assert/strict';
const root = await createTestRoot('list-return-test-');
const entry=`import {ListVisitCacheProvider} from "./src/lib/listVisitCache"; import React from 'react'; import {createRoot} from 'react-dom/client'; import {SourcesView} from './src/views/Sources_View'; import { I18nProvider } from './src/i18n/provider';
window.calls=[]; window.fixture=Array.from({length:123},(_,i)=>({id:'s'+i,projectId:'project',sourceKind:i===122?'video':'text',title:'Source '+String(i).padStart(3,'0'),notes:'',storagePath:'',originalFileName:'',createdAt:'2026-01-01',updatedAt:'2026-01-01',hasTextContent:true,hasStructuredContent:false,annotationCount:0,objectCount:0}));
window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
window.__TAURI_INTERNALS__={transformCallback:()=>0,convertFileSrc:p=>p,invoke:async(command,args)=>{
 window.calls.push({command,args});
 if(command==='list_source_page_command') { if(window.deferPages)await new Promise(resolve=>(window.pendingPages??=[]).push(resolve)); const r=args.request; const scope=fixture.filter(s=>!r.query||s.title.toLowerCase().includes(r.query.toLowerCase())||(r.query==='hidden text'&&s.id==='s121')); const kinds=['text','video'].map(sourceKind=>({sourceKind,count:scope.filter(s=>s.sourceKind===sourceKind).length})); let rows=scope.filter(s=>!r.kind||s.sourceKind===r.kind); rows.sort((a,b)=>a.title.localeCompare(b.title)*(r.descending?-1:1));const offset=r.all?0:Math.min(r.offset,Math.floor(Math.max(0,rows.length-1)/50)*50);return {sources:r.all?rows:rows.slice(offset,offset+50),kinds,total:rows.length,offset,storagePath:''}; }
 if(command==='get_source_details_command') return {...fixture.find(s=>s.id===args.sourceId),textContent:'Selected text',structuredContentJson:'',waveformPeaksJson:'',videoFrameIndexJson:''};
 if(command==='get_source_list_entry_command') return fixture.find(s=>s.id===args.sourceId);
 if(command==='get_postgres_experiment_auth_status_command') return {authenticated:false};
 if(command==='delete_postgres_experiment_source_command') {window.fixture=fixture.filter(s=>s.id!==args.sourceId);return {};}
 if(command.includes('listen')) return 1;
 return [];
}};
const app=createRoot(document.getElementById('root'));window.renderSource=(props={})=>app.render(<ListVisitCacheProvider projectId="project"><I18nProvider initialLocale='en'><SourcesView key={window.visitKey??0} projectId='project' currentUserId='user' canManageSources={true} canManageAnnotations={false} canManageCodes={false} onOpenPostgresMemoDraft={()=>{}} {...props}/></I18nProvider></ListVisitCacheProvider>); window.renderSource();`;
await buildBrowserFixture(root, entry);
const server = await serveBrowserFixture(root);
let session;
try {
  session = await startBrowser({ root });
  const { evaluate, until } = session;
  await session.navigate(server.url);
await until(`document.querySelectorAll('.case-list-row').length===50`);
await evaluate(`document.querySelector('button[aria-label="Next page"]').click()`);await until(`document.querySelector('.case-list-row').innerText.includes('Source 050')`);
await evaluate(`window.deferPages=true;window.visitKey=1;renderSource()`);
await until(`window.pendingPages?.length===1`);
assert.ok(await evaluate(`document.querySelector('.case-list-row')?.innerText.includes('Source 050')`));
assert.equal(await evaluate(`document.querySelector('.table-pagination-counter').textContent`),'2 / 3');
await delay(350);assert.equal(await evaluate(`pendingPages.length`),1);
await evaluate(`fixture[50].title='Source 050 updated';pendingPages.shift()()`);await until(`document.body.innerText.includes('Source 050 updated')`);
console.log(JSON.stringify({passed:true,checks:['cached Sources page renders while fresh request is pending','page counter restored','search debounce does not reset restored page','background refresh applies changed records']},null,2));

} finally {
  await session?.close();
  await server.close();
}
