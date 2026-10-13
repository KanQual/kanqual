import { createTestRoot, buildBrowserFixture, serveBrowserFixture, startBrowser, delay } from "./browser-test-harness.mjs";
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const root = await createTestRoot('home-scroll-test-');
const entry=await readFile("scripts/fixtures/table-screen.tsx","utf8");
await buildBrowserFixture(root, entry);
const server = await serveBrowserFixture(root);
let session;
try {
  session = await startBrowser({ root });
  const { call, evaluate, until } = session;
  await session.navigate(server.url);
await until(`typeof renderScreen==='function'`);await evaluate(`renderScreen('home')`);await until(`document.querySelectorAll('.project-home-stats-grid .home-stat-card').length===8`);
const measurements=[];
for(const [width,height] of [[1400,600],[1150,600],[1000,600],[600,500]]) {
 await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await delay(150);
 const m=await evaluate(`(()=>{const stats=document.querySelector('.project-home-stats-grid');const dashboard=document.querySelector('.project-home-details-dashboard');const scroller=innerWidth<=1120?dashboard:stats;scroller.scrollTop=1e8;const last=stats.lastElementChild.getBoundingClientRect();return {width:innerWidth,height:innerHeight,scrollTop:scroller.scrollTop,clientHeight:scroller.clientHeight,scrollHeight:scroller.scrollHeight,bottom:scroller.getBoundingClientRect().bottom,lastBottom:last.bottom,lastRight:last.right}})()`);
 const point=await evaluate(`(()=>{const el=document.querySelector(innerWidth<=1120?'.project-home-details-dashboard':'.project-home-stats-grid');el.scrollTop=0;const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+Math.min(80,r.height/2)}})()`);
 await call('Input.dispatchMouseEvent',{type:'mouseWheel',...point,deltaX:0,deltaY:400});await delay(150);
 const wheelScroll=await evaluate(`document.querySelector(innerWidth<=1120?'.project-home-details-dashboard':'.project-home-stats-grid').scrollTop`);
 if(!process.env.HOME_SCROLL_BASELINE)assert.ok(wheelScroll>0,'Mouse wheel must scroll Home details');
 measurements.push({...m,wheelScroll});
 if(!process.env.HOME_SCROLL_BASELINE)assert.ok(m.scrollTop>0&&m.lastBottom<=m.height+1&&m.lastBottom<=m.bottom+1&&m.lastRight<=m.width+1,JSON.stringify(m));
}
console.log(JSON.stringify(measurements,null,2));

} finally {
  await session?.close();
  await server.close();
}

