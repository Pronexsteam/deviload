import {t,onLanguageChange} from './i18n.js';

const PANEL_KEY='deviload-music-preview';

export function musicPreviewOpen(){try{return localStorage.getItem(PANEL_KEY)==='1';}catch{return false;}}

export function wireMusicDockMenu({extras,button,workspace,items}){
 const menu=document.createElement('div');menu.id='music-dock-menu';menu.className='music-dock-menu';menu.popover='auto';
 const toggle=button(t('More'),'dots-three',()=>{},'music-icon-button music-dock-more');toggle.popoverTargetElement=menu;
 const panel=button(t('Now playing panel'),'sidebar-simple',()=>{
  const open=workspace.classList.toggle('music-preview-open');panel.setAttribute('aria-pressed',String(open));
  try{localStorage.setItem(PANEL_KEY,open?'1':'0');}catch{}
 });
 panel.setAttribute('aria-pressed',String(workspace.classList.contains('music-preview-open')));
 menu.append(...items.filter(Boolean),panel);extras.append(toggle,menu);
 const labels=()=>{toggle.title=toggle.ariaLabel=t('More');panel.title=panel.ariaLabel=t('Now playing panel');};
 onLanguageChange(labels);
 menu.addEventListener('beforetoggle',event=>{
  if(event.newState!=='open')return;
  const anchor=toggle.getBoundingClientRect();
  menu.style.right=`${Math.max(8,innerWidth-anchor.right)}px`;menu.style.bottom=`${innerHeight-anchor.top+10}px`;
 });
 menu.addEventListener('click',event=>{if(event.target.closest('button'))menu.hidePopover();});
}
