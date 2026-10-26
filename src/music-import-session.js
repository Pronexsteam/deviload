import {sanitizeMusicTrack} from './music-profile.js';

// A resumable staging area, separate from likes, listening history and taste.
export const IMPORT_DRAFT_KEY='deviload-music-import-draft-v1';
const LIMIT=5*1024*1024;
const text=(v,n)=>typeof v==='string'?v.slice(0,n):'';
function normalize(value){
  if(value?.version!==1||!Array.isArray(value.batch?.entries))throw Error('Invalid music import.');
  const seen=new Set(),entries=value.batch.entries.map(entry=>{
    const key=text(entry.key,2500),title=text(entry.title,300),artists=Array.isArray(entry.artists)?entry.artists.filter(a=>typeof a==='string').slice(0,10).map(a=>a.slice(0,150)):[];
    const videoId=/^[\w-]{11}$/.test(entry.videoId||'')?entry.videoId:undefined;
    if(!key||seen.has(key)||!videoId&&(!title||!artists.length))throw Error('Invalid music import.');seen.add(key);
    return {key,title,artists,liked:entry.liked===true,plays:Number.isFinite(entry.plays)?Math.max(0,Math.min(100,entry.plays)):0,
      ...(videoId?{videoId}:{}),...(Number.isFinite(entry.lastPlayed)?{lastPlayed:entry.lastPlayed}:{})};
  });
  const entryMap=new Map(entries.map(e=>[e.key,e])),rowKeys=new Set(),rows=[];
  for(const row of Array.isArray(value.rows)?value.rows:[]){
    const entry=entryMap.get(row.key);if(!entry||rowKeys.has(entry.key))continue;rowKeys.add(entry.key);
    try{rows.push({entry,item:sanitizeMusicTrack(row.item),confidence:row.confidence==='exact'?'exact':'review',reviewed:true});}catch{/* Missing matches remain in the original batch for retry. */}
  }
  const keys=list=>Array.isArray(list)?[...new Set(list.filter(k=>seen.has(k)))]:[];
  return {version:1,batch:{name:text(value.batch.name,60)||'Imported music',source:text(value.batch.source,80),entries,
    ...(value.batch.completeness==='unknown'?{completeness:'unknown',origin:'link'}:{}),
    playlists:(Array.isArray(value.batch.playlists)?value.batch.playlists:[]).map(p=>({name:text(p.name,60),keys:keys(p.keys)})),
    warnings:(Array.isArray(value.batch.warnings)?value.batch.warnings:[]).filter(w=>typeof w==='string').slice(0,100).map(w=>w.slice(0,300))},
    rows,selected:keys(value.selected),applied:keys(value.applied),destination:['export','favorites','playlist'].includes(value.destination)?value.destination:'export',
    name:text(value.name,60),subset:text(value.subset,10)||'all',useForTaste:value.useForTaste===true};
}
export function writeImportDraft(storage,value){
  const serialized=JSON.stringify({...value,version:1,rows:value.rows.map(row=>({key:row.entry.key,item:row.item,confidence:row.confidence}))});
  if(new TextEncoder().encode(serialized).length>LIMIT)throw Error('Music import draft is too large. Save the remaining songs as JSON.');
  storage.setItem(IMPORT_DRAFT_KEY,serialized);
}
export function readImportDraft(storage){
  try{const raw=storage.getItem(IMPORT_DRAFT_KEY);if(!raw||new TextEncoder().encode(raw).length>LIMIT)return null;return normalize(JSON.parse(raw));}catch{return null;}
}
export function clearImportDraft(storage){storage.removeItem(IMPORT_DRAFT_KEY);}
