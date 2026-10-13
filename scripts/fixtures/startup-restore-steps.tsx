import React from 'react';
import {createRoot} from 'react-dom/client';
import {I18nProvider} from './src/i18n/provider';
import {LaunchView} from './src/views/Auth_Flow_Views';
window.calls=[];
window.__TAURI_INTERNALS__={invoke:async(command,args)=>{
 window.calls.push({command,args});
 if(command==='get_bundled_postgres_init_preflight_command')return {status:{initialized:false},canInitialize:true,issues:[]};
 if(command==='get_postgres_experiment_auth_status_command')return {currentSession:null};
 if(command==='plugin:dialog|open')return 'C:/backup.kanqual-upgrade-backup';
 if(command==='preview_first_startup_restore_command'){
   if(args.backupPassword!=='correct')throw Error('Invalid backup password');
   return {};
 }
 if(command==='restore_postgres_experiment_upgrade_backup_command')return {backupKanqualVersion:'0.9.7',projectCount:1,userCount:2,storageFileCount:3};
 return null;
}};
createRoot(document.getElementById('root')).render(<I18nProvider initialLocale="en"><LaunchView status={null} loading={false} onBootstrap={async()=>{}} onAuthenticated={()=>{}} onOpenPostgresProjects={()=>{}} /></I18nProvider>);
