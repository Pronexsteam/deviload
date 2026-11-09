import {t,onLanguageChange} from './i18n.js';

// Optional: the music steps aside while another app plays sound (a video, a call) and, if wanted,
// comes back when that app goes quiet. Both choices are off until the person turns them on.
import {readYield,yieldStep,YIELD_KEY} from './music-yield-model.js';
export {readYield,yieldStep,YIELD_KEY} from './music-yield-model.js';

export function wireMusicYield({invoke,host,audios=[],isPlaying,pause,play,notify=()=>{},storage=globalThis.localStorage,listen=window.__TAURI__?.event?.listen}){
  let settings=readYield(storage),state={yielded:false},acting=false;
  const box=document.createElement('fieldset');box.className='music-yield';
  const make=key=>{const label=document.createElement('label'),input=document.createElement('input'),text=document.createElement('span');input.type='checkbox';input.dataset.key=key;label.append(input,text);box.append(label);return {input,text};};
  const pauseOption=make('pause'),resumeOption=make('resume');
  const note=document.createElement('p');note.className='music-yield-note';box.append(note);
  host?.append(box);
  function labels(){
    pauseOption.text.textContent=t('Pause when another app plays sound');
    resumeOption.text.textContent=t('Resume when it goes quiet');
    note.textContent=t('For videos, calls and games. Deviload’s own sounds do not count.');
  }
  function sync(){pauseOption.input.checked=settings.pause;resumeOption.input.checked=settings.resume;resumeOption.input.disabled=!settings.pause;}
  function save(){try{storage?.setItem(YIELD_KEY,JSON.stringify(settings));}catch{/* Kept for this session. */}}
  const watch=()=>invoke('other_audio_watch',{enabled:settings.pause}).catch(()=>{});
  for(const option of [pauseOption,resumeOption])option.input.addEventListener('change',()=>{settings={...settings,[option.input.dataset.key]:option.input.checked};if(!settings.pause)state={yielded:false};save();sync();watch();});
  // A press of play or pause by the person cancels a pending automatic resume.
  for(const audio of audios)for(const name of ['play','pause'])audio.addEventListener(name,()=>{if(!acting)state={yielded:false};});
  listen?.('other-audio',({payload})=>{
    const next=yieldStep(state,{otherPlaying:!!payload,musicPlaying:isPlaying(),settings});state={yielded:next.yielded};
    if(!next.action)return;
    acting=true;
    try{if(next.action==='pause'){pause();notify(t('Paused while another app plays sound.'));}else play();}
    finally{setTimeout(()=>{acting=false;},0);}
  });
  labels();sync();onLanguageChange(labels);if(settings.pause)watch();
  return {get settings(){return settings;}};
}
