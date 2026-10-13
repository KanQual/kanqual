import assert from 'node:assert/strict';
import path from 'node:path';
import { createTestRoot, startBrowser, startTestServer, delay } from './browser-test-harness.mjs';

const root = await createTestRoot('browser-harness-');
const server = await startTestServer((_req, res) => res.end('<body>Harness fixture</body>'));
let session;
try {
  session = await startBrowser({ root, timeout: 2000 });
  await session.navigate(server.url);
  const payload = '"; globalThis.injected = true; //\nUnicode: \u2028';
  assert.equal(await session.evaluateFunction(value => value, payload), payload);
  assert.equal(await session.evaluate('globalThis.injected === undefined'), true);
  await assert.rejects(session.evaluate('new Promise(resolve => setTimeout(resolve, 2200))'), /CDP timeout/);
  await delay(300);
  assert.equal(await session.evaluate('6 * 7'), 42, 'Late replies must not break subsequent requests');
  const pending = assert.rejects(session.evaluate('new Promise(() => {})'), /closed|disconnected/);
  await session.close();
  await pending;
  await session.close(); // Cleanup is idempotent.
  assert.equal(session.browser.exitCode !== null || session.browser.signalCode !== null, true);
} finally {
  await session?.close();
  await server.close();
}
await assert.rejects(fetch(server.url, { signal: AbortSignal.timeout(2000) }));

const previousBrowser = process.env.MEDIA_TEST_BROWSER;
try {
  process.env.MEDIA_TEST_BROWSER = path.join(root, 'missing-browser-executable');
  await assert.rejects(startBrowser({ root }), /ENOENT/);
} finally {
  if (previousBrowser === undefined) delete process.env.MEDIA_TEST_BROWSER;
  else process.env.MEDIA_TEST_BROWSER = previousBrowser;
}
console.log('Browser harness: structured arguments, timeout recovery, disconnect, cleanup, server shutdown, and launch failure passed.');
