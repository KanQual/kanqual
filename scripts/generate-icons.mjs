import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const temporaryRoot = path.join(root, '.tmp');
await mkdir(temporaryRoot, { recursive: true });
const generated = await mkdtemp(path.join(temporaryRoot, 'desktop-icons-'));
const files = ['32x32.png', '128x128.png', '128x128@2x.png', 'icon.ico', 'icon.icns'];

try {
  const result = spawnSync(process.execPath, [
    path.join(root, 'node_modules/@tauri-apps/cli/tauri.js'),
    'icon', path.join(root, 'branding/app-icon-master.png'), '--output', generated,
  ], { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Icon generation failed (${result.status}).`);
  // Validate all outputs before replacing any committed desktop icon.
  for (const file of files) {
    const info = await stat(path.join(generated, file));
    if (!info.isFile() || info.size === 0) throw new Error(`Missing generated icon: ${file}`);
  }
  const destination = path.join(root, 'src-tauri/icons');
  await mkdir(destination, { recursive: true });
  for (const file of files) await copyFile(path.join(generated, file), path.join(destination, file));
  console.log(`Updated ${files.length} desktop icons from branding/app-icon-master.png.`);
} finally {
  // Only remove the unique workspace directory created by this invocation.
  if (path.dirname(generated) !== temporaryRoot || !path.basename(generated).startsWith('desktop-icons-')) {
    throw new Error('Unexpected generated icon directory; cleanup aborted.');
  }
  await rm(generated, { recursive: true, force: true });
}
