import { createTestRoot, buildBrowserFixture, serveBrowserFixture, startBrowser, delay } from "./browser-test-harness.mjs";
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const root = await createTestRoot('startup-restore-steps-test-');
const entry=await readFile("scripts/fixtures/startup-restore-steps.tsx","utf8");
await buildBrowserFixture(root, entry);
const server = await serveBrowserFixture(root);
let session;
try {
  session = await startBrowser({ root, focus: true });
  const { call, evaluate, evaluateFunction, until } = session;
  await session.navigate(server.url);

const click = async label => { await evaluateFunction((arg0) => { Array.from(document.querySelectorAll('button')).find(b=>b.textContent===arg0).click(); }, label); await delay(100); };
const input = async (index,value) => { await evaluateFunction((arg0, arg1) => { (()=>{const e=document.querySelectorAll('input')[arg0];Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,arg1);e.dispatchEvent(new Event('input',{bubbles:true}));})(); }, index, value);await delay(50); };
await until(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Restore')`);
await click('Restore');await until(`document.body.innerText.includes('Step 1 of 2')`);await delay(500);
assert.equal(await evaluate(`document.body.innerText.includes('New Administrator Password')`),false);
await click('Choose');await input(1,'wrong');await click('Next');
await until(`document.body.innerText.includes('Invalid backup password')`);
assert.equal(await evaluate(`document.body.innerText.includes('Step 1 of 2')`),true);
assert.equal(await evaluate(`calls.some(c=>c.command==='restore_postgres_experiment_upgrade_backup_command')`),false);
await input(1,'correct');await click('Next');await until(`document.body.innerText.includes('Step 2 of 2')`);await delay(500);
assert.equal(await evaluate(`document.querySelectorAll('input').length`),2);
await click('Back');await until(`document.body.innerText.includes('Step 1 of 2')`);await delay(500);
assert.equal(await evaluate(`document.querySelectorAll('input')[1].value`),'correct');
await click('Next');await until(`document.body.innerText.includes('Step 2 of 2')`);await delay(500);
await input(0,'new-admin-password');await input(1,'different');
assert.equal(await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.type==='submit').disabled`),true);
await input(1,'new-admin-password');
await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.type==='submit').click()`);
await until(`document.body.innerText.includes('Import Complete')`);
assert.deepEqual(await evaluate(`calls.filter(c=>c.command==='restore_postgres_experiment_upgrade_backup_command').map(c=>c.args.request)`),[{backupPath:'C:/backup.kanqual-upgrade-backup',backupPassword:'correct',newAdminPassword:'new-admin-password'}]);
console.log('First-startup restore: separate steps, wrong-password validation, no early restore, Back, password matching, and final restore passed');

} finally {
  await session?.close();
  await server.close();
}
