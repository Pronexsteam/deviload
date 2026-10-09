import {t, errorText} from './i18n.js';

const PREFS = ['deviload-lang','deviload-tray','deviload-os-notify','deviload-ytdlp-auto','deviload-clipboard','deviload-library-view','deviload-library-sort'];
export function wireSettingsBackup({invoke, read, notify}) {
  const section = document.createElement('section'); section.className = 'settings-group';
  section.innerHTML='<h3>Settings backup</h3><p class="settings-note">Save download settings, folders, profiles and watched sources. Cookies, passwords, proxy credentials, media files and editor projects are excluded.</p><div class="setting-actions"><button id="backup-export" class="outline small" type="button">Export settings</button><button id="backup-import" class="outline small" type="button">Choose backup</button><input id="backup-file" type="file" accept=".json,application/json" hidden></div><div id="backup-preview" hidden><p id="backup-summary"></p><p class="settings-note">Restoring replaces download settings, saved profiles and watched sources. Existing downloads, library files, projects and sign-ins stay in place. Missing folders use Downloads. Watched sources resume their normal checks after six hours.</p><div class="setting-actions"><button id="backup-restore" class="primary small" type="button">Restore settings</button><button id="backup-cancel" class="quiet small" type="button">Cancel</button></div></div><p id="backup-status" role="status"></p>';
  document.querySelector('#app-settings-dialog .settings-group').after(section);
  const $ = id => section.querySelector('#'+id);
  let text = '', busy = false;
  async function run(action) {
    if (busy) return;
    busy = true; section.querySelectorAll('button').forEach(b => b.disabled = true);
    try {
      if (!invoke) throw Error('Open Deviload to manage downloads.');
      await action();
    } catch (error) { $('backup-status').textContent = errorText(error); notify(errorText(error), true); }
    finally { busy = false; section.querySelectorAll('button').forEach(b => b.disabled = false); }
  }
  $('backup-export').onclick = () => run(async () => {
    const {options:current, parallel} = read();
    const prefs = Object.fromEntries(PREFS.map(key => [key, localStorage.getItem(key)]));
    const exported = await invoke('settings_backup_data', {current, parallel, prefs});
    if (await invoke('export_settings_backup', {text:exported})) $('backup-status').textContent = t('Settings exported.');
  });
  $('backup-import').onclick = () => $('backup-file').click();
  $('backup-file').onchange = () => run(async () => {
    const file = $('backup-file').files[0]; $('backup-file').value = '';
    text = ''; $('backup-preview').hidden = true;
    if (!file) return;
    if (file.size > 2000000) throw Error('Settings backup is too large');
    const candidate = await file.text();
    const summary = await invoke('inspect_settings_backup', {text:candidate});
    text = candidate;
    $('backup-summary').textContent = t('Profiles: {profiles}. Watched sources: {watches}. Folders to replace: {folders}.', {profiles:summary.profiles,watches:summary.watches,folders:summary.foldersReset});
    $('backup-preview').hidden = false; $('backup-status').textContent = '';
  });
  $('backup-cancel').onclick = () => { text = ''; $('backup-preview').hidden = true; };
  $('backup-restore').onclick = () => run(async () => {
    if (!text) return;
    const prefs = await invoke('restore_settings_backup', {text});
    for (const key of PREFS) if (typeof prefs[key] === 'string') localStorage.setItem(key, prefs[key]);
    location.reload();
  });
}
