import {isLocalMusicId} from './music-track-id.js';

// Every page belongs to the same native snapshot. Publish only complete passes.
export async function readLocalLibrary(invoke){
  let offset=0,generation=null,packet,items=[];
  do{
    packet=await invoke('music_local_list',{offset,generation});
    if(!Array.isArray(packet.items)||!Number.isSafeInteger(packet.total)||packet.total<0||!Number.isSafeInteger(packet.generation))throw Error('The local music list changed. Refresh it and try again.');
    if(generation!==null&&packet.generation!==generation)throw Error('The local music list changed. Refresh it and try again.');
    generation=packet.generation;
    if(offset<packet.total&&!packet.items.length)throw Error('The local music list changed. Refresh it and try again.');
    items.push(...packet.items.filter(item=>isLocalMusicId(item?.id)));offset+=packet.items.length;
  }while(offset<packet.total);
  return {...packet,items:[...new Map(items.map(item=>[item.id,item])).values()]};
}

export async function localPlaybackSource(id,invoke,convert){
  if(!isLocalMusicId(id))throw Error('Invalid local music track.');
  const path=await invoke('music_offline_source',{id});
  if(!path)throw Error('Local music file is missing. Add its new folder and scan again.');
  return {url:convert(path),offline:true};
}

// Device-only. An exported music profile and its remote source choices stay portable.
const EXACT_KEY='deviload-music-exact-local-copies-v1';
const remoteId=value=>typeof value==='string'&&/^[\w-]{11}$/.test(value);
const hashId=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
function exactCopies(storage){
  const rows=JSON.parse(storage?.getItem(EXACT_KEY)||'[]');
  if(!Array.isArray(rows))throw Error('Could not read your local recording choices.');
  return rows.filter(r=>remoteId(r?.trackId)&&remoteId(r.sourceId)&&isLocalMusicId(r.localId)&&hashId(r.hash))
    .map(({trackId,sourceId,localId,hash})=>({trackId,sourceId,localId,hash}));
}
export function getExactLocalCopy(storage,trackId,sourceId){
  if(!remoteId(trackId)||!remoteId(sourceId))return null;
  try{return exactCopies(storage).find(r=>r.trackId===trackId&&r.sourceId===sourceId)||null;}catch{return null;}
}
export async function setExactLocalCopy(storage,trackId,sourceId,item,invoke){
  if(!storage||!remoteId(trackId)||!remoteId(sourceId))throw Error('Could not save your music preferences.');
  let binding;
  if(item!=null){
    if(!isLocalMusicId(item.id)||!hashId(item.contentHash))throw Error('Scan the local music library again.');
    await invoke('music_local_exact',{id:item.id,hash:item.contentHash,play:false});
    binding={trackId,sourceId,localId:item.id,hash:item.contentHash};
  }
  const rows=exactCopies(storage).filter(r=>r.trackId!==trackId);
  if(binding)rows.unshift(binding);
  if(rows.length>200)throw Error('You can save up to 200 local recording choices.');
  await storage.setItem(EXACT_KEY,JSON.stringify(rows));
}
export async function exactLocalPlaybackSource(choice,invoke,convert){
  if(!isLocalMusicId(choice?.localId)||!hashId(choice.hash))throw Error('Invalid local music track.');
  const path=await invoke('music_local_exact',{id:choice.localId,hash:choice.hash,play:true});
  if(!path)throw Error('The selected local recording is unavailable.');
  return {url:convert(path),offline:true};
}
export function localRecordingCandidates(items,query,limit=16){
  const words=String(query||'').toLocaleLowerCase().trim().split(/\s+/u).filter(Boolean),result=[];
  for(const item of Array.isArray(items)?items:[]){
    if(!isLocalMusicId(item?.id)||!hashId(item.contentHash))continue;
    const label=[item.title,...(item.artists||[]),item.album].join(' ').toLocaleLowerCase();
    if(words.every(word=>label.includes(word)))result.push(item);
    if(result.length===limit)break;
  }
  return result;
}
export function localDurationDiffers(remote,local){
  const a=remote?.duration||remote?.durationSeconds,b=local?.duration;
  if(!Number.isFinite(a)||!Number.isFinite(b)||a<=0||b<=0)return false;
  return Math.abs(a-b)>Math.max(2,Math.min(a,b)*.01);
}
