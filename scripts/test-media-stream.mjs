// Requires ffmpeg, Python with psutil, and Chrome (or MEDIA_TEST_BROWSER).
// Tests synthetic files only; it never opens an application database.
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, readFile, open, unlink } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { build } from "esbuild";

const exec = promisify(execFile);
await mkdir(".tmp", { recursive: true });
const root = await mkdtemp(path.resolve(".tmp/media-stream-"));
await build({ stdin: { contents: 'import WaveSurfer from "wavesurfer.js"; window.TestWaveSurfer = WaveSurfer;', resolveDir: process.cwd() }, bundle: true, outfile: path.join(root, "wave.js"), platform: "browser" });
const size = Number(process.env.MEDIA_TEST_SIZE_MIB || 64) * 1024 * 1024;
await exec("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=24", "-t", "8", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-movflags", "+faststart", path.join(root, "large.mp4")], { windowsHide: true });
// A valid trailing MP4 free box makes a large, sparse fixture without long encoding.
const video = await open(path.join(root, "large.mp4"), "r+");
const originalSize = (await video.stat()).size;
const free = Buffer.alloc(8); free.writeUInt32BE(size - originalSize); free.write("free", 4);
await video.write(free, 0, 8, originalSize); await video.truncate(size); await video.close();
const wav = Buffer.alloc(44);
wav.write("RIFF"); wav.writeUInt32LE(size - 8, 4); wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write("data", 36); wav.writeUInt32LE(size - 44, 40);
const audio = await open(path.join(root, "large.wav"), "w"); await audio.write(wav); await audio.truncate(size); await audio.close();
const helper = ts.transpileModule((await readFile("src/lib/mediaStream.ts", "utf8")).replace(/^import .*;\r?\n/gm, "").replace(/export /g, ""), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
await writeFile(path.join(root, "test.html"), `<!doctype html><body><script src="/wave.js"></script><script>
const released=[]; const nativeFetch=window.fetch; window.fullFetches=0; window.fetch=(...args)=>{window.fullFetches++;return nativeFetch(...args);}; function invoke(command, args) { released.push(args?.url); return Promise.resolve(); }
${helper}
const once=(element,event)=>new Promise((resolve,reject)=>{
 const timer=setTimeout(()=>reject(new Error('Timeout: '+event)),20000);
 element.addEventListener(event,()=>{clearTimeout(timer);resolve();},{once:true});
 element.addEventListener('error',()=>{clearTimeout(timer);reject(new Error('Media error '+element.error?.code+' '+element.error?.message+' bytes='+window.legacyBytes?.length+' head='+Array.from(window.legacyBytes?.slice(0,16)||[])));},{once:true});
});
window.start=async(mode,kind)=>{
 window.player=document.createElement(kind==='audio'?'audio':'video');
 player.crossOrigin='anonymous'; player.preload='metadata'; player.muted=true; document.body.append(player);
 const url='http://127.0.0.1:'+location.port+'/'+kind;
 if(mode==='blob') {
  window.legacyBytes=new Uint8Array(await (await fetch(url)).arrayBuffer());
  player.src=URL.createObjectURL(new Blob([legacyBytes],{type:kind==='audio'?'audio/wav':'video/mp4'}));
 } else player.src=url;
 try { await once(player,'loadedmetadata'); } catch(error) { if(mode==='blob')return {error:String(error)}; throw error; }
 const container=document.createElement('div');document.body.append(container);
 window.wave=TestWaveSurfer.create({container,media:player,backend:'MediaElement',peaks:[[0,0]],duration:player.duration});
 await new Promise((resolve,reject)=>{wave.on('ready',resolve);wave.on('error',reject);});
 return {duration:player.duration, width:player.videoWidth, fullFetches};
};
window.exercise=async()=>{
 await player.play(); await new Promise(r=>setTimeout(r,350)); player.pause();
 const target=player.tagName==='AUDIO'?30:5;
 const seeking=once(player,'seeked'); player.currentTime=target; await seeking;
 const seekTime=player.currentTime;
 await player.play(); await new Promise(r=>setTimeout(r,250)); player.pause();
 if(player.tagName==='VIDEO') { const c=document.createElement('canvas'); c.width=320;c.height=180;c.getContext('2d').drawImage(player,0,0);c.toDataURL(); }
 return {seekTime, played:player.currentTime>target};
};
window.closePlayer=()=>{ window.wave?.destroy(); window.wave=null; const url=player.src; releaseMediaUrl(url); player.remove(); window.player=null; window.legacyBytes=null; return released.includes(url); };
</script>`);

const server = spawn("cargo", ["test", "--offline", "--manifest-path", "src-tauri/Cargo.toml", "--lib", "media_stream::tests::browser_fixture_server", "--", "--ignored", "--nocapture"], { env: { ...process.env, KANQUAL_MEDIA_TEST_ROOT: root }, windowsHide: true });
let serverLog = "";
server.stdout.on("data", c => serverLog += c); server.stderr.on("data", c => serverLog += c);
const delay = ms => new Promise(r => setTimeout(r, ms));
async function waitFile(file) { for(let i=0;i<600;i++){try {return await readFile(file,"utf8");}catch{} await delay(200);} throw Error(`Timed out: ${file}\n${serverLog}`); }
let browser;
const results = [];
try {
 const port = Number(await waitFile(path.join(root,"port")));
 for (const mode of ["stream", "blob"]) {
  const profile = path.join(root, mode);
  browser = spawn(process.env.MEDIA_TEST_BROWSER || "C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--autoplay-policy=no-user-gesture-required", "about:blank"], { windowsHide:true, stdio:"ignore" });
  const [debugPort] = (await waitFile(path.join(profile,"DevToolsActivePort"))).split(/\r?\n/);
  const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
  const ws = new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
  let seq=0; const pending=new Map(); const requests=[];
  ws.onclose=()=>{for(const p of pending.values())p.reject(new Error("Browser closed"));pending.clear();};
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p?.reject(m.error):p?.resolve(m.result);} if(m.method==='Network.requestWillBeSent')requests.push(m.params.request.url);};
  const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  const memory=async()=>{
   const {stdout}=await exec('python',['-c','import psutil,json,sys; p=psutil.Process(int(sys.argv[1])); a=[p]+p.children(recursive=True); m=[x.memory_info() for x in a if x.is_running()]; r=[x.memory_info() for x in a if x.is_running() and "--type=renderer" in x.cmdline()]; print(json.dumps({"rssMiB":sum(x.rss for x in m)/1048576,"privateMiB":sum(getattr(x,"private",x.vms) for x in m)/1048576,"rendererPrivateMiB":sum(getattr(x,"private",x.vms) for x in r)/1048576}))',String(browser.pid)],{windowsHide:true});return JSON.parse(stdout);
  };
  await call('Network.enable'); await call('Page.navigate',{url:`http://localhost:${port}/test`});
  for(let i=0;i<100 && !await evaluate("typeof start==='function'");i++)await delay(100);
  await delay(1000);
  const baseline=await memory();
  for(const kind of ['video','audio']){
   const metadata=await evaluate(`start('${mode}','${kind}')`);
   if(mode==='stream')assert.equal(metadata.fullFetches,0,"Waveform must not fetch the entire file");
   const afterLoad=await memory();
   const playback=metadata.error ? {error:metadata.error} : await evaluate('exercise()'); if(!metadata.error)assert.equal(playback.played,true);
   if(!metadata.error)assert.ok(Math.abs(playback.seekTime-(kind==='audio'?30:5))<0.1);
   const afterPlayback=await memory();
   const revoked=await evaluate('closePlayer()'); if(mode==='stream')assert.equal(revoked,true);
   await delay(300);
   console.log(`${metadata.error ? "Legacy decode failed" : "Passed"} ${mode} ${kind}: seek=${playback.seekTime}, memory=${afterLoad.privateMiB.toFixed(1)} MiB private`);
   results.push({mode,kind,fixtureMiB:size/1048576,metadata,playback,baseline,afterLoad,afterPlayback});
  }
  await call('Browser.close').catch(()=>{}); ws.close(); browser=undefined;
 }
 await writeFile(path.join(root,'results.json'),JSON.stringify(results,null,2));
 console.log(JSON.stringify(results,null,2));
 console.log(`Results: ${path.join(root,'results.json')}`);
} finally {
 await writeFile(path.join(root,'results.json'),JSON.stringify(results,null,2));
 if(browser) browser.kill();
 await writeFile(path.join(root,'stop'),'stop');
 await Promise.race([new Promise(r=>server.once('exit',r)),delay(5000)]);
 await Promise.all(['large.mp4','large.wav'].map(name=>unlink(path.join(root,name)).catch(()=>{})));
}
