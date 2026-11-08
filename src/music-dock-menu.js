import {t,onLanguageChange} from './i18n.js';

const PANEL_KEY='deviload-music-preview';

export function musicPreviewOpen(){let saved=null;try{saved=localStorage.getItem(PANEL_KEY);}catch{}return saved===null?innerWidth>=1500:saved==='1';}

export function wireMusicDockMenu({extras,button,workspace,items,direct=[],shortcuts=[]}){
 const menu=document.createElement('div');menu.id='music-dock-menu';menu.className='music-dock-menu';menu.popover='auto';
 const toggle=button(t('More'),'dots-three',()=>{},'music-icon-button music-dock-more');toggle.popoverTargetElement=menu;
 const panel=button(t('Now playing panel'),'sidebar-simple',()=>{
  const open=workspace.classList.toggle('music-preview-open');panel.setAttribute('aria-pressed',String(open));
  try{localStorage.setItem(PANEL_KEY,open?'1':'0');}catch{}
 });
 panel.setAttribute('aria-pressed',String(workspace.classList.contains('music-preview-open')));
 panel.classList.add('music-panel-toggle');menu.append(...items.filter(Boolean));extras.append(toggle,menu);// Wide docks also show frequent menu actions as icons; the menu keeps them for narrow windows.
 const quick=shortcuts.filter(entry=>entry?.source).map(({source,glyph})=>{
  const node=button(source.ariaLabel||source.title||'',glyph,()=>source.click(),'music-icon-button music-dock-shortcut');
  const mirror=()=>{node.title=node.ariaLabel=source.ariaLabel||source.title||'';node.disabled=source.disabled;const pressed=source.getAttribute('aria-pressed');if(pressed)node.setAttribute('aria-pressed',pressed);else node.removeAttribute('aria-pressed');};
  mirror();new MutationObserver(mirror).observe(source,{attributes:true,attributeFilter:['aria-label','title','aria-pressed','disabled']});
  return node;
 });
 extras.querySelector('.music-volume-mark')?.before(panel,...direct.filter(Boolean),...quick);
 const labels=()=>{toggle.title=toggle.ariaLabel=t('More');panel.title=panel.ariaLabel=t('Now playing panel');};
 onLanguageChange(labels);
 menu.addEventListener('beforetoggle',event=>{
  if(event.newState!=='open')return;
  const anchor=toggle.getBoundingClientRect();
  menu.style.right=`${Math.max(8,innerWidth-anchor.right)}px`;menu.style.bottom=`${innerHeight-anchor.top+10}px`;
 });
 menu.addEventListener('click',event=>{if(event.target.closest('button'))menu.hidePopover();});
}
