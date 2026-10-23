export function panelLayout(width,library=240,playing=280,open=true){
  const clamp=(value,min,max,fallback)=>Number.isFinite(value)?Math.min(max,Math.max(min,value)):fallback;
  width=clamp(width,0,10000,0);library=clamp(library,190,330,240);playing=clamp(playing,220,380,280);
  // Preserve a useful search/content column before spending width on sidebars.
  const content=560,overlay=open&&width<content+190+16;
  const preview=!overlay&&width>=content+(open?190+220+32:220+16);
  if(preview&&open){const available=width-content-32;if(library+playing>available){library=Math.max(190,Math.min(library,available-220));playing=Math.max(220,Math.min(playing,available-library));}}
  else if(preview)playing=Math.min(playing,width-content-16);
  else if(open&&!overlay)library=Math.min(library,width-content-16);
  return {library,playing,preview,overlay};
}
export function searchSuggestions(query,history=[],items=[]){
  const key=String(query||'').trim().toLocaleLowerCase(),seen=new Set(),out=[];
  const add=(text,kind,item=null)=>{if(typeof text!=='string')return;const value=text.trim().slice(0,120),id=value.toLocaleLowerCase();if(!value||seen.has(id)||(key&&!id.includes(key)))return;seen.add(id);out.push({text:value,kind,item});};
  if(key)for(const item of items){if(item.kind==='artist')add(item.title,'artist',item);for(const name of item.artists||[])add(name,'artist');}
  for(const value of history)add(value,'recent');return out.slice(0,6);
}
export function rememberSearch(history,query){const value=String(query||'').trim().slice(0,120);if(!value)return history;return [value,...history.filter(item=>typeof item==='string'&&item.toLocaleLowerCase()!==value.toLocaleLowerCase())].slice(0,8);}
export function collectionFacts(items){const songs=items.filter(x=>x.kind==='song'),known=songs.filter(x=>Number.isFinite(x.duration)&&x.duration>0);return {count:songs.length,seconds:known.reduce((sum,x)=>sum+x.duration,0),complete:known.length===songs.length};}
