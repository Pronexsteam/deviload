import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.document = {documentElement:{}};
const {wireSettingsBackup} = await import('../src/settings-backup.js');

function setup(saved, restored = {}) {
  const values = new Map(Object.entries(saved)), calls = [];
  globalThis.localStorage = {getItem:key => values.get(key) ?? null, setItem:(key,value) => values.set(key,value)};
  const ids = Object.fromEntries(['backup-export','backup-import','backup-file','backup-preview','backup-summary','backup-restore','backup-cancel','backup-status'].map(id => [id,{disabled:false,hidden:false,value:'',click(){}}]));
  const section = {querySelector:selector => ids[selector.slice(1)],querySelectorAll:() => Object.values(ids)};
  document.createElement = () => section;
  document.querySelector = () => ({after(){}});
  let reloads = 0;
  globalThis.location = {reload:() => reloads++};
  wireSettingsBackup({
    read:() => ({options:{},parallel:2}),
    notify:message => assert.fail(message),
    invoke:async(command,args) => {
      calls.push({command,args});
      if (command === 'settings_backup_data') return 'serialized settings';
      if (command === 'export_settings_backup') return true;
      if (command === 'inspect_settings_backup') return {profiles:0,watches:0,foldersReset:0};
      if (command === 'restore_settings_backup') return restored;
      assert.fail(`Unexpected command: ${command}`);
    }
  });
  async function restore() {
    ids['backup-file'].files = [{size:2,text:async() => '{}'}];
    await ids['backup-file'].onchange();
    await ids['backup-restore'].onclick();
  }
  return {ids,values,calls,restore,reloads:() => reloads};
}

test('settings export includes the selected theme and restore applies it before reloading', async() => {
  for (const theme of ['classic','glass-light','matte-black','glass-black','midnight','spotify']) {
    const h = setup({'deviload-theme':theme,'deviload-lang':'en'},{'deviload-theme':theme});
    await h.ids['backup-export'].onclick();
    assert.equal(h.calls[0].args.prefs['deviload-theme'],theme);
    h.values.set('deviload-theme','classic');
    await h.restore();
    assert.equal(h.values.get('deviload-theme'),theme);
    assert.equal(h.reloads(),1);
  }
});

test('restoring an older backup without a theme preserves the current theme', async() => {
  const h = setup({'deviload-theme':'glass-light'},{'deviload-lang':'es'});
  await h.restore();
  assert.equal(h.values.get('deviload-theme'),'glass-light');
  assert.equal(h.values.get('deviload-lang'),'es');
  assert.equal(h.reloads(),1);
});
