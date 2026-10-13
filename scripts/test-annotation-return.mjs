import { createTestRoot, buildBrowserFixture, serveBrowserFixture, startBrowser, delay } from "./browser-test-harness.mjs";
import assert from 'node:assert/strict';
const root = await createTestRoot('annotation-return-test-');
const entry=`import {ListVisitCacheProvider} from "./src/lib/listVisitCache"; import React from 'react'; import {createRoot} from 'react-dom/client'; import {AnnotationsView} from './src/views/Project_Annotations_View'; import { I18nProvider } from './src/i18n/provider';
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
await buildBrowserFixture(root, entry);
const server = await serveBrowserFixture(root);
let session;
try {
  session = await startBrowser({ root });
  const { evaluate, until } = session;
  await session.navigate(server.url);
await until(`document.querySelectorAll('.annotations-list-row').length===50`);
await evaluate(`document.querySelector('button[aria-label="Next page"]').click()`);await until(`document.querySelector('.annotations-list-row').innerText.includes('A51')`);
await evaluate(`window.deferAnnotations=true;window.visitKey=1;renderAnnotations()`);await until(`window.pendingAnnotations?.length===1`);
assert.ok(await evaluate(`document.querySelector('.annotations-list-row')?.innerText.includes('A51')`));
assert.equal(await evaluate(`document.querySelector('.table-pagination-counter').textContent`),'2 / 3');
await delay(300);assert.equal(await evaluate(`pendingAnnotations.length`),1);
await evaluate(`pendingAnnotations.shift()()`);await delay(100);
console.log('Annotation repeat visit: cached rows and page restored while revalidation is pending');

} finally {
  await session?.close();
  await server.close();
}
