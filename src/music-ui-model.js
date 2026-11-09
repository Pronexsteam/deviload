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
  const kinds=['artist','album','song','playlist'];
  const add=(item,score,order)=>{if(!item?.id||!item.title||!kinds.includes(item.kind)||seen.has(item.id))return;seen.add(item.id);titles.add(foldSearch(item.title));items.push({row:{text:item.title,kind:item.kind,item},score,order});};
  if(!key){recent.slice(0,4).forEach((item,order)=>add(item,0,order));return [...history.slice(0,4).map(text=>({text,kind:'recent'})),...items.map(entry=>entry.row)];}
  // Catalog results stay even when the words differ (the catalog matched them some other way), but the
  // closest matches by title or artist lead; an artist leads only when the query names that artist.
  rich.forEach((item,order)=>add(item,Math.max(10,matchScore(query,item))+(item?.kind==='artist'&&matchScore(query,item)>=80?5:0),order));
  local.forEach((item,order)=>{const score=matchScore(query,item);if(score>0)add(item,score+(item?.kind==='artist'&&score>=80?5:0),rich.length+order);});
  const top=items.sort((a,b)=>b.score-a.score||a.order-b.order).slice(0,4).map(entry=>entry.row),rows=[];
  for(const row of texts){const id=foldSearch(row.text);if(!titles.has(id)&&!rows.some(value=>foldSearch(value.text)===id))rows.push(row);}
  return [...top,...rows].slice(0,8);
}

// Search text compared the forgiving way: case, accents, punctuation and Cyrillic versus Latin letters
// do not matter, so "maneskin" finds Måneskin and "kino" finds the Cyrillic spelling of Kino.
// Cyrillic letters by code point, so the source stays in Latin script.
const LATIN=['a','b','v','g','d','e','zh','z','i','i','k','l','m','n','o','p','r','s','t','u','f','h','ts','ch','sh','sch','','y','','e','yu','ya'];
const EXTRA={'\u0451':'e','\u0454':'e','\u0456':'i','\u0457':'i','\u0491':'g'};
const latin=letter=>{const code=letter.charCodeAt(0);return code>=0x430&&code<=0x44f?LATIN[code-0x430]:EXTRA[letter]??letter;};
export function foldSearch(value){
  return String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase().replace(/[\u0430-\u044f\u0451\u0454\u0456\u0457\u0491]/g,latin).replace(/[^\p{L}\p{N}]+/gu,' ').trim();
}
// At most one letter added, removed or changed.
function nearly(a,b){
  if(a===b)return true;if(Math.abs(a.length-b.length)>1)return false;
  let i=0;while(i<a.length&&i<b.length&&a[i]===b[i])i++;
  return a.slice(i+1)===b.slice(i+1)||a.slice(i)===b.slice(i+1)||a.slice(i+1)===b.slice(i);
}
const wordMatches=(token,word)=>word.startsWith(token)||token.length>=4&&(nearly(token,word)||word.length>token.length&&nearly(token,word.slice(0,token.length)));
// How well [query] names [item] by its title or artists: 100 exact, 80 start, 60 words in any order,
// 45 inside, 30 with one slip per long word, 0 not at all.
export function matchScore(query,item){
  const q=foldSearch(query);if(!q||!item)return 0;
  const tokens=q.split(' ');const names=[item.title,...(item.artists||[])].map(foldSearch).filter(Boolean);
  let best=0;
  for(const name of names){
    if(name===q)return 100;
    if(name.startsWith(q))best=Math.max(best,80);
    const words=name.split(' ');
    if(tokens.every(token=>words.some(word=>word.startsWith(token))))best=Math.max(best,60);
    if(name.includes(q))best=Math.max(best,45);
  }
  if(best)return best;
  // Title and artist words together, so "believer imagine" finds Believer by Imagine Dragons.
  const words=names.join(' ').split(' ');
  if(tokens.every(token=>words.some(word=>word.startsWith(token))))return 55;
  if(tokens.every(token=>words.some(word=>wordMatches(token,word))))return 30;
  return 0;
}
export function rememberSearch(history,query){const value=String(query||'').trim().slice(0,120);if(!value)return history;return [value,...history.filter(item=>typeof item==='string'&&item.toLocaleLowerCase()!==value.toLocaleLowerCase())].slice(0,8);}
export function creditArtistCards(sections){return sections.map(section=>{let artist='';return {...section,items:section.items.map(item=>{if(item?.kind==='artist'){artist=item.title||'';return item;}if(item?.kind!=='song'||item.artists?.length){artist='';return item;}return artist?{...item,artists:[artist]}:item;})};});}
export function creditAlbumArtist(item,parent){return item?.kind==='album'&&!item.artists?.length&&parent?.kind==='artist'&&parent.title?{...item,artists:[parent.title]}:item;}
export function creditAlbumTracks(album,sections){if(album?.kind!=='album')return sections;return sections.map(section=>section.title?section:{...section,items:section.items.map(item=>item.kind==='song'?{...item,album:item.album||album.title,artists:item.artists?.length?item.artists:album.artists||[]}:item)});}
export function songAlbum(item){const album=item?.album;if(typeof album==='string')return album;if(album?.title||album?.name)return album.title||album.name;const parts=String(item?.subtitle||'').split(' • ');return parts.length>=3&&/^\d+:\d{2}/.test(parts[2])?parts[1]:'';}
export function collectionFacts(items){const songs=items.filter(x=>x.kind==='song'),known=songs.filter(x=>Number.isFinite(x.duration)&&x.duration>0);return {count:songs.length,seconds:known.reduce((sum,x)=>sum+x.duration,0),complete:known.length===songs.length};}
