import {cleanProfile,parseProfileExport,serializeProfiles} from './download-profile-data.js';
import {t,errorText} from './i18n.js';

export function wireDownloadProfiles({read,apply,invoke,notify}){
  let profiles=[],busy=false;
  const section=document.createElement('section');section.className='saved-profiles';
  section.innerHTML='<label for="saved-profile">My profiles<select id="saved-profile"><option value="">Choose a saved profile</option></select></label><div class="saved-profile-actions"><button id="apply-profile" type="button" class="outline small">Apply</button><button id="remove-profile" type="button" class="quiet small">Remove</button></div><label for="profile-name">Save these settings as<input id="profile-name" maxlength="60" placeholder="For example, MP3 for my player"></label><button id="save-profile" type="button" class="outline small">Save profile</button>';
  document.querySelector('.drawer-foot').before(section);
  const settings=document.createElement('section');settings.className='settings-group';
  settings.innerHTML='<h3>Download profiles</h3><p class="settings-note">Move your saved download profiles between computers. Account sessions, paths and passwords are not included.</p><div class="setting-actions"><button id="export-profiles" type="button" class="outline small">Export profiles</button><button id="import-profiles" type="button" class="outline small">Import profiles</button><input id="import-profile-file" type="file" accept=".json,application/json" hidden></div>';
  document.querySelector('#app-settings-dialog .settings-group').after(settings);
  const find=id=>document.getElementById(id),select=find('saved-profile');
  function render(){
    const selected=select.value;select.replaceChildren(new Option(t('Choose a saved profile'),''));
    profiles.forEach((profile,index)=>select.add(new Option(profile.name,String(index))));
    select.value=selected;
    find('apply-profile').disabled=select.value==='';find('remove-profile').disabled=select.value==='';
  }
  async function persist(next){
    serializeProfiles(next);
    if(invoke)await invoke('save_ui_store',{section:'downloadProfiles',value:{items:next}});
    else localStorage.setItem('deviload-download-profiles',serializeProfiles(next));
    profiles=next;render();
  }
  async function run(action){
    if(busy)return;busy=true;
    const buttons=[...section.querySelectorAll('button'),...settings.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);
    try{await action();}catch(error){notify(errorText(error),true);}
    finally{busy=false;buttons.forEach(b=>b.disabled=false);render();}
  }
  select.addEventListener('change',render);
  find('save-profile').onclick=()=>run(async()=>{
    const profile=cleanProfile({name:find('profile-name').value,options:read()});
    if(profiles.some(p=>p.name.toLowerCase()===profile.name.toLowerCase()))throw Error('A profile with this name already exists');
    await persist([...profiles,profile]);find('profile-name').value='';select.value=String(profiles.length-1);notify(t('Profile saved.'));
  });
  find('apply-profile').onclick=()=>{const profile=profiles[Number(select.value)];if(select.value!==''&&profile){apply(profile.options);notify(t('Profile applied: {name}',{name:profile.name}));}};
  find('remove-profile').onclick=()=>run(async()=>{const index=Number(select.value);if(select.value==='')return;await persist(profiles.filter((_,i)=>i!==index));select.value='';notify(t('Profile removed.'));});
  find('export-profiles').onclick=()=>run(async()=>{
    if(!profiles.length)throw Error('Save a download profile first');
    const text=serializeProfiles(profiles);
    if(invoke){if(await invoke('export_download_profiles',{text}))notify(t('Profiles exported.'));}
    else{const url=URL.createObjectURL(new Blob([text],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='deviload-profiles.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
  });
  find('import-profiles').onclick=()=>find('import-profile-file').click();
  find('import-profile-file').onchange=()=>run(async()=>{
    const file=find('import-profile-file').files[0];find('import-profile-file').value='';if(!file)return;
    if(file.size>256000)throw Error('Profile file is too large');
    const imported=parseProfileExport(await file.text()),next=[...profiles];
    for(const profile of imported){
      if(next.some(p=>p.name===profile.name&&JSON.stringify(p.options)===JSON.stringify(profile.options)))continue;
      const base=profile.name.slice(0,48);let suffix=2;
      while(next.some(p=>p.name.toLowerCase()===profile.name.toLowerCase()))profile.name=`${base} (${suffix++})`;
      next.push(profile);
    }
    await persist(next);notify(t('Profiles imported.'));
  });
  return {load:async stored=>{
    try{const items=stored?.items||(!invoke?parseProfileExport(localStorage.getItem('deviload-download-profiles')||'{"format":"deviload-profiles","version":1,"profiles":[]}'):[]);
      if(!Array.isArray(items)||items.length>32)throw Error('Invalid saved profiles');profiles=items.map(cleanProfile);render();
    }catch(error){notify(errorText(error),true);}
  }};
}
