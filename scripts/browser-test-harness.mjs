import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { build } from 'esbuild';
import { callBrowserFunction } from './browser-function.mjs';

export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function browserMemory(browser) {
  const { stdout } = await promisify(execFile)('python', ['-c', `
import json, psutil, sys
parent = psutil.Process(int(sys.argv[1]))
rss = private = renderer = 0
for process in [parent] + parent.children(recursive=True):
    try:
        info = process.memory_info()
        size = getattr(info, 'private', info.vms)
        is_renderer = '--type=renderer' in process.cmdline()
    except (psutil.NoSuchProcess, psutil.AccessDenied):
        continue
    rss += info.rss
    private += size
    if is_renderer:
        renderer += size
print(json.dumps({'rssMiB': rss/1048576, 'privateMiB': private/1048576, 'rendererPrivateMiB': renderer/1048576}))
`, String(browser.pid)], { windowsHide: true });
  return JSON.parse(stdout);
}

// Keep fixture data and result files for inspecting failed runs.
export async function createTestRoot(prefix) {
  await mkdir('.tmp', { recursive: true });
  return mkdtemp(path.resolve('.tmp', prefix));
}

export async function buildBrowserFixture(root, entry, { development = false } = {}) {
  await build({
    stdin: { contents: entry, loader: 'tsx', resolveDir: process.cwd() },
    bundle: true, format: 'esm', outfile: path.join(root, 'app.js'),
    loader: { '.css': 'empty', '.svg': 'text', '.png': 'dataurl', '.md': 'text' },
    plugins: [{ name: 'worker-url', setup(builder) {
      builder.onResolve({ filter: /\?url$/ }, args => ({ path: args.path, namespace: 'worker' }));
      builder.onLoad({ filter: /.*/, namespace: 'worker' }, () => ({ contents: 'export default "";' }));
    } }],
    define: { 'process.env.NODE_ENV': JSON.stringify(development ? 'development' : 'production') },
    logLevel: 'silent',
  });
}

export async function serveBrowserFixture(root) {
  const css = await readFile('src/App.css', 'utf8');
  const app = await readFile(path.join(root, 'app.js'));
  return startTestServer((req, res) => {
    const script = req.url === '/app.js';
    res.setHeader('Content-Type', script ? 'text/javascript' : 'text/html');
    res.end(script ? app : '<style>' + css + '</style><div id="root"></div><script type="module" src="/app.js"></script>');
  });
}

export async function startTestServer(handler) {
  const server = createServer((req, res) => {
    Promise.resolve().then(() => handler(req, res)).catch(error => {
      console.error(error);
      if (!res.headersSent) res.statusCode = 500;
      res.end();
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    url: 'http://127.0.0.1:' + server.address().port,
    async close() {
      const closed = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      server.closeAllConnections();
      await closed;
    },
  };
}

function browserPath() {
  if (process.env.MEDIA_TEST_BROWSER) return process.env.MEDIA_TEST_BROWSER;
  const candidates = process.platform === 'win32'
    ? ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']
    : process.platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
      : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  const found = candidates.find(file => existsSync(file));
  if (!found) throw new Error('Chrome/Chromium not found; set MEDIA_TEST_BROWSER to its executable.');
  return found;
}

export async function startBrowser({ root, profile, width = 1400, height = 900, timeout = 10000, focus = false, args = [], onEvent } = {}) {
  profile ??= await mkdtemp(path.join(root, 'chrome-'));
  const browser = spawn(browserPath(), [
    '--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile,
    '--no-first-run', '--no-default-browser-check', `--window-size=${width},${height}`,
    ...args, 'about:blank',
  ], { windowsHide: true, stdio: 'ignore' });
  let launchError, ws, sequence = 0, closed = false;
  browser.once('error', error => { launchError = error; });
  const exited = new Promise(resolve => { browser.once('exit', resolve); browser.once('error', resolve); });
  const waitForExit = async milliseconds => {
    let timer;
    try {
      return await Promise.race([
        exited.then(() => true),
        new Promise(resolve => { timer = setTimeout(() => resolve(false), milliseconds); }),
      ]);
    } finally { clearTimeout(timer); }
  };
  const pending = new Map();
  const rejectPending = error => {
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) { reject(new Error('Browser connection is closed')); return; }
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('CDP timeout: ' + method));
    }, timeout);
    pending.set(id, {
      resolve: value => { clearTimeout(timer); resolve(value); },
      reject: error => { clearTimeout(timer); reject(error); },
    });
    try { ws.send(JSON.stringify({ id, method, params })); }
    catch (error) { pending.get(id).reject(error); pending.delete(id); }
  });
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const until = async (expression, waitMs = timeout) => {
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return;
      await delay(100);
    }
    throw new Error('Timed out: ' + expression + '\n' + await evaluate('document.body?.innerText'));
  };
  const close = async () => {
    if (closed) return;
    closed = true;
    try { if (ws?.readyState === WebSocket.OPEN) await call('Browser.close'); } catch {}
    ws?.close();
    rejectPending(new Error('Browser closed'));
    if (!await waitForExit(1000)) {
      browser.kill();
      await waitForExit(3000);
    }
  };
  try {
    let port;
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (launchError) throw launchError;
      if (browser.exitCode !== null) throw new Error('Browser exited before connecting');
      try { port = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split(/\r?\n/)[0]; break; } catch {}
      await delay(100);
    }
    if (!port) throw new Error('Chrome did not start');
    const targets = await (await fetch('http://127.0.0.1:' + port + '/json', { signal: AbortSignal.timeout(timeout) })).json();
    const target = targets.find(item => item.type === 'page');
    if (!target) throw new Error('Browser did not create a page');
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Browser WebSocket connection timed out')), timeout);
      ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Browser WebSocket connection failed')); }, { once: true });
    });
    ws.addEventListener('close', () => rejectPending(new Error('Browser disconnected')));
    ws.addEventListener('error', () => rejectPending(new Error('Browser connection failed')));
    ws.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const request = pending.get(message.id);
        pending.delete(message.id);
        if (request) message.error ? request.reject(new Error(JSON.stringify(message.error))) : request.resolve(message.result);
      } else {
        if (message.method === 'Runtime.exceptionThrown') console.error(JSON.stringify(message.params));
        onEvent?.(message);
      }
    });
    await call('Runtime.enable');
    if (focus) await call('Emulation.setFocusEmulationEnabled', { enabled: true });
    return {
      browser, call, evaluate, until, close,
      evaluateFunction: (fn, ...values) => callBrowserFunction(call, fn, ...values),
      async navigate(url) {
        const result = await call('Page.navigate', { url });
        if (result.errorText) throw new Error(result.errorText);
        await until('document.readyState !== "loading" && !!document.body');
      },
    };
  } catch (error) { await close(); throw error; }
}
