import {t,language} from './i18n.js';
import {searchSuggestions,rememberSearch,suggestionRows,creditArtistCards,matchScore,foldSearch} from './music-ui-model.js';

// One in-flight catalog request, latest draft wins, and a small session cache.
// Typing never changes the active queue or recommendation profile.
export function wireMusicSuggestions({input,form,getItems,getRecent=()=>[],cover,invoke,onPick,isPrivate=()=>false,onArrowOut=()=>false}){
 let history=[];try{const raw=JSON.parse(localStorage.getItem('deviload-music-searches')||'[]');if(Array.isArray(raw))history=raw.filter(x=>typeof x==='string').slice(0,8);}catch{}
 const panel=document.createElement('div'),list=document.createElement('div');
 panel.className='music-search-suggestions music-text-suggestions';panel.hidden=true;list.id='music-search-suggestions';list.role='listbox';panel.append(list);form.append(panel);
 input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-controls',list.id);input.setAttribute('aria-expanded','false');
 let rows=[],active=-1,timer=0,revision=0,filter='all',inFlight=false,queued=null,composing=false;
 const cache=new Map();
 // The catalog answer for an earlier draft, kept while the next one loads so results do not blink away.
 let last={texts:[],rich:[]},submitted='';
 // The query whose results are on the page: coming back to it leads into those results, not a new list.
 const onResults=()=>!!submitted&&input.value.trim()===submitted;
 const still=query=>{const key=foldSearch(query);return {texts:last.texts.filter(row=>foldSearch(row.text).includes(key)),rich:last.rich.filter(item=>matchScore(query,item)>=30)};};
 const hide=()=>{clearTimeout(timer);revision++;queued=null;panel.hidden=true;active=-1;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');};
 const remember=()=>{if(isPrivate())return;history=rememberSearch(history,input.value);try{localStorage.setItem('deviload-music-searches',JSON.stringify(history));}catch{}};
 function pick(row){if(row.item&&onPick){remember();hide();onPick(row.item);return;}hide();input.value=row.text;form.requestSubmit();}
 const kindLabel=kind=>({artist:t('Artist'),album:t('Album'),playlist:t('Playlist'),song:t('Song'),recent:t('Recent search')})[kind]||'';
 function render(values){
  rows=values.slice(0,8);list.replaceChildren();active=-1;input.removeAttribute('aria-activedescendant');
  rows.forEach((row,index)=>{
   const node=document.createElement('button');node.type='button';node.id='music-suggestion-'+index;node.role='option';node.setAttribute('aria-selected','false');node.className='music-suggestion-result';
   node.dataset.kind=row.kind;
   let lead;if(row.item&&cover){lead=cover(row.item,'',96);}else{lead=document.createElement('span');lead.className='icon';lead.dataset.icon=row.kind==='recent'?'clock':'magnifying-glass';lead.setAttribute('aria-hidden','true');}
   const copy=document.createElement('span'),name=document.createElement('strong');copy.className='music-suggestion-copy';name.textContent=row.text;copy.append(name);
   const detail=[kindLabel(row.kind),row.kind==='artist'?'':row.item?.artists?.join(', ')].filter(Boolean).join(' · ');if(detail){const note=document.createElement('small');note.textContent=detail;copy.append(note);}
   node.title=detail?detail+': '+row.text:row.text;node.append(lead,copy);
   node.addEventListener('mousedown',e=>e.preventDefault());node.addEventListener('click',()=>pick(row));list.append(node);
  });
  panel.hidden=!rows.length;input.setAttribute('aria-expanded',String(!!rows.length));
 }
 async function request(job){
  if(inFlight){queued=job;return;}inFlight=true;
  try{const [words,catalog]=await Promise.allSettled([invoke('music_suggestions',{value:job.query,language:job.language}),invoke('music_catalog',{kind:'search',value:job.query,filter:'all',language:job.language})]);
   const result=words.status==='fulfilled'?words.value:[],texts=(Array.isArray(result)?result:[]).filter(value=>typeof value==='string'&&value.trim()&&value.length<=240).slice(0,8).map(text=>({text,kind:'query'}));
   const rich=catalog.status==='fulfilled'?creditArtistCards(catalog.value?.sections||[]).flatMap(section=>section.items||[]).slice(0,6):[];
   // A failed lookup is not an empty answer: try again on the next keystroke.
   if(words.status==='fulfilled'||catalog.status==='fulfilled'){cache.set(job.key,{at:Date.now(),texts,rich});while(cache.size>8)cache.delete(cache.keys().next().value);}
   if(job.revision===revision&&document.activeElement===input){last={texts,rich};render(rowsFor(job.query,texts,rich));}
  }catch{/* Keep local suggestions usable when offline. */}
  finally{inFlight=false;if(queued){const next=queued;queued=null;if(next.revision===revision)request(next);}}
 }
 function rowsFor(query,remote=[],rich=[]){
  const words=isPrivate()?[]:history,local=getItems();
  return suggestionRows(query,{history:words,local,rich,recent:isPrivate()?[]:getRecent(),texts:[...remote,...searchSuggestions(query,words,local)]});
 }
 function refresh(){
  clearTimeout(timer);const current=++revision;queued=null;const query=input.value.trim().slice(0,120);
  const kept=query.length>=2?still(query):{texts:[],rich:[]};
  render(rowsFor(query,kept.texts,kept.rich));
  if(query.length<2||composing||typeof invoke!=='function')return;
  const lang=language(),key=JSON.stringify([query.toLocaleLowerCase(),filter,lang]),hit=cache.get(key);
  if(hit&&Date.now()-hit.at<60000){last={texts:hit.texts,rich:hit.rich};render(rowsFor(query,hit.texts,hit.rich));return;}
  timer=setTimeout(()=>request({query,filter,language:lang,key,revision:current}),350);
 }
 input.addEventListener('focus',()=>{if(!onResults())refresh();});input.addEventListener('input',refresh);
 input.addEventListener('compositionstart',()=>{composing=true;hide();});input.addEventListener('compositionend',()=>{composing=false;refresh();});
 input.addEventListener('blur',()=>setTimeout(()=>{if(document.activeElement!==input&&!panel.contains(document.activeElement))hide();},100));
 input.addEventListener('keydown',e=>{if(e.isComposing)return;if(e.key==='Escape'&&!panel.hidden){e.preventDefault();e.stopImmediatePropagation();hide();return;}
  // With the list closed and results on the page, Down moves into the results instead of reopening it.
  if(e.key==='ArrowDown'&&(panel.hidden||onResults())&&onArrowOut()){hide();e.preventDefault();e.stopImmediatePropagation();return;}
  if(['ArrowDown','ArrowUp'].includes(e.key)){if(panel.hidden)refresh();if(!rows.length)return;e.preventDefault();active=(active+(e.key==='ArrowDown'?1:-1)+rows.length)%rows.length;[...list.children].forEach((node,i)=>node.setAttribute('aria-selected',String(i===active)));input.setAttribute('aria-activedescendant',list.children[active].id);list.children[active].scrollIntoView({block:'nearest'});}
  else if(e.key==='Enter'&&active>=0&&!panel.hidden){e.preventDefault();e.stopImmediatePropagation();pick(rows[active]);}},true);
 form.addEventListener('submit',()=>{remember();submitted=input.value.trim();hide();},true);document.addEventListener('pointerdown',e=>{if(!form.contains(e.target))hide();});
 return {hide};
}
