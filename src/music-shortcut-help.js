import {t} from './i18n.js';

export function createShortcutHelp({button}){
 const modal=document.createElement('dialog'),head=document.createElement('div'),title=document.createElement('h3'),list=document.createElement('dl');
 modal.className='music-library-dialog music-shortcuts-dialog';head.className='music-library-dialog-head';list.className='music-shortcuts';
 head.append(title,button(t('Close'),'x-circle',()=>modal.close()));modal.append(head,list);document.body.append(modal);
 const rows=()=>[[t('Play or pause'),t('Space')],[t('Next track'),'Ctrl →'],[t('Previous track'),'Ctrl ←'],[t('Seek 5 seconds'),'← →'],[t('Change volume'),'Ctrl ↑ ↓'],[t('Mute'),'M'],[t('Like this song'),'L'],[t('Shuffle'),'S'],[t('Repeat mode'),'R'],[t('Play queue'),'Q'],[t('Full player'),'F'],[t('Search music'),'Ctrl K'],[t('Keyboard shortcuts'),'?']];
 return {open(){
  title.textContent=t('Keyboard shortcuts');modal.setAttribute('aria-label',title.textContent);
  list.replaceChildren(...rows().flatMap(([label,keys])=>{const name=document.createElement('dt'),value=document.createElement('dd'),key=document.createElement('kbd');name.textContent=label;key.textContent=keys;value.append(key);return [name,value];}));
  if(!modal.open)modal.showModal();
 }};
}
