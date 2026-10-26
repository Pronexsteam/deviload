import {t,language} from './i18n.js';
import {searchSuggestions,rememberSearch} from './music-ui-model.js';
import {musicThumbnail} from './music-virtual-list.js';

// One in-flight catalog request, latest draft wins, and a small session cache.
// Typing never changes the active queue or recommendation profile.
export function wireMusicSuggestions({input,form,getItems,invoke,onPick,isPrivate=()=>false}){
 let history=[];try{const raw=JSON.parse(localStorage.getItem('deviload-music-searches')||'[]');if(Array.isArray(raw))history=raw.filter(x=>typeof x==='string').slice(0,8);}catch{}
 const panel=document.createElement('div'),tabs=document.createElement('div'),list=document.createElement('div');
 panel.className='music-search-suggestions';panel.hidden=true;tabs.className='music-suggestion-tabs';tabs.role='group';list.id='music-search-suggestions';list.role='listbox';panel.append(tabs,list);form.append(panel);
 input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-controls',list.id);input.setAttribute('aria-expanded','false');
 let rows=[],active=-1,timer=0,revision=0,filter='all',inFlight=false,queued=null,composing=false;
 const cache=new Map();
 const hide=()=>{clearTimeout(timer);revision++;queued=null;panel.hidden=true;active=-1;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');};
 const remember=()=>{if(isPrivate())return;history=rememberSearch(history,input.value);try{localStorage.setItem('deviload-music-searches',JSON.stringify(history));}catch{}};
 function pick(row){hide();if(row.item){remember();onPick(row.item);input.blur();}else{input.value=row.text;input.dispatchEvent(new Event('input',{bubbles:true}));hide();form.requestSubmit();}}
 const kindName=kind=>kind==='song'?t('Songs'):kind==='artist'?t('Artist'):kind==='album'?t('Album'):kind==='playlist'?t('Playlist'):t('Recent search');
 function render(values){
  rows=values.slice(0,8);list.replaceChildren();active=-1;input.removeAttribute('aria-activedescendant');
  rows.forEach((row,index)=>{
   const node=document.createElement('button');node.type='button';node.id='music-suggestion-'+index;node.role='option';node.setAttribute('aria-selected','false');node.className='music-suggestion-result';
   const art=document.createElement('span');art.className='music-suggestion-art';art.dataset.kind=row.item?.kind||row.kind;
   const url=musicThumbnail(row.item?.image);if(url&&/^https:\/\/(i\.ytimg\.com|lh3\.googleusercontent\.com|yt3\.googleusercontent\.com)\//.test(url)){const image=document.createElement('img');image.src=url;image.alt='';image.decoding='async';image.addEventListener('error',()=>image.remove(),{once:true});art.append(image);}else art.textContent=row.kind==='recent'?'↶':'♫';
   const copy=document.createElement('span');copy.className='music-suggestion-copy';const title=document.createElement('strong'),subtitle=document.createElement('small');title.textContent=row.item?.title||row.text;subtitle.textContent=[kindName(row.item?.kind||row.kind),row.item?.artists?.join(', ')].filter(Boolean).join(' · ');copy.append(title,subtitle);node.append(art,copy);
   if(row.item?.duration){const duration=document.createElement('small');duration.textContent=Math.floor(row.item.duration/60)+':'+String(row.item.duration%60).padStart(2,'0');node.append(duration);}
   node.addEventListener('mousedown',e=>e.preventDefault());node.addEventListener('click',()=>pick(row));list.append(node);
  });
  panel.hidden=!rows.length;input.setAttribute('aria-expanded',String(!!rows.length));
 }
 async function request(job){
  if(inFlight){queued=job;return;}inFlight=true;
  try{const result=await invoke('music_catalog',{kind:'search',value:job.query,language:job.language,filter:job.filter});
   const seen=new Set(),items=(result?.sections||[]).flatMap(s=>s.items||[]).filter(item=>['song','artist','album','playlist'].includes(item.kind)&&!seen.has(item.id)&&seen.add(item.id)).slice(0,8);
   cache.set(job.key,{at:Date.now(),items});while(cache.size>8)cache.delete(cache.keys().next().value);
   if(job.revision===revision&&document.activeElement===input)render(items.map(item=>({item})));
  }catch{/* Keep local suggestions usable when offline. */}
  finally{inFlight=false;if(queued){const next=queued;queued=null;if(next.revision===revision)request(next);}}
 }
 function refresh(){
  clearTimeout(timer);const current=++revision;queued=null;const query=input.value.trim().slice(0,120);
  const local=searchSuggestions(query,isPrivate()?[]:history,getItems());render(local);
  if(query.length<2||composing||typeof invoke!=='function')return;
  const lang=language(),key=JSON.stringify([query.toLocaleLowerCase(),filter,lang]),hit=cache.get(key);
  if(hit&&Date.now()-hit.at<60000){render(hit.items.map(item=>({item})));return;}
  timer=setTimeout(()=>request({query,filter,language:lang,key,revision:current}),350);
 }
 for(const [value,label]of [['all',t('All results')],['songs',t('Songs')],['artists',t('Artists')],['albums',t('Albums')]]){
  const tab=document.createElement('button');tab.type='button';tab.textContent=label;tab.dataset.filter=value;tab.setAttribute('aria-pressed',String(value===filter));tab.addEventListener('mousedown',e=>e.preventDefault());tab.addEventListener('click',()=>{filter=value;for(const node of tabs.children)node.setAttribute('aria-pressed',String(node===tab));input.focus();refresh();});tabs.append(tab);
 }
 input.addEventListener('focus',refresh);input.addEventListener('input',refresh);
 input.addEventListener('compositionstart',()=>{composing=true;hide();});input.addEventListener('compositionend',()=>{composing=false;refresh();});
 input.addEventListener('blur',()=>setTimeout(()=>{if(document.activeElement!==input&&!panel.contains(document.activeElement))hide();},100));
 input.addEventListener('keydown',e=>{if(e.isComposing)return;if(e.key==='Escape'&&!panel.hidden){e.preventDefault();e.stopImmediatePropagation();hide();return;}
  if(['ArrowDown','ArrowUp'].includes(e.key)){if(panel.hidden)refresh();if(!rows.length)return;e.preventDefault();active=(active+(e.key==='ArrowDown'?1:-1)+rows.length)%rows.length;[...list.children].forEach((node,i)=>node.setAttribute('aria-selected',String(i===active)));input.setAttribute('aria-activedescendant',list.children[active].id);list.children[active].scrollIntoView({block:'nearest'});}
  else if(e.key==='Enter'&&active>=0&&!panel.hidden){e.preventDefault();e.stopImmediatePropagation();pick(rows[active]);}},true);
 form.addEventListener('submit',()=>{remember();hide();},true);document.addEventListener('pointerdown',e=>{if(!form.contains(e.target))hide();});
 return {hide};
}
