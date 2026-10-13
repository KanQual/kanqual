import { createTestRoot, buildBrowserFixture, serveBrowserFixture, startBrowser, delay } from "./browser-test-harness.mjs";
import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = await createTestRoot('navigation-test-');
const entry=await readFile("scripts/fixtures/table-screen.tsx","utf8");
await buildBrowserFixture(root, entry);
const server = await serveBrowserFixture(root);
let session;
try {
  session = await startBrowser({ root });
  const { evaluate, until } = session;
  await session.navigate(server.url);
await until(`typeof renderScreen==='function'`);
await evaluate(`renderScreen('home')`);await until(`document.querySelector('.sidebar')!==null`);await delay(1200);
await evaluate(`window.calls=[];window.initialMain=document.querySelector('.app-main').innerText;const button=Array.from(document.querySelectorAll('.sidebar button')).find(b=>b.title==='Codebook'||b.textContent.trim()==='Codebook');button.dispatchEvent(new PointerEvent('pointerover',{bubbles:true,pointerType:'mouse'}));button.focus()`);
await delay(200);
assert.deepEqual(await evaluate(`calls.map(c=>c.command).filter(c=>!c.startsWith('plugin:'))`),[]);
assert.equal(await evaluate(`document.querySelector('.app-main').innerText===initialMain`),true);
const measurements=[];
for (const name of ['Objects','Relationships','Users','Objects']) {
 await evaluate(`window.calls=[]`);const started=performance.now();
 await evaluate(`Array.from(document.querySelectorAll('.sidebar button')).find(b=>b.title===${JSON.stringify(name)}||b.textContent.trim()===${JSON.stringify(name)}).click()`);
 await until(`document.querySelector('.table-pagination-counter')?.innerText==='1 / 3'`);await delay(100);
 measurements.push({view:name,elapsedMs:Math.round(performance.now()-started),commands:await evaluate(`calls.map(c=>c.command).filter(c=>!c.startsWith('plugin:'))`)});
}
for(const measurement of measurements)assert.deepEqual(measurement.commands,[],JSON.stringify(measurement));
await evaluate(`window.calls=[];fixtureObjects[0].title='Updated externally';emit('object')`);
await until(`document.body.innerText.includes('Updated externally')`);
assert.equal(await evaluate(`calls.filter(c=>c.command==='list_postgres_experiment_objects_command').length`),1);
await evaluate(`Array.from(document.querySelectorAll('.sidebar button')).find(b=>b.title==='Users'||b.textContent.trim()==='Users').click()`);await delay(100);
await evaluate(`window.calls=[];fixtureObjects[0].title='Changed while viewing users';emit('object')`);
await until(`calls.some(c=>c.command==='list_postgres_experiment_objects_command')`);await delay(100);
await evaluate(`window.calls=[];Array.from(document.querySelectorAll('.sidebar button')).find(b=>b.title==='Objects'||b.textContent.trim()==='Objects').click()`);
await until(`document.body.innerText.includes('Changed while viewing users')`);
assert.equal(await evaluate(`calls.filter(c=>c.command==='list_postgres_experiment_objects_command').length`),0);
await evaluate(`window.calls=[];emit('saved_drawing')`);await delay(100);
assert.equal(await evaluate(`calls.filter(c=>c.command==='list_postgres_experiment_saved_drawing_summaries_command').length`),1);
assert.equal(await evaluate(`calls.filter(c=>c.command==='list_postgres_experiment_objects_command').length`),0);
console.log(JSON.stringify({measurements,checks:['no navigation reload','external changes refresh visible objects','updates received while viewing users persist on return','saved drawing changes use focused refresh']},null,2));
await writeFile(path.join(root,'results.json'),JSON.stringify(measurements,null,2));

} finally {
  await session?.close();
  await server.close();
}
