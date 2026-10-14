import React from 'react';
import './src/App.css';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from './src/i18n/provider';
import { InstallationRestoreCard, InstallationRestoreGate } from './src/components/InstallationRestore';
window.calls = [];
let statusBusy = false;
window.statusFailure = false;
window.restoreState = null;
const preview = { fingerprint: 'hash', version: '0.9.7', projects: ['Research'], fileCount: 3, userCount: 2, createdAtMs: 1 };
window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
  window.calls.push({ command, args });
  if (command === 'installation_restore_status_command') {
    if (statusBusy) throw Error('A restore operation is already running.');
    statusBusy = true;
    try {
      await new Promise(resolve => setTimeout(resolve, 30));
      if (window.statusFailure) throw Error('Status read failed');
      return window.restoreState;
    } finally { statusBusy = false; }
  }
  if (command === 'plugin:dialog|open') return 'C:/test.kanqual-upgrade-backup';
  if (command === 'preview_installation_restore_command') {
    if (args.backupPassword !== 'correct') throw Error('Wrong backup password');
    return preview;
  }
  if (command === 'prepare_installation_restore_command') {
    if (!args.skipRecoveryBackup && args.adminPassword !== 'current-admin-password') throw Error('Wrong administrator password');
    window.restoreState = { phase: 'prepared', preview, recoveryBackup: args.skipRecoveryBackup ? '' : 'C:/recovery/backup' };
    return window.restoreState;
  }
  if (command === 'execute_installation_restore_command') {
    return await new Promise((resolve, reject) => {
      window.completeRestore = () => { window.restoreState = { ...window.restoreState, phase: 'complete' }; resolve(window.restoreState); };
      window.failRestore = () => { window.restoreState = { ...window.restoreState, phase: 'recovered' }; reject(Error('Restore failed; original data recovered')); };
    });
  }
  if (command === 'finish_installation_restore_command') { if (args.cancel) window.restoreState = null; return; }
  if (command === 'get_postgres_experiment_auth_status_command') return { currentSession: null };
  return null;
}};
const root = createRoot(document.getElementById('root'));
let key = 0;
window.show = (gate = false) => root.render(<React.StrictMode><I18nProvider initialLocale="en"><div key={++key}><InstallationRestoreGate>{gate ? <p id="normal-app">Normal app</p> : <div id="admin-settings"><InstallationRestoreCard /></div>}</InstallationRestoreGate></div></I18nProvider></React.StrictMode>);
window.show();
