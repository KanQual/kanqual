import { createTestRoot, buildBrowserFixture, serveBrowserFixture, startBrowser, delay } from "./browser-test-harness.mjs";
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const root = await createTestRoot('installation-restore-test-');
const entry=await readFile("scripts/fixtures/installation-restore.tsx","utf8");
await buildBrowserFixture(root, entry, { development: true });
const server = await serveBrowserFixture(root);
let session;
try {
  session = await startBrowser({ root, focus: true });
  const { call, evaluate, evaluateFunction, until } = session;
  await session.navigate(server.url);

const click = async label => { await evaluateFunction((arg0) => { Array.from(document.querySelectorAll('button')).find(b=>b.textContent===arg0).click(); }, label); await delay(100); };
const input = async (index,value) => { await evaluateFunction((arg0, arg1) => { (()=>{const e=document.querySelectorAll('input')[arg0];Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,arg1);e.dispatchEvent(new Event('input',{bubbles:true}));})(); }, index, value);await delay(50); };
await until(`document.body?.innerText.includes('Choose backup file')`);
await delay(100);
assert.equal(await evaluate(`calls.filter(c=>c.command==='installation_restore_status_command').length`),1);
assert.equal(await evaluate(`document.body.innerText.includes('A restore operation is already running.')`),false);
await evaluate(`statusFailure=true;show()`);
await until(`document.body.innerText.includes('Status read failed')`);
await evaluate(`statusFailure=false`);
await click('Retry recovery check');
await until(`!document.body.innerText.includes('Status read failed')`);
await click('Choose backup file');await input(0,'wrong');await click('Validate and preview');
assert.equal(await evaluate(`document.body?.innerText.includes('Wrong backup password')`),true);
assert.equal(await evaluate(`document.querySelectorAll('input').length`),1);
await input(0,'correct');await click('Validate and preview');
await until(`document.body?.innerText.includes('Back up before restoring')`);
assert.equal(await evaluate(`!!document.querySelector('#admin-settings')`),false);
assert.equal(await evaluate(`document.body.innerText.includes('All current data will be lost')`),true);
assert.equal(await evaluate(`calls.some(c=>c.command==='prepare_installation_restore_command')`),false);
// Cancellation before preparation returns to settings without a journal or restart.
await click('Cancel');
await until(`!!document.querySelector('#admin-settings')`);
await click('Choose backup file');await input(0,'correct');await click('Validate and preview');
await input(0,'wrong');await click('Backup');
await until(`document.body.innerText.includes('Wrong administrator password')`);
assert.equal(await evaluate(`restoreState`),null);
await input(0,'current-admin-password');await click('Backup');
await until(`document.body?.innerText.includes('Research')`);
assert.equal(await evaluate(`document.querySelectorAll('.settings-diagnostics-grid > div').length`),4);
assert.equal(await evaluate(`calls.filter(c=>c.command==='prepare_installation_restore_command').at(-1).args.skipRecoveryBackup`),false);
assert.equal(await evaluate(`document.querySelectorAll('input').length`),0);
await click('Cancel');
assert.equal(await evaluate(`calls.at(-1).args.cancel`),true);
// Skip must require no current password and must never claim a backup was saved.
await evaluate(`show()`);await until(`document.body.innerText.includes('Choose backup file')`);
await click('Choose backup file');await input(0,'correct');await click('Validate and preview');
await click('Skip');
await until(`document.body.innerText.includes('without creating a recovery backup')`);
assert.deepEqual(await evaluate(`calls.filter(c=>c.command==='prepare_installation_restore_command').at(-1).args`), {
  backupPath:'C:/test.kanqual-upgrade-backup', backupPassword:'correct', adminPassword:null,
  skipRecoveryBackup:true, fingerprint:'hash', confirmation:'RESTORE',
});
// Login-sized card, 2x2 summary, and scrolling remain usable on short screens.
await call('Emulation.setDeviceMetricsOverride',{width:390,height:450,deviceScaleFactor:1,mobile:false});
await delay(100);
assert.equal(await evaluate(`document.querySelector('.auth-card').getBoundingClientRect().width <= 390`),true);
assert.equal(await evaluate(`getComputedStyle(document.querySelector('.settings-diagnostics-grid')).gridTemplateColumns.split(' ').length`),2);
assert.equal(await evaluate(`getComputedStyle(document.querySelector('.installation-restore-screen')).overflowY`),'auto');
const finishCalls = await evaluate(`calls.filter(c=>c.command==='finish_installation_restore_command').length`);
await click('Continue');
assert.equal(await evaluate(`calls.filter(c=>c.command==='finish_installation_restore_command').length`),finishCalls);
await until(`document.body?.innerText.includes('Continue')`);
assert.equal(await evaluate(`document.querySelectorAll('input').length`),2);
assert.equal(await evaluate(`Array.from(document.querySelectorAll('label')).some(l=>l.textContent==='Backup password')`),false);
assert.equal(await evaluate(`!!document.querySelector('#normal-app')`),false);
await input(0,'new-password');await input(1,'mismatch');
assert.equal(await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Continue').disabled`),true);
await input(1,'new-password');await click('Continue');
assert.deepEqual(await evaluate(`calls.filter(c=>c.command==='execute_installation_restore_command').at(-1).args`), {backupPassword:'correct',newAdminPassword:'new-password'});
assert.equal(await evaluate(`Array.from(document.querySelectorAll('button')).every(b=>b.disabled)`),true);
await evaluate(`failRestore()`);await until(`document.body?.innerText.includes('previous installation has been recovered')`);
assert.equal(await evaluate(`!!document.querySelector('#normal-app')`),false);
await evaluate(`restoreState.phase='prepared';show(true)`);await until(`document.querySelectorAll('input').length===3`);
await input(0,'correct');await input(1,'new-password');await input(2,'new-password');await click('Continue');
await evaluate(`completeRestore()`);await until(`document.body?.innerText.includes('Restore complete')`);
await click('Restart KanQual');
await evaluate(`restoreState=null;show(true)`);await until(`!!document.querySelector('#normal-app')`);
await evaluate(`restoreState={phase:'prepared',preview:{fingerprint:'hash',version:'0.9.7',projects:[],fileCount:0,userCount:0,createdAtMs:1},recoveryBackup:'C:/recovery'};statusFailure=true;show(true)`);
await until(`document.body.innerText.includes('Status read failed')`);
await evaluate(`statusFailure=false`);
await click('Retry recovery check');
await until(`document.body.innerText.includes('Continue')`);
assert.equal(await evaluate(`document.body.innerText.includes('Status read failed')`),false);
console.log('Restore UI: validation, leaving settings, optional backup, skip without password, cancellation, four-card review, small screens, Continue without restart, retained backup password, resumed restore, password matching, rollback, success, and status retries passed');

} finally {
  await session?.close();
  await server.close();
}
