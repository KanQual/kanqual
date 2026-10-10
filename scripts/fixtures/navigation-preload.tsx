import React,{Suspense,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Sidebar} from './src/views/Sidebar';
import {I18nProvider} from './src/i18n/provider';
import {preloadableLazy} from './src/lib/preloadableLazy';
window.attempts=0;window.mounts=0;window.intents=[];
const Destination=preloadableLazy(async()=>{window.attempts++;if(window.failNext){window.failNext=false;throw Error('Transient import failure');}await new Promise(resolve=>window.finishImport=resolve);return {default:()=>{window.mounts++;return <p id="destination">Loaded destination</p>}}});
function App(){const [open,setOpen]=useState(false);const [enabled,setEnabled]=useState(true);window.setEnabled=setEnabled;return <I18nProvider initialLocale="en"><Sidebar forceExpanded activeScreen={open?'memos':'home'} activeProject={enabled?{id:'project',name:'Project'}:null} authSession={{user:{id:'user',name:'Tester',role:'admin'}}} onShowProjectMemos={()=>setOpen(true)} onPreloadScreen={screen=>{window.intents.push(screen);if(screen==='memos')Destination.preload()}} onBackToGate={()=>{}} onSignOut={async()=>{}}/>{open?<Suspense fallback={<p id="loading">Loading</p>}><Destination/></Suspense>:<p id="home">Home remains visible</p>}</I18nProvider>}
createRoot(document.getElementById('root')).render(<App/>);
