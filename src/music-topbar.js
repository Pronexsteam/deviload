import {t,onLanguageChange} from './i18n.js';

// Music settings live next to the notification bell while Devil Music is open, where people look for
// settings first; the button opens the same dialog as before.
export function wireMusicTopbar({document=globalThis.document}={}){
  const bell=document.getElementById('notice-button'),source=document.getElementById('music-settings-open');
  if(!bell||!source)return null;
  const gear=document.createElement('button');
  gear.type='button';gear.id='music-settings-top';gear.className='outline icon-only music-settings-top';
  gear.setAttribute('aria-haspopup','dialog');gear.setAttribute('aria-controls','music-preferences');
  gear.innerHTML='<span class="icon" data-icon="gear" aria-hidden="true"></span>';
  bell.after(gear);
  gear.addEventListener('click',()=>source.click());
  const labels=()=>{gear.title=gear.ariaLabel=t('Music settings');};
  labels();onLanguageChange(labels);
  return gear;
}
