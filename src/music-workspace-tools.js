import {mountPictureDisc,setPictureDiscArtwork} from "./music-picture-disc.js";
import {t,onLanguageChange} from './i18n.js';
import {panelLayout} from './music-ui-model.js';
export {wireMusicSuggestions} from './music-search-dropdown.js';

export function wireMusicConnectionShortcuts(button){
 const tools=document.querySelector('.music-heading-actions');if(!tools)return;
 for(const [id,label,glyph]of [['music-remote-open','Connect remote','remote-control'],['music-room-open','Listen together','users']]){
  const target=document.getElementById(id);if(!target)continue;
  const shortcut=button(t(label),glyph,()=>target.click(),'music-connection-shortcut');
  shortcut.id=id.replace('-open','-shortcut');shortcut.setAttribute('aria-haspopup','dialog');
  const text=document.createElement('span');shortcut.append(text);
  const labels=()=>{text.textContent=t(label);shortcut.title=shortcut.ariaLabel=t(label);};labels();onLanguageChange(labels);
  const state=()=>shortcut.setAttribute('aria-pressed',target.getAttribute('aria-pressed')||'false');
  state();new MutationObserver(state).observe(target,{attributes:true,attributeFilter:['aria-pressed']});
  tools.insertBefore(shortcut,document.getElementById('music-refresh'));
 }
}

export function wireMusicPanels(workspace){
 let sizes={library:240,playing:280};try{Object.assign(sizes,JSON.parse(localStorage.getItem('deviload-music-panel-sizes')||'{}'));}catch{}
 const initial=panelLayout(2000,Number(sizes.library),Number(sizes.playing));sizes={library:initial.library,playing:initial.playing};const handles=[];
 const save=()=>{try{localStorage.setItem('deviload-music-panel-sizes',JSON.stringify(sizes));}catch{}};
 function layout(){const value=panelLayout(workspace.clientWidth,sizes.library,sizes.playing,workspace.classList.contains('library-panel-open'));workspace.classList.toggle('music-preview-fits',value.preview);workspace.classList.toggle('music-library-overlay',value.overlay);workspace.style.setProperty('--music-library-width',value.library+'px');workspace.style.setProperty('--music-playing-width',value.playing+'px');const box=workspace.getBoundingClientRect();for(const {key,panel,handle}of handles){handle.hidden=panel.hidden||value.overlay||getComputedStyle(panel).display==='none';const rect=panel.getBoundingClientRect();handle.style.left=((key==='library'?rect.right:rect.left)-box.left-4)+'px';}}
 for(const [key,selector,sign]of [['library','.music-library-sidebar',1],['playing','.music-playing-preview',-1]]){
  const panel=workspace.querySelector(selector);if(!panel)continue;const handle=document.createElement('div');handle.className='music-panel-resizer music-panel-resizer-'+key;handle.tabIndex=0;handle.setAttribute('role','separator');handle.setAttribute('aria-orientation','vertical');
  const labels=()=>handle.ariaLabel=key==='library'?t('Resize library'):t('Resize now playing');labels();onLanguageChange(labels);workspace.append(handle);handles.push({key,panel,handle});
  const change=value=>{sizes[key]=Math.max(key==='library'?190:220,Math.min(key==='library'?330:380,value));handle.setAttribute('aria-valuenow',String(Math.round(sizes[key])));layout();};
  handle.setAttribute('aria-valuemin',key==='library'?'190':'220');handle.setAttribute('aria-valuemax',key==='library'?'330':'380');change(sizes[key]);
  let drag=null;handle.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();drag={x:e.clientX,size:sizes[key]};handle.setPointerCapture(e.pointerId);workspace.classList.add('music-resizing');});
  handle.addEventListener('pointermove',e=>{if(drag)change(drag.size+(e.clientX-drag.x)*sign);});
  const end=()=>{if(!drag)return;drag=null;workspace.classList.remove('music-resizing');save();};handle.addEventListener('pointerup',end);handle.addEventListener('lostpointercapture',end);handle.addEventListener('pointercancel',end);
  handle.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();change(e.key==='Home'?(key==='library'?190:220):e.key==='End'?(key==='library'?330:380):sizes[key]+(e.key==='ArrowRight'?16:-16)*sign);save();});
  handle.addEventListener('dblclick',()=>{change(key==='library'?240:280);save();});
 }
 const observer=new ResizeObserver(layout);observer.observe(workspace);new MutationObserver(layout).observe(workspace,{attributes:true,attributeFilter:['class']});layout();
}

export function createMusicHero({root,cover,onPlay,onDiscover}){
 const original=root.querySelector('#music-start');
 const art=document.createElement('button'),copy=document.createElement('div'),eyebrow=document.createElement('span'),title=document.createElement('h2'),subtitle=document.createElement('p'),action=document.createElement('button');
 const label=mountPictureDisc();art.append(label);
 const ambient=document.createElement('span');ambient.className='music-hero-ambient';ambient.setAttribute('aria-hidden','true');
 art.type=action.type='button';art.className='music-hero-cover';copy.className='music-hero-story';eyebrow.className='music-eyebrow';action.className='music-primary music-text-button';root.classList.add('music-listening-hero');root.replaceChildren(ambient,art,copy);copy.append(eyebrow,title,subtitle,action);let current=null,key='',state={resume:false,playing:false};
 if(original){original.hidden=true;root.append(original);}
 const play=()=>current?onPlay(current):onDiscover();art.addEventListener('click',play);action.addEventListener('click',play);
 function update(item,resume=false,playing=false){current=item||null;state={resume,playing};const next=(item?.id||'')+'|'+(item?.image||'');if(next!==key||!label.childElementCount){setPictureDiscArtwork(label,item?.image,480);ambient.replaceChildren(cover(item));key=next;}ambient.hidden=!item;root.classList.toggle('has-track',!!item);root.classList.toggle('is-playing',playing);eyebrow.textContent=playing?t('NOW PLAYING'):resume?t('CONTINUE LISTENING'):t('Your next listen');title.textContent=item?.title||t('Start with music you love');subtitle.textContent=item?.artists?.join(', ')||t('Search for an artist or start a mix.');action.textContent=playing?t('Open player and lyrics'):resume?t('Resume listening'):item?t('Play'):t('Find my rhythm');art.ariaLabel=action.textContent;}
 onLanguageChange(()=>update(current,state.resume,state.playing));update(null);return {update};
}
