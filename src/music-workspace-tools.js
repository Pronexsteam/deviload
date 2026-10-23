import {t,onLanguageChange} from './i18n.js';
import {panelLayout,searchSuggestions,rememberSearch} from './music-ui-model.js';

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

export function wireMusicSuggestions({input,form,getItems,isPrivate=()=>false}){
 let history=[];try{const raw=JSON.parse(localStorage.getItem('deviload-music-searches')||'[]');if(Array.isArray(raw))history=raw.filter(x=>typeof x==='string').slice(0,8);}catch{}
 const list=document.createElement('div');list.id='music-search-suggestions';list.className='music-search-suggestions';list.hidden=true;list.setAttribute('role','listbox');form.append(list);
 input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-controls',list.id);input.setAttribute('aria-expanded','false');let rows=[],active=-1;
 const hide=()=>{list.hidden=true;active=-1;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');};
 function pick(row){hide();input.value=row.text;input.dispatchEvent(new Event('input',{bubbles:true}));hide();form.requestSubmit();}
 function render(){rows=searchSuggestions(input.value,isPrivate()?[]:history,getItems());list.replaceChildren();active=-1;
  rows.forEach((row,index)=>{const node=document.createElement('button');node.type='button';node.id='music-suggestion-'+index;node.setAttribute('role','option');node.setAttribute('aria-selected','false');const label=document.createElement('span'),kind=document.createElement('small');label.textContent=row.text;kind.textContent=row.kind==='recent'?t('Recent search'):t('Artist');node.append(label,kind);node.addEventListener('mousedown',e=>e.preventDefault());node.addEventListener('click',()=>pick(row));list.append(node);});
  list.hidden=!rows.length;input.setAttribute('aria-expanded',String(!!rows.length));input.removeAttribute('aria-activedescendant');
 }
 input.addEventListener('focus',render);input.addEventListener('input',render);input.addEventListener('blur',()=>setTimeout(()=>{if(!list.contains(document.activeElement))hide();},100));
 input.addEventListener('keydown',e=>{if(e.isComposing)return;if(e.key==='Escape'&&!list.hidden){e.preventDefault();e.stopImmediatePropagation();hide();return;}if(['ArrowDown','ArrowUp'].includes(e.key)){if(list.hidden)render();if(!rows.length)return;e.preventDefault();active=(active+(e.key==='ArrowDown'?1:-1)+rows.length)%rows.length;[...list.children].forEach((node,i)=>node.setAttribute('aria-selected',String(i===active)));input.setAttribute('aria-activedescendant',list.children[active].id);}else if(e.key==='Enter'&&active>=0&&!list.hidden){e.preventDefault();e.stopImmediatePropagation();pick(rows[active]);}},true);
 form.addEventListener('submit',()=>{if(!isPrivate()){history=rememberSearch(history,input.value);try{localStorage.setItem('deviload-music-searches',JSON.stringify(history));}catch{}}hide();},true);
 document.addEventListener('pointerdown',e=>{if(!form.contains(e.target))hide();});
}

export function createMusicHero({root,cover,onPlay,onDiscover}){
 const original=root.querySelector('#music-start');
 const art=document.createElement('button'),copy=document.createElement('div'),eyebrow=document.createElement('span'),title=document.createElement('h2'),subtitle=document.createElement('p'),action=document.createElement('button');
 const record=document.createElement('img'),label=document.createElement('span');record.src='./assets/music-vinyl.png';record.alt='';record.className='music-hero-record';label.className='music-record-label';label.setAttribute('aria-hidden','true');art.append(record,label);
 const ambient=document.createElement('span');ambient.className='music-hero-ambient';ambient.setAttribute('aria-hidden','true');
 art.type=action.type='button';art.className='music-hero-cover';copy.className='music-hero-story';eyebrow.className='music-eyebrow';action.className='music-primary music-text-button';root.classList.add('music-listening-hero');root.replaceChildren(ambient,art,copy);copy.append(eyebrow,title,subtitle,action);let current=null,key='',state={resume:false,playing:false};
 if(original){original.hidden=true;root.append(original);}
 const play=()=>current?onPlay(current):onDiscover();art.addEventListener('click',play);action.addEventListener('click',play);
 function update(item,resume=false,playing=false){current=item||null;state={resume,playing};const next=item?.id||'';if(next!==key||!label.childElementCount){label.replaceChildren(cover(item));ambient.replaceChildren(cover(item));key=next;}label.hidden=ambient.hidden=!item;root.classList.toggle('has-track',!!item);root.classList.toggle('is-playing',playing);eyebrow.textContent=playing?t('NOW PLAYING'):resume?t('CONTINUE LISTENING'):t('Your next listen');title.textContent=item?.title||t('Start with music you love');subtitle.textContent=item?.artists?.join(', ')||t('Search for an artist or start a mix.');action.textContent=playing?t('Open player and lyrics'):resume?t('Resume listening'):item?t('Play'):t('Find my rhythm');art.ariaLabel=action.textContent;}
 onLanguageChange(()=>update(current,state.resume,state.playing));update(null);return {update};
}
