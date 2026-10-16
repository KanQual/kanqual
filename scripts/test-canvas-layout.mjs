import assert from 'node:assert/strict';
import { createTestRoot, buildBrowserFixture, serveBrowserFixture, startBrowser } from './browser-test-harness.mjs';
const root = await createTestRoot('canvas-layout-');
await buildBrowserFixture(root, `
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import cytoscape from 'cytoscape';
import {computeCanvasNetworkLayout} from './src/lib/canvasNetworkLayout';
import {canvasLayoutGroups,DEFAULT_CANVAS_LAYOUT_SETTINGS} from './src/lib/canvasLayoutSettings';
import {ExploreCanvasView} from './src/views/Explore_Canvas_View';
import {I18nProvider} from './src/i18n/provider';
import './src/App.css';
const states=Object.fromEntries(Array.from({length:140},(_,i)=>[String(i),{id:String(i),x:i*500,y:i*300,width:80+i%3*40,height:50}]));
window.initialNodes=JSON.stringify(states);
window.check=()=>{
 const cy=cytoscape({headless:true,styleEnabled:true,style:[{selector:'node',style:{width:'data(width)',height:50}}],elements:[
 ...Object.values(states).map(n=>({data:{id:n.id,width:n.width},position:{x:n.x,y:n.y}})),
 ...Array.from({length:120},(_,i)=>({data:{id:'edge'+i,source:String(i),target:String((i+1)%120)}})),
 {data:{id:'loop',source:'0',target:'0'}},{data:{id:'parallel',source:'0',target:'1'}}]});
 const before=JSON.stringify(cy.json());
 const start=performance.now();const next=computeCanvasNetworkLayout(cy,states);
 const result={ms:performance.now()-start,count:Object.keys(next).length,
 finite:Object.values(next).every(n=>Number.isFinite(n.x)&&Number.isFinite(n.y)),
 sizes:Object.values(next).every(n=>n.width===states[n.id].width&&n.height===states[n.id].height),
 unchanged:before===JSON.stringify(cy.json()),unique:new Set(Object.values(next).map(n=>n.x+','+n.y)).size};
 const groups=Object.fromEntries(Object.keys(states).map((id,i)=>[id,String(i%3)]));
 result.grouped=[];
 for(const spacing of ["compact","spread"]) {
  const grouped=computeCanvasNetworkLayout(cy,states,{...DEFAULT_CANVAS_LAYOUT_SETTINGS,spacing,includeLabels:false,groupPadding:80,groupRepulsion:2,groupGravity:1.5,nodeRepulsion:9000,edgeLength:150,edgeElasticity:0.3,iterations:3000},groups);
  result.grouped.push(Object.values(grouped).every(n=>Number.isFinite(n.x)&&Number.isFinite(n.y)));
 }
 const pinnedStates={...states,'0':{...states['0'],pinned:true},'1':{...states['1'],pinned:true}};
 const pinnedLayout=computeCanvasNetworkLayout(cy,pinnedStates,DEFAULT_CANVAS_LAYOUT_SETTINGS,groups);
 result.pins=JSON.stringify(pinnedLayout['0'])===JSON.stringify(pinnedStates['0'])&&JSON.stringify(pinnedLayout['1'])===JSON.stringify(pinnedStates['1']);
 result.keys=canvasLayoutGroups([{id:'a',kind:'Source',type:'Text',attributes:[{name:'Place',value:'Town'}]},
 {id:'b',kind:'Object',type:'Person',attributes:[]},{id:'c',kind:'Object',type:'Person',attributes:[]}],'attribute:Place');
 cy.destroy();
 const empty=cytoscape({headless:true});result.empty=computeCanvasNetworkLayout(empty,{}) ;empty.destroy();
 const single=cytoscape({headless:true,styleEnabled:true,elements:[{data:{id:'0'}}]});result.single=computeCanvasNetworkLayout(single,{'0':states['0']});single.destroy();
 return result;
};
const objects=Object.values(states).slice(0,140).map(n=>({id:n.id,title:'Object '+n.id,objectTypeId:'type',objectType:'Person',attributeValues:[{attributeName:'Neighborhood',value:Number(n.id)%2?'North':'South'}]}));
const dimensions=(_o,_t,n)=>n||{width:80,height:50};
function App(){const [nodes,setNodes]=useState(Object.fromEntries(objects.map(o=>[o.id,states[o.id]])));window.currentNodes=nodes;window.setNodes=setNodes;const [refresh,setRefresh]=useState(0);window.refreshLayout=()=>setRefresh(value=>value+1);const [reload,setReload]=useState(0);window.reloadGraph=()=>setReload(value=>value+1);
return <I18nProvider initialLocale="en"><ExploreCanvasView embedded autoLayoutOnVisibleKey={refresh} fitOnVisibleKey={reload} objects={objects} objectTypes={[]} relationships={Array.from({length:130},(_,i)=>({id:i===0?'rel':'r'+i,fromObjectId:String(i),toObjectId:String((i+1)%130),relationshipType:'Knows',attributeValues:[]}))} relationshipTypes={[]}
 controlLead={<button title="Add" className="btn">+</button>}
 controlStart={<button title="Filter" className="btn">Filter</button>}
 itemSizeControls={<input aria-label="Test item size" type="range" min={10} max={300} value={nodes['0'].width} onChange={e=>setNodes(current=>({...current,'0':{...current['0'],width:Number(e.target.value)}}))}/>}
 canvasNodes={nodes} setCanvasNodes={setNodes} hiddenCanvasRelationshipIds={[]}
 getObjectAppearance={()=>({color:'#b04a33',fill:'filled',shape:'rectangle'})}
 getObjectSurfaceStyle={()=>({background:'#b04a33',boxShadow:'none',edgeColor:'#333',textColor:'#fff'})}
 getRelationshipAppearance={()=>({color:'#333',lineWeight:1,lineShape:'solid',arrowhead:'none'})}
 getRelationshipStrokeWidth={()=>1} getNodeDefaultDimensions={dimensions} getNodeRenderedDimensions={dimensions}/></I18nProvider>}
document.body.innerHTML='<div id="root" style="height:100dvh;display:flex"></div>';createRoot(document.getElementById('root')).render(<App/>);
`);
const server=await serveBrowserFixture(root);let session;
try {
 session=await startBrowser({root});await session.navigate(server.url);
 const {evaluate,until}=session;
 await until('typeof window.check === "function" && !!document.querySelector("button[title=\\"Auto layout\\"]")');
 assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('.graph-canvas-canvas-controls button')).map(button=>button.title)`),['Add','Auto layout','Graph settings','Filter','Zoom','Fit canvas','Export graph']);
 await until(`JSON.stringify(currentNodes)!==initialNodes && !!document.querySelector('button[title="Auto layout"]')`);
 const result=await evaluate('check()');
 assert(result.pins);assert(result.grouped.every(Boolean));assert.equal(result.keys.b,result.keys.c);assert.notEqual(result.keys.a,result.keys.b);assert.equal(result.count,140);assert(result.finite&&result.sizes&&result.unchanged);assert.equal(result.unique,140);assert.deepEqual(result.empty,{});assert(Number.isFinite(result.single['0'].x));
 await evaluate('window.before=JSON.stringify(currentNodes);document.querySelector("button[title=\\"Auto layout\\"]").click()');
 await until('JSON.stringify(currentNodes)!==before');
 assert.equal(await evaluate('document.querySelectorAll("button[title=Flow],button[title=Network]").length'),0);
 await evaluate('document.querySelector("button[title=\\"Graph settings\\"]").click()');
 await until('!!document.querySelector(".graph-settings-card")');
 assert.equal(await evaluate('document.querySelector(".graph-settings-card select").value'),'type');
 assert.equal(await evaluate('document.querySelectorAll(".graph-settings-card input[type=checkbox]").length'),1);
 await evaluate(`document.querySelector('button[title=Zoom]').click();`);
 await until('!!document.querySelector("#graph-canvas-zoom-slider")');
 await evaluate(`var slider=document.querySelector('#graph-canvas-zoom-slider');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(slider,'100');slider.dispatchEvent(new Event('input',{bubbles:true}));`);
 await until('document.querySelector(".graph-canvas-zoom-menu strong").textContent==="100%"');
 await evaluate('document.querySelector(".graph-canvas-zoom-fit-btn").click()');
 await evaluate(`document.querySelector('.graph-settings-section summary').click();var slider=document.querySelector('input[aria-label="Test item size"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(slider,'120');slider.dispatchEvent(new Event('input',{bubbles:true}));`);
 await until('currentNodes["0"].width===120');

 assert.equal(await evaluate('document.querySelectorAll(".graph-settings-card optgroup option").length'),1);
 await evaluate(`window.before=JSON.stringify(currentNodes);const selects=document.querySelectorAll('.graph-settings-card select');
 selects[0].value='attribute:Neighborhood';selects[0].dispatchEvent(new Event('change',{bubbles:true}));
 selects[1].value='spread';selects[1].dispatchEvent(new Event('change',{bubbles:true}));
 document.querySelector('.graph-settings-card input[type=checkbox]').click();
`);
 await evaluate('document.querySelector(".graph-settings-advanced summary").click()');
 assert.equal(await evaluate('document.querySelectorAll(".graph-settings-advanced input[type=range]").length'),7);
 await evaluate(`var input=document.querySelector('.graph-settings-advanced input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'80');input.dispatchEvent(new Event('input',{bubbles:true}));`);
 await until('document.querySelector(".graph-settings-advanced output").textContent==="80"');
 await evaluate('document.querySelector(".graph-settings-reset").click()');
 await until('document.querySelector(".graph-settings-advanced output").textContent==="40"');
 assert.equal(await evaluate('document.querySelector(".graph-settings-card select").value'),'attribute:Neighborhood');
 await evaluate(`var input=document.querySelector('.graph-settings-advanced input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'100');input.dispatchEvent(new Event('input',{bubbles:true}));`);
 await until('document.querySelector(".graph-settings-advanced output").textContent==="100"');
 assert(await evaluate('JSON.stringify(currentNodes)===before'));
 await evaluate('document.querySelector(".graph-settings-apply").click()');
 await until('!document.querySelector(".graph-settings-card") && JSON.stringify(currentNodes)!==before');
 await evaluate('document.querySelector("button[title=\\"Graph settings\\"]").click()');
 await until('!!document.querySelector(".graph-settings-card")');
 assert.equal(await evaluate('document.querySelector(".graph-settings-advanced output").textContent'),'100');
 await evaluate('document.querySelector(".graph-settings-advanced summary").click()');
 for(const [width,height] of [[600,500],[420,400]]) {
  await session.call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
  await until(`(()=>{const r=document.querySelector('.graph-settings-card').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight})()`);
 }
 await evaluate('document.body.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}))');
 await until('!document.querySelector(".graph-settings-card")');
 await session.call('Emulation.setDeviceMetricsOverride',{width:1100,height:800,deviceScaleFactor:1,mobile:false});
 for(const scale of [0.1,0.5,1,2,3]) {
  await evaluate(`setNodes(current=>({...current,'0':{...current['0'],width:80*${scale},height:50*${scale}}}));void 0`);
  await until(`Math.abs(document.querySelector('.graph-canvas-canvas-surface')._cyreg.cy.getElementById('0').numericStyle('font-size')-${14}*${scale})<0.001`);
  const metrics=await evaluate(`(()=>{const n=document.querySelector('.graph-canvas-canvas-surface')._cyreg.cy.getElementById('0');return {font:n.numericStyle('font-size'),width:n.numericStyle('text-max-width'),nodeWidth:n.width()}})()`);
  assert(metrics.width<=metrics.nodeWidth);
 }
 await evaluate(`setNodes(current=>Object.fromEntries(Object.entries(current).map(([id,n])=>[id,{...n,x:n.x+50000,y:n.y+40000}])));void 0`);
 await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
 await evaluate(`window.graph=document.querySelector('.graph-canvas-canvas-surface')._cyreg.cy;graph.getElementById('0').emit('tap');void 0`);
 await until('!!document.querySelector(".graph-canvas-pin-button")');
 await evaluate('document.querySelector(".graph-canvas-pin-button").click()');
 await until('currentNodes["0"].pinned===true');
 await evaluate(`graph.getElementById('rel').emit('tap');void 0`);
 await until('document.querySelector(".graph-canvas-pin-button").title.includes("both endpoints")');
 await evaluate('document.querySelector(".graph-canvas-pin-button").click()');
 await until('currentNodes["0"].pinned && currentNodes["1"].pinned');
 await evaluate('graph.fit();void 0');
 await until('document.querySelectorAll("[data-pin-kind=node]").length===2 && document.querySelectorAll("[data-pin-kind=edge]").length===1');
 assert.equal(await evaluate('document.querySelector("[data-pin-kind=edge]").title'),'Both endpoints pinned');
 const pinnedBefore=await evaluate('[currentNodes["0"],currentNodes["1"]]');
 const settled=()=>evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');
 const snapshot=()=>evaluate(`({zoom:graph.zoom(),pan:graph.pan(),positions:['0','1'].map(id=>graph.getElementById(id).renderedPosition())})`);
 const measurements=[];
 for(const zoom of [1,0.001]) {
  await evaluate(`graph.minZoom(0.0001);graph.zoom(${zoom});graph.pan({x:100-graph.getElementById('0').position().x*graph.zoom(),y:100-graph.getElementById('0').position().y*graph.zoom()});void 0`);
  await settled();
  const screenBefore=await snapshot();
  for(const mode of ['Network','Refresh']) {
   if(mode==='Refresh') await evaluate('refreshLayout()');
   else {
    await evaluate('document.querySelector("button[title=\\"Auto layout\\"]").click()');
   }
   await until('!!document.querySelector("button[title=\\"Auto layout\\"]:not(:disabled)") && !document.querySelector("button[title=Network]")');
   await settled();
   assert.deepEqual(await evaluate('[currentNodes["0"],currentNodes["1"]]'),pinnedBefore);
   assert.deepEqual(await snapshot(),screenBefore,mode+' must preserve pinned screen positions and viewport');
   await until(`!!document.querySelector('[data-pin-kind="node"][data-pin-id="0"]')`);
   assert.equal(await evaluate(`document.querySelector('[data-pin-kind="node"][data-pin-id="0"]').getBoundingClientRect().width`),20);
   measurements.push({mode,zoom,screen:await snapshot()});
  }
 }
 // Reload/view entry must fit every item, even though layout keeps pins fixed.
 await evaluate('reloadGraph()');
 await until(`(()=>{const b=graph.elements().renderedBoundingBox();return b.x1>=35&&b.y1>=35&&b.x2<=graph.width()-35&&b.y2<=graph.height()-35})()`);
 assert.deepEqual(await evaluate('[currentNodes["0"],currentNodes["1"]]'),pinnedBefore);
 console.log('Pinned screen-position regression:',JSON.stringify(measurements));
 await evaluate('document.querySelector(".graph-canvas-pin-button").click()');
 await until('!currentNodes["0"].pinned && !currentNodes["1"].pinned');
 await until('document.querySelectorAll(".graph-canvas-pin-badge").length===0');
 console.log('Direct Network action and settings passed; 140-node network:',result);
}finally{await session?.close();await server.close();}
