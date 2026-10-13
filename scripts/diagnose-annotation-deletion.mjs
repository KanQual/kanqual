import { createTestRoot, buildBrowserFixture, serveBrowserFixture, startBrowser, delay } from "./browser-test-harness.mjs";
import assert from 'node:assert/strict';
const root = await createTestRoot('deletion-diagnostic-');
const entry=`import React from 'react'; import {createRoot} from 'react-dom/client'; import {SourcesView} from './src/views/Sources_View'; import { I18nProvider } from './src/i18n/provider';
const nativeInterval=window.setInterval;window.setInterval=(fn,ms,...args)=>{if(ms===15000)window.lockHeartbeat=fn;return nativeInterval(fn,ms,...args)};window.lockRequests=[]; window.calls=[]; window.fixture=Array.from({length:123},(_,i)=>({id:'s'+i,projectId:'project',sourceKind:i===122?'video':'text',title:'Source '+String(i).padStart(3,'0'),notes:'',storagePath:'',originalFileName:'',createdAt:'2026-01-01',updatedAt:'2026-01-01',hasTextContent:true,hasStructuredContent:false,annotationCount:i===0?1:0,objectCount:0}));
window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
window.__TAURI_INTERNALS__={transformCallback:()=>0,convertFileSrc:p=>p,invoke:async(command,args)=>{
 window.calls.push({command,args});
 if(command==='get_source_details_command'&&window.deleted)await new Promise(resolve=>setTimeout(resolve,50));
 if(command==='list_postgres_experiment_annotation_summaries_command')return window.deleted?[]:[{id:'a1',sourceId:'s0',codeIds:['c1'],primaryCodeLabel:'Example',quote:'Selected',note:'',anchorKind:'text_span',startOffset:0,endOffset:8,createdAt:'2026-01-01',createdByName:'Tester'}];
 if(command==='list_postgres_experiment_codes_command')return [{id:'c1',label:'Example',color:'#355070',parentCodeId:null,description:'',createdAt:'2026-01-01'}];
 if(command==='delete_postgres_experiment_annotation_command'){window.deleted=true;return;}

 if(command==='acquire_postgres_experiment_source_lock_command')return new Promise((resolve,reject)=>lockRequests.push({resolve,reject,args}));
 if(command==='list_source_page_command') { const r=args.request; const scope=fixture.filter(s=>!r.query||s.title.toLowerCase().includes(r.query.toLowerCase())||(r.query==='hidden text'&&s.id==='s121')); const kinds=['text','video'].map(sourceKind=>({sourceKind,count:scope.filter(s=>s.sourceKind===sourceKind).length})); let rows=scope.filter(s=>!r.kind||s.sourceKind===r.kind); rows.sort((a,b)=>a.title.localeCompare(b.title)*(r.descending?-1:1));const offset=r.all?0:Math.min(r.offset,Math.floor(Math.max(0,rows.length-1)/50)*50);return {sources:r.all?rows:rows.slice(offset,offset+50),kinds,total:rows.length,offset,storagePath:''}; }
 if(command==='get_source_details_command') return {...fixture.find(s=>s.id===args.sourceId),textContent:'Selected text',structuredContentJson:'',waveformPeaksJson:'',videoFrameIndexJson:''};
 if(command==='get_source_list_entry_command') return fixture.find(s=>s.id===args.sourceId);
 if(command==='get_postgres_experiment_auth_status_command') return {authenticated:false};
 if(command==='delete_postgres_experiment_source_command') {window.fixture=fixture.filter(s=>s.id!==args.sourceId);return {};}
 if(command.includes('listen')) return 1;
 return [];
}};
const app=createRoot(document.getElementById('root'));window.renderSource=(props={})=>app.render(<I18nProvider initialLocale='en'><SourcesView projectId='project' currentUserId='user' canManageSources={true} textCodingMode={${JSON.stringify(process.argv.includes("--ai") ? "ai-assisted" : "manual")}} codingEnabled canManageAnnotations={true} canManageCodes={false} onOpenPostgresMemoDraft={()=>{}} {...props}/></I18nProvider>); window.renderSource();`;
await buildBrowserFixture(root, entry);
const server = await serveBrowserFixture(root);
let session;
try {
  session = await startBrowser({ root });
  const { evaluate, until } = session;
  await session.navigate(server.url);

await until(`document.querySelectorAll('.case-list-row').length===50`);
await evaluate(`document.querySelector('.case-list-row').click()`);
await until(`lockRequests.length===1`);
await evaluate(`lockRequests.shift().resolve({ok:true,lock:{id:'lock',sourceId:'s0',userId:'user'}})`);
await until(`!!document.querySelector('.annotation-highlight')`);
await evaluate(`window.originalViewer=document.querySelector('.doc-text');window.calls=[];document.querySelector('.annotation-highlight').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:700,clientY:300}))`);
await until(`!!document.querySelector('.context-menu-item--danger')`);
await evaluate(`document.querySelector('.context-menu-item--danger').click()`);
await until(`document.querySelectorAll('.annotation-highlight').length===0`);
await delay(100);
const during=await evaluate(`({originalViewerConnected:originalViewer.isConnected,codingVisible:!!document.querySelector('.doc-text'),waitingForLock:document.body.innerText.includes('Preparing coding workspace'),commands:calls.map(c=>c.command)})`);
assert.equal(during.originalViewerConnected,true);
assert.equal(during.codingVisible,true);
assert.equal(during.waitingForLock,false);
assert.deepEqual(during.commands,['delete_postgres_experiment_annotation_command']);
assert.ok(await evaluate(`document.body.innerText.includes('Annotations (0)')`));
await evaluate(`document.querySelector('.view-header-back-button').click()`);
await until(`document.querySelectorAll('.case-list-row').length===50`);
const row=await evaluate(`Array.from(document.querySelector('.case-list-row').cells).map(c=>c.textContent)`);
console.log(JSON.stringify({diagnostic:'Deletion preserves coding workspace and lock; updates annotations and source count',...during,sourceRow:row},null,2));

} finally {
  await session?.close();
  await server.close();
}
