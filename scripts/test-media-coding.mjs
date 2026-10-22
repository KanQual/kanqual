import { createTestRoot, buildBrowserFixture, serveBrowserFixture, startBrowser } from './browser-test-harness.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = await createTestRoot('media-coding-');
await buildBrowserFixture(root, `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {SourceMediaCodingView} from './src/views/Source_Media_Coding_View';
import {I18nProvider} from './src/i18n/provider';
const style=document.createElement('style');
style.textContent=${JSON.stringify(await readFile('src/views/Source_Media_Coding_View.css','utf8'))};
document.body.append(style);
// Reserve space for the app chrome outside this screen.
document.getElementById('root').style.height='calc(100vh - 80px)';
// A real, decodable tone exercises playback and waveform generation together.
const bytes=new Uint8Array(44+16000*4), d=new DataView(bytes.buffer);
const str=(offset,s)=>{for(let i=0;i<s.length;i++)bytes[offset+i]=s.charCodeAt(i)};
str(0,'RIFF');d.setUint32(4,bytes.length-8,true);str(8,'WAVEfmt ');
d.setUint32(16,16,true);d.setUint16(20,1,true);d.setUint16(22,1,true);
d.setUint32(24,8000,true);d.setUint32(28,16000,true);d.setUint16(32,2,true);d.setUint16(34,16,true);
str(36,'data');d.setUint32(40,bytes.length-44,true);
for(let i=44;i<bytes.length;i+=2)d.setInt16(i,Math.sin((i-44)/2*2*Math.PI*440/8000)*8000,true);
window.saved=[];window.closedStreams=[];window.streamUrls={};window.openCount=0;window.revoked=[];
const revoke=URL.revokeObjectURL.bind(URL);
URL.revokeObjectURL=url=>{window.revoked.push(url);revoke(url);};
window.__TAURI_INTERNALS__={invoke:async(command,args)=>{
 if(command==='open_media_stream_command'){
   window.openCount++;
   const url=URL.createObjectURL(new Blob([bytes],{type:'audio/wav'}));
   window.streamUrls[args.path]=url;return url;
 }
 if(command==='close_media_stream_command')window.closedStreams.push(args.url);
 return [];
}};
const app=createRoot(document.getElementById('root'));
window.hide=()=>app.render(null);
window.show=(kind,id='one')=>app.render(<React.StrictMode><I18nProvider initialLocale='en'><SourceMediaCodingView
 row={{id,name:'Tone',type:kind,filePath:id+'.wav',waveformPeaksJson:'',videoFrameIndexJson:'',content:'',notes:''}}
 mediaKind={kind} projectStoragePath='C:/fixtures' codes={[]} annotations={[]} codeOptions={[]}
 currentUserId='user' sourceLock={{userId:'user'}} sourceLockConflict={null} lockSyncing={false} canManageAnnotations={true}
 onUpdateSourceWaveform={async(id,json)=>{window.saved.push(JSON.parse(json));}}
 onBack={()=>{}} /></I18nProvider></React.StrictMode>);
window.show('audio');
`, {development:true});
const server = await serveBrowserFixture(root);
let session;
try {
  session = await startBrowser({root, args:['--autoplay-policy=no-user-gesture-required']});
  const {evaluate, until} = session;
  await session.navigate(server.url);
  await until(`typeof show==='function'`);
  for (const [kind,id] of [['audio','one'],['audio','two'],['video','three'],['audio','four']]) {
    await evaluate(`show('${kind}','${id}')`);
    await until(`(()=>{const p=document.querySelector('${kind}');return p?.readyState>=1 && Object.entries(streamUrls).some(([path,url])=>path.endsWith('${id}.wav')&&url===p.src);})()`);
    assert.equal(await evaluate(`document.querySelector('button[aria-label="Play"]').disabled`), false, kind+' controls should retain the attached player');
    await evaluate(`document.querySelector('button[aria-label="Play"]').click()`);
    await until(`document.querySelector('${kind}').currentTime>0.1`);
    await until(`document.querySelector('button[aria-label="Pause"]')!=null`);
    await evaluate(`document.querySelector('button[aria-label="Pause"]').click()`);
    assert.equal(await evaluate(`document.querySelector('${kind}').paused`), true);
    for (const [width,height] of [[2560,600],[1920,720],[1400,900],[900,600]]) {
      await session.call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      // The tone has no picture track; give the video the geometry of a 16:9 source.
      await evaluate(`document.querySelector('video')?.style.setProperty('aspect-ratio','16 / 9')`);
      await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      const consoleBottom=await evaluate(`document.querySelector('.media-player-console-frame').getBoundingClientRect().bottom`);
      await evaluate(`document.querySelector('button[aria-label="New clip"]').click()`);
      await until(`document.querySelector('.media-player-transport-action-card')!=null`);
      const bounds=await evaluate(`(()=>{const card=document.querySelector('.media-player-transport-action-card').getBoundingClientRect(),main=document.querySelector('.workbench-main').getBoundingClientRect();return {top:card.top,bottom:card.bottom,limit:Math.min(main.bottom,innerHeight-80),height:card.height};})()`);
      assert.ok(bounds.height>100 && bounds.top>=0 && bounds.bottom<=bounds.limit+1,JSON.stringify({kind,width,height,...bounds}));
      const selectedBottom=await evaluate(`document.querySelector('.media-player-console-frame').getBoundingClientRect().bottom`);
      assert.ok(Math.abs(consoleBottom-selectedBottom)<1,'Selecting a clip must use reserved space');
      if(kind==='video') {
        assert.ok(await evaluate(`document.querySelector('video').getBoundingClientRect().bottom <= document.querySelector('.media-player-console-frame').getBoundingClientRect().top`),'Video must not overlap the reserved controls');
      }
      await evaluate(`document.querySelector('.media-player-transport-clip-action-button--cancel').click()`);
      await until(`document.querySelector('.media-player-transport-action-card')==null`);
    }
    // Unrelated coding UI rerenders must preserve the player and its stream.
    const opened=await evaluate('openCount');
    await evaluate(`window.previousPlayer=document.querySelector('${kind}');show('${kind}','${id}')`);
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    assert.equal(await evaluate(`previousPlayer===document.querySelector('${kind}') && openCount===${opened}`),true);
    await evaluate(`document.querySelector('${kind}').currentTime=1`);
    await until(`Math.abs(document.querySelector('${kind}').currentTime-1)<0.1`);
    const count = await evaluate('saved.length');
    await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Generate')).click()`);
    await until(`saved.length>${count}`);
    assert.ok(await evaluate('saved.at(-1).peaks[0].some(p=>Math.abs(p)>0.1)'));
    await until(`Array.from(document.querySelectorAll('.media-player-waveform-shell div')).some(el=>el.shadowRoot?.querySelector('canvas'))`);
    console.log('Passed playback and waveform generation: '+kind+' '+id);
  }
  const lastUrl=await evaluate('document.querySelector("audio").src');
  await evaluate('hide()');
  await until(`revoked.includes(${JSON.stringify(lastUrl)}) && !document.querySelector('audio,video')`);
  console.log('Passed Strict Mode, rerender, source switching, seeking and unmount cleanup checks');
} finally {
  await session?.close();
  await server.close();
}
