import {t,errorText,onLanguageChange} from './i18n.js';
export function createMusicMiniPlayer({invoke,button,extras,getState,notify}){
 let opened=false,last='',pending=false,lightPending=false;
 const visibility=()=>document.dispatchEvent(new Event('music-mini-visibility'));
 async function ambient(levels){
  if(!opened||lightPending||!window.__TAURI__?.event?.emitTo)return;
  lightPending=true;
  try{await window.__TAURI__.event.emitTo('music-mini','music-mini-ambient',{levels,image:getState().image||''});}catch{/* A closing mini window needs no further frames. */}finally{lightPending=false;}
 }
 const state=()=>({...getState(),theme:document.documentElement.dataset.theme||'ambient'});
 async function sync(){if(!opened||pending)return;const value=state(),signature=JSON.stringify({...value,position:Math.floor(value.position)});if(signature===last)return;pending=true;try{await invoke('music_mini_update',{state:value});last=signature;}catch{/* The main player keeps running. */}finally{pending=false;}}
 const open=button(t('Mini player'),'arrows-in',async()=>{try{await invoke('music_mini_update',{state:state()});await invoke('music_mini_open');opened=true;last='';sync();visibility();}catch(error){notify(errorText(error),true);}});open.id='music-mini-open';open.classList.add('music-mini-launch');const label=document.createElement('span');label.textContent=t('Mini player');open.append(label);extras.append(open);
 onLanguageChange(()=>{open.title=open.ariaLabel=label.textContent=t('Mini player');});
 window.__TAURI__?.event?.listen('music-mini-closed',()=>{opened=false;last='';visibility();});
 window.__TAURI__?.event?.listen('music-mini-show',()=>document.querySelector('#music-tab')?.click());
 document.addEventListener('deviload-theme-change',sync);
 setInterval(sync,1000);return {sync,ambient,get isOpen(){return opened;}};
}
