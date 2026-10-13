import { createTestRoot, buildBrowserFixture, serveBrowserFixture, startBrowser, delay } from "./browser-test-harness.mjs";
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const root = await createTestRoot('table-screen-test-');
const entry=await readFile("scripts/fixtures/table-screen.tsx","utf8");
await buildBrowserFixture(root, entry);
const server = await serveBrowserFixture(root);
let session;
try {
  session = await startBrowser({ root });
  const { call, evaluate, evaluateFunction, until } = session;
  await session.navigate(server.url);
const checks=[];
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
async function searchFor(value) { await evaluateFunction((arg0) => { (()=>{const input=document.querySelector('.sources-list-toolbar input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,arg0);input.dispatchEvent(new Event('input',{bubbles:true}));})(); }, value); }
async function checkSearch(value) {
 const geometry=await evaluate(`(()=>{const t=document.querySelector('.sources-list-toolbar'),i=t.querySelector('input').getBoundingClientRect(),p=t.querySelector('.table-pagination').getBoundingClientRect(),r=t.getBoundingClientRect();return {line:Math.abs((i.top+i.bottom-p.top-p.bottom)/2),center:Math.abs((p.left+p.right-r.left-r.right)/2)}})()`);
 assert.ok(geometry.line<2&&geometry.center<2,JSON.stringify(geometry));
 await searchFor(value);
 await until(`document.querySelector('.table-pagination-counter').innerText==='1 / 1' && document.querySelectorAll('.table-card .data-table-row').length===1`);
 await searchFor('No such item %_');await until(`document.querySelector('.table-pagination-counter').innerText==='0 / 0'`);
 await searchFor('');await until(`document.querySelector('.table-pagination-counter').innerText==='1 / 3'`);
}

async function listReady(n=50){await until(`document.querySelectorAll('.table-pagination').length>0 && document.querySelectorAll('.data-table-row').length>=${n}`);}
async function scrollCheck(){const m=await evaluate(`(()=>{const w=Array.from(document.querySelectorAll('.data-table-wrap')).find(e=>e.querySelectorAll('.data-table-row').length>=50);w.scrollTop=1e8;return {bottom:w.getBoundingClientRect().bottom,last:w.querySelector('tbody tr:last-child').getBoundingClientRect().bottom,viewport:innerHeight,height:w.clientHeight}})()`);assert.ok(m.height>40&&m.last<=m.bottom+2&&m.bottom<=m.viewport,JSON.stringify(m));}
await listReady();await checkSearch('Memo 122');assert.ok(!await evaluate(`calls.some(c=>c.command==='list_postgres_experiment_memos_command'||c.command==='list_postgres_experiment_annotation_summaries_command')`));await scrollCheck();
const paginationGeometry = await evaluate(`(()=>{const p=document.querySelector('.table-pagination');const buttons=p.querySelectorAll('button');const row=p.getBoundingClientRect(),first=buttons[0].getBoundingClientRect(),last=buttons[3].getBoundingClientRect();return {centerError:Math.abs((first.left+last.right)/2-(row.left+row.right)/2),labels:[...buttons].map(b=>b.getAttribute('aria-label')),icons:p.querySelectorAll('svg').length,firstDisabled:buttons[0].disabled,previousDisabled:buttons[1].disabled};})()`);
assert.ok(paginationGeometry.centerError<2,JSON.stringify(paginationGeometry));
assert.deepEqual(paginationGeometry.labels,['First page','Previous page','Next page','Last page']);
assert.equal(paginationGeometry.icons,4);assert.ok(paginationGeometry.firstDisabled && paginationGeometry.previousDisabled);
await evaluate(`document.querySelector('.table-pagination button[aria-label="Last page"]').click()`);
await until(`document.querySelector('.table-pagination-counter').innerText==='3 / 3' && document.querySelector('.table-pagination button[aria-label="Next page"]').disabled`);
assert.ok(await evaluate(`document.querySelector('.table-pagination button[aria-label="Last page"]').disabled`));
await evaluate(`document.querySelector('.table-pagination button[aria-label="Previous page"]').click()`);
await until(`document.querySelector('.table-pagination-counter').innerText==='2 / 3' && !document.querySelector('.table-pagination button[aria-label="First page"]').disabled`);
await evaluate(`document.querySelector('.table-pagination button[aria-label="First page"]').click()`);
await until(`document.querySelector('.table-pagination-counter').innerText==='1 / 3' && !document.querySelector('.table-pagination button[aria-label="Next page"]').disabled`);
checks.push('centered Lucide controls, first/previous/next/last and page boundaries');
await evaluate(`document.querySelector('.table-pagination button[aria-label="Next page"]').click()`);await until(`document.querySelector('.table-pagination span').innerText.startsWith('2 /')`);
await evaluate(`document.querySelector('.data-table-row').click()`);await until(`document.querySelector('.memo-builder-editor-view')!==null`);
assert.ok(await evaluate(`calls.some(c=>c.command==='list_postgres_experiment_annotation_summaries_command')`));await evaluate(`document.querySelector('.view-header-back-button').click()`);await until(`document.querySelector('.table-pagination span')?.innerText.startsWith('2 /')`);checks.push('memo server pages and lazy editor selectors');
await evaluate(`renderScreen('reports')`);await listReady();await checkSearch('Report 122');await checkLeftScroll();await scrollCheck();assert.ok(await evaluate(`document.querySelector('.table-pagination').innerText.includes('/ 3')`));
await evaluate(`Array.from(document.querySelectorAll('td[role=button]')).find(e=>e.textContent.toLowerCase().includes('co-occurrence')).click()`);await until(`document.querySelector('.table-pagination').innerText.includes('/ 2')`);await evaluate(`document.querySelector('.table-pagination button[aria-label="Next page"]').click()`);await until(`document.querySelectorAll('.table-card .data-table-row').length===10`);checks.push('report subtype filtering and global count');
await evaluate(`renderScreen('legacy')`);await listReady();await scrollCheck();await evaluate(`document.querySelector('.table-pagination button[aria-label="Next page"]').click()`);await until(`document.querySelector('.table-pagination span').innerText.startsWith('2 /')`);await evaluate(`document.querySelector('.data-table-header').click()`);await until(`document.querySelector('.table-pagination span').innerText.startsWith('1')`);checks.push('legacy report server sorting resets page');
for (const [screen,reportType,kind] of [['users-report','coder-report','activity'],['annotations-report','annotations','annotations']]) {
 await evaluateFunction((arg0, arg1, arg2, arg3) => { window.reports=reports.map(r=>({...r,reportType:arg0,contentJson:JSON.stringify({reportType:arg1,kind:arg2,filteredAnns:[],settings:{}})}));renderScreen(arg3); }, reportType, reportType, kind, screen);
 await listReady();await scrollCheck();await evaluate(`document.querySelector('.table-pagination button[aria-label="Next page"]').click()`);await until(`document.querySelector('.table-pagination span').innerText.startsWith('2 /')`);checks.push(screen);
}
await evaluate(`renderScreen('home')`);await until(`document.querySelector('.sidebar')!==null`);await delay(500);

await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Objects'||b.title==='Objects').click()`);await listReady();await scrollCheck();await evaluate(`document.querySelector('.table-pagination button[aria-label="Next page"]').click()`);await until(`document.querySelector('.table-pagination span').innerText.startsWith('2 /')`);await checkSearch('Object 122');await checkLeftScroll();checks.push('objects');
await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Relationships'||b.title==='Relationships').click()`);await listReady();await scrollCheck();await searchFor('Object 122');await until(`document.querySelector('.table-pagination-counter').innerText==='1 / 1' && document.querySelectorAll('.table-card .data-table-row').length===2`);await searchFor('');await until(`document.querySelector('.table-pagination-counter').innerText==='1 / 3'`);await checkLeftScroll();checks.push('relationships');
await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.title==='Users'||b.textContent.trim()==='Users').click()`);await listReady();await scrollCheck();await evaluate(`document.querySelector('.table-pagination button[aria-label="Next page"]').click()`);await until(`document.querySelector('.table-pagination span').innerText.startsWith('2 /')`);await checkLeftScroll();checks.push('users');
await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.title==='Objects'||b.textContent.trim()==='Objects').click()`);await listReady();
await until(`Array.from(document.querySelectorAll('td[role=button]')).some(e=>e.textContent.includes('People'))`);
await evaluate(`Array.from(document.querySelectorAll('td[role=button]')).find(e=>e.textContent.includes('People')).click()`);
await evaluate(`Array.from(document.querySelectorAll('[role=tab]')).find(e=>e.textContent.trim()==='Attributes').click()`);
await until(`document.querySelectorAll('.case-attributes-table tbody tr').length===50`);
await evaluate(`document.querySelector('.table-pagination button[aria-label="Next page"]').click()`);await until(`document.querySelector('.case-attributes-table tbody tr').innerText.includes('Object 050')`);checks.push('object attributes');
await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.title==='Relationships'||b.textContent.trim()==='Relationships').click()`);await listReady();
await until(`Array.from(document.querySelectorAll('td[role=button]')).some(e=>e.textContent.includes('Knows'))`);
await evaluate(`Array.from(document.querySelectorAll('td[role=button]')).find(e=>e.textContent.includes('Knows')).click()`);
await evaluate(`Array.from(document.querySelectorAll('[role=tab]')).find(e=>e.textContent.trim()==='Attributes').click()`);
await until(`document.querySelectorAll('.case-attributes-table tbody tr').length===50`);await evaluate(`document.querySelector('.table-pagination button[aria-label="Next page"]').click()`);await until(`document.querySelector('.table-pagination span').innerText.startsWith('2 /')`);checks.push('relationship attributes');
await evaluate(`calls=[];renderScreen('codebook')`);await listReady();assert.deepEqual(await evaluate(`calls.map(c=>c.command).filter(c=>!c.startsWith('plugin:')&&!c.includes('auth_status'))`),['get_codebook_summary_command']);await scrollCheck();await evaluate(`document.querySelector('.code-collapse-btn').click()`);await checkSearch('Code 122');checks.push('codebook pagination and search through nested codes');
for (const width of [1400, 900, 600, 400]) {
 await call('Emulation.setDeviceMetricsOverride',{width,height:700,deviceScaleFactor:1,mobile:false});
 const bounds=await evaluate(`(()=>{document.querySelector('.code-tree-label').textContent='Very long code name '.repeat(40);const shell=document.querySelector('.codebook-table-shell'),card=document.querySelector('.codebook-table-card'),wrap=document.querySelector('.codebook-table-wrap'),table=wrap.querySelector('table'),label=wrap.querySelector('.code-tree-label');return {shell:shell.clientWidth,card:card.getBoundingClientRect().width,wrap:wrap.clientWidth,scroll:wrap.scrollWidth,table:table.getBoundingClientRect().width,label:label.clientWidth,labelScroll:label.scrollWidth,ellipsis:getComputedStyle(label).textOverflow};})()`);
 assert.ok(Math.abs(bounds.shell-bounds.card)<3,JSON.stringify({width,...bounds}));
 assert.ok(Math.abs(bounds.table-bounds.wrap)<3 && bounds.scroll<=bounds.wrap+1,JSON.stringify({width,...bounds}));
 assert.ok(bounds.labelScroll>bounds.label && bounds.ellipsis==='ellipsis',JSON.stringify(bounds));
}
checks.push('Codebook fills available width and truncates long labels at 1400/900/600/400px');
await evaluate(`calls=[];document.querySelector('.codebook-list-row').click()`);
await until(`document.body.innerText.includes('Lazy annotation detail') && document.body.innerText.includes('Linked source')`);
assert.deepEqual(await evaluate(`calls.map(c=>c.command).filter(c=>!c.startsWith('plugin:'))`),['list_code_annotations_command','list_source_summaries_command']);
assert.deepEqual(await evaluate(`calls[1].args.sourceIds`),['s0']);
checks.push('Codebook loads only summary initially and selected-code annotations with their sources on open');
await evaluate(`document.querySelector('.view-header-back-button').click()`);await until(`!!document.querySelector('.codebook-list-row')`);
await evaluate(`window.deferCodeDetails=true;document.querySelectorAll('.codebook-list-row')[1].click()`);await until(`codeDetailRequests.length===1`);
assert.ok(await evaluate(`!!document.querySelector('[role=status]')`));
await evaluate(`document.querySelector('.view-header-back-button').click()`);await until(`!!document.querySelector('.codebook-list-row')`);
await evaluate(`document.querySelectorAll('.codebook-list-row')[2].click()`);await until(`codeDetailRequests.length===2`);
await evaluate(`codeDetailRequests[1].reject(new Error('Detail load failure'))`);await until(`document.body.innerText.includes('Detail load failure')`);
await evaluate(`codeDetailRequests[0].resolve([])`);await delay(100);assert.ok(await evaluate(`document.body.innerText.includes('Detail load failure')`));
await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Retry').click()`);await until(`codeDetailRequests.length===3`);
await evaluate(`codeDetailRequests[2].resolve([])`);await until(`!document.querySelector('[role=status]')&&!document.querySelector('[role=alert]')`);
assert.equal(await evaluate(`document.querySelectorAll('.code-ann-item').length`),0);
checks.push('Codebook cancels stale details, reports failures, retries, and handles empty codes');


console.log(JSON.stringify({passed:true,checks},null,2));

} finally {
  await session?.close();
  await server.close();
}

