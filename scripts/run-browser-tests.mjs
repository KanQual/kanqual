import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.argv.slice(2).some(arg => arg !== '--performance')) {
  throw new Error('Usage: node scripts/run-browser-tests.mjs [--performance]');
}
const tests = process.argv.includes('--performance')
  ? ['test-media-stream', 'test-image-previews']
  : [
    'test-browser-harness', 'test-home-scroll', 'test-source-screen', 'test-table-screen',
    'test-annotation-screen', 'test-annotation-return', 'test-list-return',
    'test-table-return', 'test-view-navigation', 'test-navigation-preload',
    'test-lock-readiness', 'diagnose-text-selection', 'diagnose-annotation-deletion',
    'test-installation-restore', 'test-startup-restore-steps', 'test-canvas-zoom', 'test-canvas-layout',
  ];
const failures = [];
for (const name of tests) {
  console.log(`\nRunning ${name}`);
  const result = spawnSync(process.execPath, [fileURLToPath(new URL(`./${name}.mjs`, import.meta.url))], {
    cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: 'inherit', windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    failures.push(name);
    if (result.error) console.error(result.error);
  }
}
console.log(`\n${tests.length - failures.length}/${tests.length} browser scripts passed.`);
if (failures.length) {
  console.error(`Failed: ${failures.join(', ')}`);
  process.exitCode = 1;
}
