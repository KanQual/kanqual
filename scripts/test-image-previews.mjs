import { createTestRoot, buildBrowserFixture, startTestServer, startBrowser, browserMemory, delay } from "./browser-test-harness.mjs";
// Actual React preview hooks against synthetic native-generated image fixtures.
// Requires Chrome and Python/psutil. Never opens an application project.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
const exec=promisify(execFile);
const root=process.env.KANQUAL_IMAGE_TEST_ROOT || await createTestRoot('image-preview-test-');
console.log('Generating 24 large originals and native thumbnails...');
const native=process.env.KANQUAL_IMAGE_TEST_ROOT ? {stdout:'Reusing generated fixtures'} : await exec('cargo',['test','--offline','--manifest-path','src-tauri/Cargo.toml','image_previews::tests::generate_browser_fixtures','--lib','--','--ignored','--nocapture'],{env:{...process.env,KANQUAL_IMAGE_TEST_ROOT:root},windowsHide:true,maxBuffer:2000000});
console.log(native.stdout.trim());
const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import { usePostgresStoredImage } from './src/lib/postgresStoredImages';
import {ExploreCanvasView} from './src/views/Explore_Canvas_View';import { I18nProvider } from './src/i18n/provider';
import {openImagePreview,openOriginalImage} from './src/lib/imagePreviews';import { releaseMediaUrl } from './src/lib/mediaStream';
window.stats={opened:0,closed:0,active:0,maxActive:0,inFlight:0,maxInFlight:0};let serial=0;const live=new Set();const callbacks=new Map();window.callbacks=callbacks;
window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};window.__TAURI_INTERNALS__={transformCallback:fn=>{const id=++serial;callbacks.set(id,fn);return id},invoke:async(command,args)=>{
 if(command==='open_image_stream_command'){if(args.size==null)stats.originals=(stats.originals||0)+1;stats.inFlight++;stats.maxInFlight=Math.max(stats.maxInFlight,stats.inFlight);await new Promise(r=>setTimeout(r,15));const name=args.path.split(/[\\\\/]/).pop().replace('.jpg','');const url=location.origin+'/'+(args.size==null?'original/':'preview/')+name+(args.size==null?'.jpg':'.png')+'?grant='+ ++serial;stats.inFlight--;stats.opened++;stats.active++;stats.maxActive=Math.max(stats.maxActive,stats.active);live.add(url);return url;}
 if(command==='plugin:dialog|save')return 'export.png';if(command==='plugin:fs|write_file'){window.exported=true;return;}
 if(command==='close_media_stream_command'&&live.delete(args.url)){stats.closed++;stats.active--;}
 return 1;
}};
function Preview({index}){const {url,ref}=usePostgresStoredImage('C:/fixture',index+'.jpg',384);return <div ref={ref} style={{height:230,width:330,marginBottom:10}}>{url?<img src={url} style={{width:320,height:220,objectFit:'contain'}}/>:null}</div>}
const app=createRoot(document.getElementById('root'));window.start=async mode=>{if(mode==='preview'){app.render(<>{Array.from({length:24},(_,index)=><Preview key={index} index={index}/>)}</>);return;}window.legacyUrls=[];await Promise.all(Array.from({length:24},async(_,i)=>{const bytes=new Uint8Array(await(await fetch('/original/'+i+'.jpg')).arrayBuffer());const url=URL.createObjectURL(new Blob([bytes],{type:'image/jpeg'}));legacyUrls.push(url);const image=new Image();image.style='height:220px;width:320px;display:block;margin-bottom:20px;object-fit:contain';document.getElementById('root').append(image);await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=url;});}));};
window.renderGraph=(count=96)=>{const objects=Array.from({length:count},(_,i)=>({id:String(i),title:'Image '+i,objectTypeId:'',attributeValues:[]}));const nodes=Object.fromEntries(objects.map((o,i)=>[o.id,{id:o.id,x:(i%12)*160,y:Math.floor(i/12)*120,width:count===2?400:120,height:count===2?300:90}]));app.render(<I18nProvider initialLocale='en'><ExploreCanvasView objectTypes={[]} objects={objects} relationships={[]} relationshipTypes={[]} canvasNodes={nodes} setCanvasNodes={()=>{}} hiddenCanvasRelationshipIds={[]} getObjectAppearance={o=>({shape:'rectangle',color:'#ccc',fill:'outline',outlineWidth:1,sourceImagePath:'C:/fixture/'+(Number(o.id)%24)+'.jpg'})} getObjectSurfaceStyle={()=>({background:'#fff',boxShadow:'',edgeColor:'#111',textColor:'#111'})} getRelationshipAppearance={()=>({})} getRelationshipStrokeWidth={()=>1} getNodeDefaultDimensions={()=>({width:120,height:90})} getNodeRenderedDimensions={(o,t,node)=>({width:node.width,height:node.height})} getRelationshipEndpointKey={(type,id)=>type+':'+id}/></I18nProvider>)};
window.closeImages=()=>{app.render(null);for(const url of window.legacyUrls||[])URL.revokeObjectURL(url);window.legacyUrls=[];};
window.orientation=async()=>{const original=await openOriginalImage('C:/fixture/oriented.jpg');const thumbnail=await openImagePreview('C:/fixture/oriented.jpg',128);try{const load=src=>new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=reject;i.src=src;});const a=await load(original),b=await load(thumbnail);const sample=image=>{const c=document.createElement('canvas');c.width=40;c.height=80;const ctx=c.getContext('2d');ctx.drawImage(image,0,0,40,80);return Array.from(ctx.getImageData(8,16,1,1).data)};return {original:[a.naturalWidth,a.naturalHeight],preview:[b.naturalWidth,b.naturalHeight],a:sample(a),b:sample(b)};}finally{releaseMediaUrl(original);releaseMediaUrl(thumbnail)}};
`;
await buildBrowserFixture(root, entry);
let transferred=0;const server=await startTestServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');if(url.pathname==='/'){res.setHeader('Content-Type','text/html');res.end('<style>.graph-canvas-canvas-surface{width:800px;height:600px}</style><div id="root"></div><script type="module" src="/app.js"></script>');return;}if(url.pathname==='/favicon.ico'){res.statusCode=204;res.end();return;}const safe=/^\/(original|preview)\/(\d+|oriented)\.(jpg|png)$/.test(url.pathname)||url.pathname==='/app.js';if(!safe){res.statusCode=404;res.end();return;}const bytes=await readFile(path.join(root,url.pathname.slice(1)));if(url.pathname!=='/app.js')transferred+=bytes.length;res.setHeader('Content-Type',url.pathname.endsWith('.js')?'text/javascript':url.pathname.endsWith('.jpg')?'image/jpeg':'image/png');res.setHeader('Cache-Control','no-store');res.end(bytes);}catch{res.statusCode=404;res.end();}});
let session;const results=[];
try{for(const mode of ['legacy','preview']){
 session = await startBrowser({ root, width: 900, height: 800, timeout: 30000 });
 const { browser, call, evaluate } = session;
 const memory = () => browserMemory(browser);
 await session.navigate(server.url);for(let i=0;i<100&& !await evaluate("typeof start==='function'");i++)await delay(50);
 const baseline=await memory();transferred=0;const begin=performance.now();await evaluate('start('+JSON.stringify(mode)+')');for(let i=0;i<100&&!await evaluate("document.querySelectorAll('img').length>=3");i++)await delay(50);await delay(300);const readyMs=performance.now()-begin;const first=await memory();const firstBytes=transferred;
 if(mode==='preview'){
   assert.ok(await evaluate('stats.opened<10'),'Offscreen originals must not load');
   for(let i=0;i<30;i++){await evaluate('scrollTo(0,'+(i%2?'0':'document.body.scrollHeight')+')');await delay(300);}
   const stats=await evaluate('stats');assert.ok(stats.maxInFlight<=4);assert.ok(stats.maxActive<=12);assert.ok(stats.closed>0);
   const orientation=await evaluate('orientation()');assert.deepEqual(orientation.original,[40,80]);assert.deepEqual(orientation.preview,[40,80]);assert.ok(orientation.a.every((v,i)=>Math.abs(v-orientation.b[i])<=3),'Oriented pixels and crop coordinates must match');
   await call('HeapProfiler.collectGarbage');const navigated=await memory();await evaluate('closeImages()');for(let i=0;i<100&&await evaluate('stats.active!==0');i++)await delay(50);assert.equal(await evaluate('stats.active'),0);
   await evaluate('renderGraph(); scrollTo(0,0)');
   for(let i=0;i<100&&!await evaluate('stats.active>0');i++)await delay(100);
   await delay(1200);
   assert.ok(await evaluate('stats.active>0 && stats.active<=48'),'Graph previews must load within the viewport budget: '+JSON.stringify(await evaluate('({stats,body:document.body.innerText.slice(0,1500),canvas:!!document.querySelector(".graph-canvas-canvas-surface")})')));
   await evaluate(`window.graph=document.querySelector('.graph-canvas-canvas-surface')._cyreg.cy;true`);
   for(let i=0;i<8;i++){await evaluate('graph.zoom(1);graph.pan({x:'+ (i%2?0:-1000)+',y:0});true');await delay(300);}
   assert.ok(await evaluate('Object.keys(graph.renderer().imageCache||{}).filter(url=>url.startsWith("http:")).length<=48'),'Graph decoded image cache must remain bounded');
   await evaluate('renderGraph(2)');await delay(600);await evaluate(`window.graph=document.querySelector('.graph-canvas-canvas-surface')._cyreg.cy;true`);
   const originalCount=await evaluate('stats.originals||0');await evaluate('graph.zoom(12);graph.pan({x:0,y:0});true');
   for(let i=0;i<100&&await evaluate('(stats.originals||0)<='+originalCount);i++)await delay(100);
   assert.ok(await evaluate('(stats.originals||0)>'+originalCount),'Deep zoom must request originals');
   await evaluate('graph.zoom(1);graph.pan({x:0,y:0});true');await delay(400);
   await evaluate(`document.querySelector('button[aria-label="Export graph"]').click()`);
   await delay(100);
   await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Export PNG').click()`);
   for(let i=0;i<100&&!await evaluate('window.exported===true');i++)await delay(100);
   assert.equal(await evaluate('window.exported'),true,'Graph export must render original images');
   await evaluate('closeImages()');for(let i=0;i<100&&await evaluate('stats.active!==0');i++)await delay(50);assert.equal(await evaluate('stats.active'),0);
   results.push({mode,baseline,first,navigated,readyMs,firstBytes,stats,orientation,graphNavigation:true,graphExport:true,deepZoom:true});
 }else results.push({mode,baseline,first,readyMs,firstBytes});
 console.log(mode+' completed');await session.close();session=undefined;
}
 const report={native:JSON.parse(await readFile(path.join(root,'native.json'),'utf8')),browser:results};assert.ok(results[1].firstBytes<results[0].firstBytes/10);await writeFile(path.join(root,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));console.log('Results: '+root);
}finally{await session?.close();await server.close();}
