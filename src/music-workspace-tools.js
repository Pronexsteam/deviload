import {mountPictureDisc,setPictureDiscArtwork} from "./music-picture-disc.js";
import {t,onLanguageChange} from './i18n.js';
import {panelLayout} from './music-ui-model.js';
export {wireMusicSuggestions} from './music-search-dropdown.js';

export function wireMusicConnectionShortcuts(button,stats){
 const tools=document.querySelector('.music-heading-actions');if(!tools)return;
 for(const [id,label,glyph]of [['music-remote-open','Connect remote','remote-control'],['music-room-open','Listen together','users']]){
  const target=document.getElementById(id);if(!target)continue;
  const shortcut=button(t(label),glyph,()=>{target.click();document.querySelector('dialog[open]')?.addEventListener('close',()=>shortcut.focus(),{once:true});},'music-connection-shortcut');
  shortcut.id=id.replace('-open','-shortcut');shortcut.setAttribute('aria-haspopup','dialog');
  const text=document.createElement('span');shortcut.append(text);
  const labels=()=>{text.textContent=t(label);shortcut.title=shortcut.ariaLabel=t(label);};labels();onLanguageChange(labels);
  const state=()=>shortcut.setAttribute('aria-pressed',target.getAttribute('aria-pressed')||'false');
  state();new MutationObserver(state).observe(target,{attributes:true,attributeFilter:['aria-pressed']});
  tools.insertBefore(shortcut,document.getElementById('music-refresh'));
 }
 const tabs=document.querySelector('.music-tabs');
 const welcome=document.createElement('div'),copy=document.createElement('div'),greeting=document.createElement('h2'),line=document.createElement('p');welcome.className='music-welcome';copy.className='music-welcome-copy';copy.append(greeting,line);welcome.append(copy);if(stats)welcome.append(stats);tabs.before(welcome);
 const greet=()=>{const hour=new Date().getHours();greeting.textContent=hour<5?t('Still up?'):hour<12?t('Good morning'):hour<18?t('Good afternoon'):t('Good evening');line.textContent=hour<5?t('A little music for the quiet hours.'):hour<12?t('Find the sound of your day.'):hour<18?t('Make room for a good song.'):t('Let the day fade into music.');};
 greet();onLanguageChange(greet);document.addEventListener('visibilitychange',()=>{if(!document.hidden)greet();});
 const workspace=document.getElementById('devil-music');new MutationObserver(greet).observe(workspace,{attributes:true,attributeFilter:['data-view']});
 const shortLabels=()=>{for(const [view,short,full]of [['home',t('Discover'),t('Discover')],['library',t('Library'),t('Your library')],['favorites',t('Favorites'),t('Liked songs')],['recent',t('History'),t('Recently played')]]){const node=tabs.querySelector(`[data-music-view="${view}"]`);if(node){node.textContent=short;node.title=node.ariaLabel=full;}}const offline=tabs.querySelector('button:not([data-music-view])');if(offline){offline.textContent=t('Downloads');offline.title=offline.ariaLabel=t('Downloaded music');}};
 shortLabels();onLanguageChange(shortLabels);
 const reveal=node=>node?.scrollIntoView({block:'nearest',inline:'nearest',behavior:'auto'});
 tabs.addEventListener('focusin',event=>reveal(event.target));tabs.addEventListener('click',event=>reveal(event.target.closest('button')));
 tabs.addEventListener('wheel',event=>{if(tabs.scrollWidth>tabs.clientWidth&&Math.abs(event.deltaY)>Math.abs(event.deltaX)){event.preventDefault();tabs.scrollLeft+=event.deltaY;}},{passive:false});
 tabs.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key))return;const buttons=[...tabs.querySelectorAll('button')].filter(node=>node.getClientRects().length),index=buttons.indexOf(document.activeElement);if(index<0)return;event.preventDefault();buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(['ArrowRight','ArrowDown'].includes(event.key)?1:-1)+buttons.length)%buttons.length].focus();});
 // Keep the existing controls and handlers, but give navigation one home.
 const sidebar=document.querySelector('.music-library-body');
 if(sidebar){
  const navigation=document.createElement('div');navigation.className='music-sidebar-controls';navigation.append(tabs,tools);sidebar.prepend(navigation);tabs.classList.add('music-sidebar-navigation');
  const refresh=document.getElementById('music-refresh'),refreshLabel=document.createElement('span');refresh.append(refreshLabel);const translateRefresh=()=>{refreshLabel.textContent=t('Refresh music');};translateRefresh();onLanguageChange(translateRefresh);
  const icons={library:'playlist',favorites:'heart',recent:'clock'};
  for(const node of tabs.querySelectorAll('button')){const icon=document.createElement('span');icon.className='icon';icon.dataset.icon=icons[node.dataset.musicView]||'download-simple';icon.setAttribute('aria-hidden','true');node.prepend(icon);}
  // Restore icons after language labels are refreshed.
  onLanguageChange(()=>{for(const node of tabs.querySelectorAll('button')){if(node.querySelector('.icon'))continue;const icon=document.createElement('span');icon.className='icon';icon.dataset.icon=icons[node.dataset.musicView]||'download-simple';icon.setAttribute('aria-hidden','true');node.prepend(icon);}});
  tabs.addEventListener('click',event=>{if(event.target.closest('button')&&workspace.classList.contains('music-library-overlay'))document.querySelector('.music-library-panel-toggle')?.click();});
 }
}

export function wireMusicPanels(workspace){
 let sizes={library:240,playing:340};try{Object.assign(sizes,JSON.parse(localStorage.getItem('deviload-music-panel-sizes')||'{}'));}catch{}
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
  handle.addEventListener('dblclick',()=>{change(key==='library'?240:340);save();});
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
 function update(item,resume=false,playing=false){current=item||null;state={resume,playing};const next=(item?.id||'')+'|'+(item?.image||'');if(next!==key||!label.childElementCount){setPictureDiscArtwork(label,item?.image,480);ambient.replaceChildren(cover(item));key=next;}ambient.hidden=!item;root.classList.toggle('has-track',!!item);root.classList.toggle('is-playing',playing);eyebrow.textContent=playing?t('NOW PLAYING'):resume?t('CONTINUE LISTENING'):t('Your next listen');title.textContent=item?.title||t('Start with music you love');subtitle.textContent=item?(item.artists||[]).join(', '):t('Search for an artist or start a mix.');subtitle.hidden=!subtitle.textContent;action.textContent=playing?t('Open player and lyrics'):resume?t('Resume listening'):item?t('Play'):t('Find my rhythm');art.ariaLabel=action.textContent;}
 onLanguageChange(()=>update(current,state.resume,state.playing));update(null);return {update};
}
