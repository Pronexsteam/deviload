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
export function suggestionRows(query,{history=[],local=[],rich=[],texts=[],recent=[]}={}){
  const key=String(query||'').trim().toLocaleLowerCase(),seen=new Set(),titles=new Set(),items=[];
  const kinds=['artist','album','song','playlist'],named=item=>[item?.title,...(item?.artists||[])].some(name=>typeof name==='string'&&name.toLocaleLowerCase().includes(key));
  const add=item=>{if(!item?.id||!item.title||!kinds.includes(item.kind)||seen.has(item.id))return;seen.add(item.id);titles.add(item.title.toLocaleLowerCase());items.push({text:item.title,kind:item.kind,item});};
  if(!key){recent.slice(0,4).forEach(add);return [...history.slice(0,4).map(text=>({text,kind:'recent'})),...items];}
  rich.forEach(add);local.filter(named).forEach(add);
  const top=items.sort((a,b)=>Number(b.kind==='artist')-Number(a.kind==='artist')).slice(0,4),rows=[];
  for(const row of texts){const id=row.text.toLocaleLowerCase();if(!titles.has(id)&&!rows.some(value=>value.text.toLocaleLowerCase()===id))rows.push(row);}
  return [...top,...rows].slice(0,8);
}
export function rememberSearch(history,query){const value=String(query||'').trim().slice(0,120);if(!value)return history;return [value,...history.filter(item=>typeof item==='string'&&item.toLocaleLowerCase()!==value.toLocaleLowerCase())].slice(0,8);}
export function creditArtistCards(sections){return sections.map(section=>{let artist='';return {...section,items:section.items.map(item=>{if(item?.kind==='artist'){artist=item.title||'';return item;}if(item?.kind!=='song'||item.artists?.length){artist='';return item;}return artist?{...item,artists:[artist]}:item;})};});}
export function creditAlbumArtist(item,parent){return item?.kind==='album'&&!item.artists?.length&&parent?.kind==='artist'&&parent.title?{...item,artists:[parent.title]}:item;}
export function creditAlbumTracks(album,sections){if(album?.kind!=='album')return sections;return sections.map(section=>section.title?section:{...section,items:section.items.map(item=>item.kind==='song'?{...item,album:item.album||album.title,artists:item.artists?.length?item.artists:album.artists||[]}:item)});}
export function songAlbum(item){const album=item?.album;if(typeof album==='string')return album;if(album?.title||album?.name)return album.title||album.name;const parts=String(item?.subtitle||'').split(' • ');return parts.length>=3&&/^\d+:\d{2}/.test(parts[2])?parts[1]:'';}
export function collectionFacts(items){const songs=items.filter(x=>x.kind==='song'),known=songs.filter(x=>Number.isFinite(x.duration)&&x.duration>0);return {count:songs.length,seconds:known.reduce((sum,x)=>sum+x.duration,0),complete:known.length===songs.length};}
