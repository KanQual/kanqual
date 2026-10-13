import React from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from './src/i18n/provider';
import { InstallationRestoreCard, InstallationRestoreGate } from './src/components/InstallationRestore';
window.calls = [];
window.restoreState = null;
const preview = { fingerprint: 'hash', version: '0.9.7', projects: ['Research'], fileCount: 3, userCount: 2, createdAtMs: 1 };
window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
  window.calls.push({ command, args });
  if (command === 'installation_restore_status_command') return window.restoreState;
  if (command === 'plugin:dialog|open') return 'C:/test.kanqual-upgrade-backup';
  if (command === 'preview_installation_restore_command') {
    if (args.backupPassword !== 'correct') throw Error('Wrong backup password');
    return preview;
  }
  if (command === 'prepare_installation_restore_command') {
    window.restoreState = { phase: 'prepared', preview, recoveryBackup: 'C:/recovery/backup' };
    return window.restoreState;
  }
  if (command === 'execute_installation_restore_command') {
    return await new Promise((resolve, reject) => {
      window.completeRestore = () => { window.restoreState = { ...window.restoreState, phase: 'complete' }; resolve(window.restoreState); };
      window.failRestore = () => { window.restoreState = { ...window.restoreState, phase: 'recovered' }; reject(Error('Restore failed; original data recovered')); };
    });
  }
  if (command === 'finish_installation_restore_command') return;
  if (command === 'get_postgres_experiment_auth_status_command') return { currentSession: null };
  return null;
}};
const root = createRoot(document.getElementById('root'));
let key = 0;
window.show = (gate = false) => root.render(<I18nProvider initialLocale="en"><div key={++key}>{gate ? <InstallationRestoreGate><p id="normal-app">Normal app</p></InstallationRestoreGate> : <InstallationRestoreCard />}</div></I18nProvider>);
window.show();
