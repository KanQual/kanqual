import { createTestRoot, buildBrowserFixture, serveBrowserFixture, startBrowser, delay } from "./browser-test-harness.mjs";
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const root = await createTestRoot('navigation-preload-test-');
const entry=await readFile("scripts/fixtures/navigation-preload.tsx","utf8");
await buildBrowserFixture(root, entry);
const server = await serveBrowserFixture(root);
let session;
try {
  session = await startBrowser({ root, focus: true });
  const { evaluate, until } = session;
  await session.navigate(server.url);
await until(`!!document.querySelector('#home')`);
assert.equal(await evaluate(`attempts`),0);
await evaluate(`window.failNext=true;Array.from(document.querySelectorAll('.sidebar button')).find(b=>b.title==='Memos'||b.textContent.trim()==='Memos').dispatchEvent(new PointerEvent('pointerover',{bubbles:true,pointerType:'mouse'}))`);await delay(50);
assert.equal(await evaluate(`attempts`),1);assert.equal(await evaluate(`mounts`),0);
await evaluate(`Array.from(document.querySelectorAll('.sidebar button')).find(b=>b.title==='Memos'||b.textContent.trim()==='Memos').focus()`);await delay(50);
assert.equal(await evaluate(`attempts`),2);
await evaluate(`Array.from(document.querySelectorAll('.sidebar button')).find(b=>b.title==='Memos'||b.textContent.trim()==='Memos').dispatchEvent(new PointerEvent('pointerover',{bubbles:true,pointerType:'mouse'}))`);await delay(50);
assert.equal(await evaluate(`attempts`),2);assert.equal(await evaluate(`mounts`),0);
await evaluate(`finishImport()`);await delay(50);assert.equal(await evaluate(`mounts`),0);
await evaluate(`Array.from(document.querySelectorAll('.sidebar button')).find(b=>b.title==='Memos'||b.textContent.trim()==='Memos').click()`);await until(`!!document.querySelector('#destination')`);
assert.equal(await evaluate(`attempts`),2);assert.equal(await evaluate(`mounts`),1);
await evaluate(`setEnabled(false)`);await delay(50);await evaluate(`window.intents=[];Array.from(document.querySelectorAll('.sidebar button')).find(b=>b.title==='Sources'||b.textContent.trim()==='Sources').dispatchEvent(new PointerEvent('pointerover',{bubbles:true,pointerType:'mouse'}))`);
assert.deepEqual(await evaluate(`intents`),[]);
console.log('Navigation preload: hover and keyboard focus, request deduplication, retry after failure, no mount before click, reuse on navigation, and disabled-item guard passed');

} finally {
  await session?.close();
  await server.close();
}
