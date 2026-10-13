import { createTestRoot, buildBrowserFixture, serveBrowserFixture, startBrowser, delay } from "./browser-test-harness.mjs";
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const root = await createTestRoot('table-return-test-');
const entry=await readFile("scripts/fixtures/table-screen.tsx","utf8");
await buildBrowserFixture(root, entry);
const server = await serveBrowserFixture(root);
let session;
try {
  session = await startBrowser({ root });
  const { evaluate, until } = session;
  await session.navigate(server.url);
await until(`document.querySelectorAll('.data-table-row').length===50`);
await evaluate(`document.querySelector('button[aria-label="Next page"]').click()`);await until(`document.querySelector('.table-pagination-counter').textContent==='2 / 3'`);
await evaluate(`renderScreen('reports')`);await until(`document.body.innerText.includes('Report 122')`);
await evaluate(`window.deferTablePages=true;renderScreen('memos')`);await until(`window.pendingTablePages?.length===1`);
assert.equal(await evaluate(`document.querySelector('.table-pagination-counter').textContent`),'2 / 3');
assert.equal(await evaluate(`document.querySelectorAll('.data-table-row').length`),50);
await evaluate(`pendingTablePages.shift()()`);await delay(100);
await evaluate(`window.deferTablePages=false;renderScreen('reports')`);await until(`document.body.innerText.includes('Report 122')`);
await evaluate(`emit('memo');window.deferTablePages=true;renderScreen('memos')`);await until(`pendingTablePages.length===1`);
assert.equal(await evaluate(`document.querySelectorAll('.data-table-row').length`),0);
await evaluate(`pendingTablePages.shift()()`);await until(`document.querySelectorAll('.data-table-row').length===50`);
assert.equal(await evaluate(`document.querySelector('.table-pagination-counter').textContent`),'2 / 3');
await evaluate(`window.deferTablePages=false;renderScreen('reports')`);await until(`document.body.innerText.includes('Report 122')`);
await evaluate(`Array.from(document.querySelectorAll('td[role=button]')).find(e=>e.textContent.toLowerCase().includes('co-occurrence')).click()`);await until(`document.querySelector('.table-pagination-counter').textContent==='1 / 2'`);
await evaluate(`document.querySelector('button[aria-label="Next page"]').click()`);await until(`document.querySelectorAll('.table-card .data-table-row').length===10`);
await evaluate(`renderScreen('codebook')`);await until(`document.querySelectorAll('.codebook-list-row').length===50`);
await evaluate(`document.querySelector('button[aria-label="Next page"]').click()`);await until(`document.querySelector('.codebook-list-row').textContent.includes('Code 049')`);
await evaluate(`window.deferTablePages=true;renderScreen('reports')`);await until(`pendingTablePages.length===1`);
assert.equal(await evaluate(`document.querySelector('.table-pagination-counter').textContent`),'2 / 2');
assert.equal(await evaluate(`document.querySelectorAll('.table-card .data-table-row').length`),10);
await evaluate(`pendingTablePages.shift()();window.deferCodebook=true;renderScreen('codebook')`);await until(`window.pendingCodebook?.length===1`);
assert.equal(await evaluate(`document.querySelector('.table-pagination-counter').textContent`),'2 / 3');
assert.equal(await evaluate(`document.querySelectorAll('.codebook-list-row').length`),50);
await evaluate(`pendingCodebook.shift()()`);
console.log(JSON.stringify({passed:true,checks:['memo page available before background refresh resolves','page restored on repeat visit','change event invalidates cache while view is closed','invalidation preserves page preference','report subtype and page restored','Codebook page restored before fresh response']},null,2));

} finally {
  await session?.close();
  await server.close();
}
