import {tracks} from './music-state.js';
import {sanitizeMusicTrack,exportMusicProfile} from './music-profile.js';

const normalize=value=>String(value||'').normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const names=values=>[...new Set((Array.isArray(values)?values:[]).filter(value=>typeof value==='string').map(normalize).filter(Boolean))].sort();
const equal=(a,b)=>a.length===b.length&&a.every((value,index)=>value===b[index]);
const titleOf=item=>{
  let title=String(item.title||'').replace(/\b(?:official\s+(?:music\s+)?(?:audio|video)|official\s+visuali[sz]er)\b/gi,'');
  const prefix=title.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if(prefix&&names(item.artists).includes(normalize(prefix[1])))title=prefix[2];
  return normalize(title);
};
const variants=title=>[...title.matchAll(/\b(live|remix|remastered|remaster|slowed|sped up|speed up|acoustic|instrumental|karaoke|cover|extended|radio edit|reverb)\b/g)].map(match=>match[0]).sort();
const matchingTitle=item=>titleOf({...item,title:String(item.title||'').replace(/\(\s*(?:feat\.?|ft\.?|featuring)\s+[^)]*\)/gi,'')});
const overlap=(a,b)=>{const left=new Set(a.split(' ').filter(Boolean)),right=new Set(b.split(' ').filter(Boolean));return left.size&&right.size?[...left].filter(value=>right.has(value)).length/new Set([...left,...right]).size:0;};

// Ambiguous recordings stay reviewable; never silently replace a studio track
// with a live recording or infer an artist from a missing metadata field.
export function selectImportMatch(entry,candidates){
  const pool=tracks(Array.isArray(candidates)?candidates:[]).filter(item=>item.title.trim());
  if(/^[\w-]{11}$/.test(entry?.videoId||'')){
    const item=pool.find(item=>item.id===entry.videoId);
    if(item)return {item,confidence:'exact'};
  }
  const title=titleOf(entry||{}),artists=names(entry?.artists);
  if(!title)return {item:null,confidence:'none'};
  const ranked=pool.map(item=>{
    const candidateTitle=titleOf(item),candidateArtists=names(item.artists),titleScore=overlap(matchingTitle(entry),matchingTitle(item)),artistScore=artists.length?artists.filter(artist=>candidateArtists.includes(artist)).length/artists.length:0;
    return {item,titleScore,score:titleScore*.6+artistScore*.4,exact:title===candidateTitle&&artists.length>0&&equal(artists,candidateArtists)&&equal(variants(title),variants(candidateTitle))};
  }).filter(value=>value.titleScore>=.5).sort((a,b)=>b.score-a.score);
  const exact=ranked.filter(value=>value.exact);
  if(exact.length===1)return {item:exact[0].item,confidence:'exact'};
  return ranked.length?{item:(exact[0]||ranked[0]).item,confidence:'review'}:{item:null,confidence:'none'};
}

function importId(source,name){
  const key=JSON.stringify([source,name]);let first=2166136261,second=5381;
  for(const char of key){first=Math.imul(first^char.codePointAt(0),16777619)>>>0;second=(Math.imul(second,33)^char.codePointAt(0))>>>0;}
  return `import-${first.toString(16)}-${second.toString(16)}`;
}

export function mergeMusicImport(saved,taste,{rows=[],name='Imported music',source='external'}={}, {useForTaste=true,now=Date.now()}={}){
  if(!Array.isArray(rows)||!Number.isFinite(now)||now<0)throw Error('Invalid music import.');
  const nextSaved=structuredClone(saved),nextTaste=structuredClone(taste),chosen=new Map();let skipped=0;
  nextTaste.entries=Object.assign(Object.create(null),nextTaste.entries);
  for(const row of rows){
    let item;try{item=sanitizeMusicTrack(row?.item);}catch{skipped++;continue;}
    const entry=row.entry||{},old=chosen.get(item.id),plays=Number.isFinite(entry.plays)?Math.max(0,Math.min(10000,Math.floor(entry.plays))):0;
    const lastPlayed=Number.isFinite(entry.lastPlayed)?Math.max(0,Math.min(now,entry.lastPlayed)):0;
    if(old)skipped++;
    chosen.set(item.id,{item,liked:entry.liked===true||old?.liked===true,plays:Math.max(plays,old?.plays||0),lastPlayed:Math.max(lastPlayed,old?.lastPlayed||0)});
  }
  let added=0;const favoriteIds=new Set(nextSaved.favorites.map(item=>item.id)),playlistItems=[];
  for(const row of chosen.values()){
    if(row.liked){if(!favoriteIds.has(row.item.id)){nextSaved.favorites.push(row.item);favoriteIds.add(row.item.id);added++;}else skipped++;}
    else playlistItems.push(row.item);
  }
  if(playlistItems.length){
    const title=String(name||'Imported music').trim()||'Imported music',id=importId(String(source||'external'),title);
    nextSaved.playlists ||= [];
    const target=nextSaved.playlists.find(list=>list.id===id),existing=new Set(target?.items.map(item=>item.id)||[]),items=playlistItems.filter(item=>!existing.has(item.id));
    skipped+=playlistItems.length-items.length;
    if(!target&&nextSaved.playlists.length>=30)throw Error('Music import exceeds the limit of 30 playlists.');
    if(nextSaved.playlists.reduce((total,list)=>total+list.items.length,0)+items.length>500)throw Error('Music import exceeds the limit of 500 playlist entries.');
    if(target)target.items.push(...items);else nextSaved.playlists.push({id,name:title,items});
    added+=items.length;
  }
  if(useForTaste){
    for(const row of chosen.values()){
      const old=nextTaste.entries[row.item.id],score=row.plays>=3?2.5:row.plays>0?1.5:1;
      // Import is evidence with bounded weight, not a simulated playback event.
      // Reimporting the same archive must not increase either reward or count.
      nextTaste.entries[row.item.id]={...old,item:row.item,score:Math.max(old?.score||0,score),plays:Math.max(old?.plays||0,row.plays),at:old?.at??now,lastPlayed:Math.max(old?.lastPlayed||0,row.lastPlayed)};
    }
    const ordered=Object.entries(nextTaste.entries).sort((a,b)=>b[1].at-a[1].at);
    for(const [id]of ordered.slice(1000))delete nextTaste.entries[id];
  }
  // Validate the whole proposed transaction before the caller makes one write.
  exportMusicProfile(nextSaved,nextTaste);
  return {saved:nextSaved,taste:nextTaste,added,skipped};
}
