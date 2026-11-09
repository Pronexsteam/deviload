import {t,onLanguageChange} from './i18n.js';
import {createLyricLine} from './lyric-line-view.js';

// The floating lyrics strip. It receives one line at a time with the song position.
const $=id=>document.getElementById(id),invoke=window.__TAURI__.core.invoke;
const strip=$('strip'),next=$('next'),lock=$('strip-lock'),close=$('strip-close');
const view=createLyricLine({host:strip,next});

function labels(){
  lock.title=lock.ariaLabel=t('Let clicks pass through');lock.textContent='🔒';
  close.title=close.ariaLabel=t('Close lyrics on the desktop');close.textContent='×';
}
labels();onLanguageChange(labels);

window.__TAURI__.event.listen('lyrics-line',({payload})=>{
  if(payload.accent)document.documentElement.style.setProperty('--strip-accent',payload.accent);
  view.set(payload);
});
window.__TAURI__.event.listen('lyrics-overlay-locked',({payload})=>document.body.classList.toggle('is-locked',!!payload));

// Drag anywhere that is not a button; the buttons appear while the pointer is over the strip.
strip.addEventListener('mousedown',event=>{if(event.button===0&&!event.target.closest('button'))invoke('lyrics_overlay_action',{action:'drag'}).catch(()=>{});});
lock.addEventListener('click',()=>invoke('lyrics_overlay_action',{action:'lock'}).catch(()=>{}));
close.addEventListener('click',()=>invoke('lyrics_overlay_close').catch(()=>{}));
