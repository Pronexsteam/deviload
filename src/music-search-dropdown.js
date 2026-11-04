import {t,language} from './i18n.js';
import {searchSuggestions,rememberSearch} from './music-ui-model.js';

// One in-flight catalog request, latest draft wins, and a small session cache.
// Typing never changes the active queue or recommendation profile.
export function wireMusicSuggestions({input,form,getItems,invoke,onPick,isPrivate=()=>false}){
 let history=[];try{const raw=JSON.parse(localStorage.getItem('deviload-music-searches')||'[]');if(Array.isArray(raw))history=raw.filter(x=>typeof x==='string').slice(0,8);}catch{}
 const panel=document.createElement('div'),list=document.createElement('div');
 panel.className='music-search-suggestions music-text-suggestions';panel.hidden=true;list.id='music-search-suggestions';list.role='listbox';panel.append(list);form.append(panel);
 input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-controls',list.id);input.setAttribute('aria-expanded','false');
 let rows=[],active=-1,timer=0,revision=0,filter='all',inFlight=false,queued=null,composing=false;
 const cache=new Map();
 const hide=()=>{clearTimeout(timer);revision++;queued=null;panel.hidden=true;active=-1;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');};
 const remember=()=>{if(isPrivate())return;history=rememberSearch(history,input.value);try{localStorage.setItem('deviload-music-searches',JSON.stringify(history));}catch{}};
 function pick(row){hide();input.value=row.text;form.requestSubmit();}
 function render(values){
  rows=values.slice(0,8);list.replaceChildren();active=-1;input.removeAttribute('aria-activedescendant');
  rows.forEach((row,index)=>{
   const node=document.createElement('button');node.type='button';node.id='music-suggestion-'+index;node.role='option';node.setAttribute('aria-selected','false');node.className='music-suggestion-result';
   const icon=document.createElement('span');icon.className='icon';icon.dataset.icon='magnifying-glass';icon.setAttribute('aria-hidden','true');
   const copy=document.createElement('span');copy.className='music-suggestion-copy';copy.textContent=row.text;node.title=row.kind==='recent'?t('Recent search')+': '+row.text:row.text;node.append(icon,copy);
   node.addEventListener('mousedown',e=>e.preventDefault());node.addEventListener('click',()=>pick(row));list.append(node);
  });
  panel.hidden=!rows.length;input.setAttribute('aria-expanded',String(!!rows.length));
 }
 async function request(job){
  if(inFlight){queued=job;return;}inFlight=true;
  try{const result=await invoke('music_suggestions',{value:job.query,language:job.language});
   const items=(Array.isArray(result)?result:[]).filter(value=>typeof value==='string'&&value.trim()&&value.length<=240).slice(0,8).map(text=>({text,kind:'query'}));
   cache.set(job.key,{at:Date.now(),items});while(cache.size>8)cache.delete(cache.keys().next().value);
   if(job.revision===revision&&document.activeElement===input&&items.length)render(items);
  }catch{/* Keep local suggestions usable when offline. */}
  finally{inFlight=false;if(queued){const next=queued;queued=null;if(next.revision===revision)request(next);}}
 }
 function refresh(){
  clearTimeout(timer);const current=++revision;queued=null;const query=input.value.trim().slice(0,120);
  const local=searchSuggestions(query,isPrivate()?[]:history,getItems());render(local);
  if(query.length<2||composing||typeof invoke!=='function')return;
  const lang=language(),key=JSON.stringify([query.toLocaleLowerCase(),filter,lang]),hit=cache.get(key);
  if(hit&&Date.now()-hit.at<60000){if(hit.items.length)render(hit.items);return;}
  timer=setTimeout(()=>request({query,filter,language:lang,key,revision:current}),350);
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
