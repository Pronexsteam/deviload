import {recordingFamilyIds,resolveRecordingSource} from "./music-recordings.js";
import {canonicalArtistKey,tasteArtistKeys} from "./music-taste.js";

const DAY=86400000,HALF_LIFE=30*DAY,SKEW=5*60000;
const validId=id=>typeof id==="string"&&/^[\w-]{11}$/.test(id);
const validTrack=item=>item!==null&&typeof item==="object"&&item.kind==="song"&&validId(item.id)&&typeof item.title==="string"&&item.title.trim().length>0&&item.title.length<=1024;
const finite=value=>Number.isFinite(value)?value:0;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const list=value=>Array.isArray(value)?value:[];
const clone=value=>structuredClone(value);
const shallowArrays=value=>Object.fromEntries(Object.entries(value||{}).map(([key,item])=>[key,Array.isArray(item)?[...item]:item]));

function unboundView(saved,taste){
  // Ranking consumers are pure. Share read-only metadata and unknown extension
  // fields instead of copying a potentially multi-megabyte library per rank.
  const projectedSaved=shallowArrays(saved),projectedTaste=shallowArrays(taste);
  projectedSaved.favorites=[...list(saved?.favorites)];projectedSaved.recent=[...list(saved?.recent)];
  projectedSaved.playlists=list(saved?.playlists).map(playlist=>({...shallowArrays(playlist),items:[...list(playlist?.items)]}));
  if(Array.isArray(saved?.interestMixes))projectedSaved.interestMixes=saved.interestMixes.map(mix=>shallowArrays(mix));
  projectedTaste.entries={...taste?.entries};
  const ids=input=>[...new Set(list(input).filter(validId))];
  const items=input=>{
    const seen=new Set(),result=[];
    for(const item of list(input).slice(0,2000))if(validTrack(item)&&!seen.has(item.id)){seen.add(item.id);result.push(item);}
    return result;
  };
  return {items,ids,familyIds:id=>validId(id)?[id]:[],saved:projectedSaved,taste:projectedTaste,source:item=>item};
}

// A recommendation-only projection of explicit recording choices. It never
// rewrites the user's queue, library, profile or physical playback identity.
export function createRecordingView(saved={},taste={}, {queue=[],now=Date.now()}={}){
  now=Number.isFinite(now)?clamp(now,0,Number.MAX_SAFE_INTEGER):Date.now();
  const bindings=[],bindingIds=new Set();
  for(const binding of list(saved?.sourceBindings).slice(0,200)){
    if(!validId(binding?.trackId)||!validTrack(binding?.source)||binding.trackId===binding.source.id||bindingIds.has(binding.trackId))continue;
    bindingIds.add(binding.trackId);bindings.push(clone(binding));
  }
  if(!bindings.length)return unboundView(saved,taste);
  const projectedSaved=clone(saved||{}),projectedTaste=clone(taste||{});
  const known=new Map();
  const remember=values=>{for(const item of values)if(validTrack(item)&&!known.has(item.id))known.set(item.id,item);};
  remember(list(saved?.favorites));remember(list(saved?.recent));
  for(const playlist of list(saved?.playlists))remember(list(playlist?.items));
  remember(Object.values(taste?.entries||{}).slice(0,1000).map(entry=>entry?.item));remember(list(queue));
  const knownOrder=new Map([...known.keys()].map((id,index)=>[id,index]));
  const byId=new Map(),groups=[];
  for(const binding of bindings){
    if(byId.has(binding.trackId))continue;
    // The shared model alone establishes equivalence, including connected
    // choices and cycles. Cache membership here, never scan it per candidate.
    const family=recordingFamilyIds(binding.trackId,bindings),members=new Set(family);
    const logical=bindings.filter(row=>members.has(row.trackId));
    const observed=logical.filter(row=>known.has(row.trackId)).sort((a,b)=>knownOrder.get(a.trackId)-knownOrder.get(b.trackId))[0];
    const snapshot=logical.find(row=>validTrack(row.track)&&row.track.id===row.trackId);
    const id=(observed||snapshot||logical[0]).trackId;
    const fixed=observed?known.get(id):snapshot?.track;
    const fallback=family.map(value=>known.get(value)).find(validTrack);
    const group={id,family,metadata:fixed||fallback||null,fixed:!!fixed};
    groups.push(group);for(const value of family)byId.set(value,group);
  }
  const sourceById=new Map();
  for(const binding of bindings){
    const probe={...binding.source,id:binding.trackId};
    sourceById.set(binding.trackId,resolveRecordingSource(probe,bindings));
  }
  const source=item=>validTrack(item)?sourceById.get(item.id)||item:item;
  const canonicalId=id=>byId.get(id)?.id||id;
  const blocked=new Set(list(taste?.blockedArtists).map(canonicalArtistKey).filter(Boolean));
  const blockedTrack=item=>tasteArtistKeys(item).some(name=>blocked.has(name));
  const canonical=item=>{
    const group=byId.get(item.id);
    if(!group)return clone(item);
    // Old bindings may have no logical snapshot. Reuse supplied metadata, but
    // keep the stable logical ID so exclusions and source routing still agree.
    if(!group.metadata||!group.fixed&&item.id===group.id)group.metadata=item;
    return {...clone(group.metadata||item),id:group.id};
  };
  function projectItems(input,bounded=false){
    const candidates=(bounded?list(input).slice(0,2000):list(input)).filter(validTrack);
    for(const item of candidates){const group=byId.get(item.id);if(group&&!group.fixed&&item.id===group.id)group.metadata=item;}
    const result=[],seen=new Set();
    for(const item of candidates){
      const value=canonical(item);
      if(seen.has(value.id)||blockedTrack(item)||blockedTrack(source(value)))continue;
      seen.add(value.id);result.push(value);
    }
    return result;
  }
  const ids=input=>[...new Set(list(input).filter(validId).map(canonicalId))];
  projectedSaved.favorites=projectItems(saved?.favorites);
  projectedSaved.recent=projectItems(saved?.recent);
  projectedSaved.playlists=list(saved?.playlists).map(playlist=>({...clone(playlist),items:projectItems(playlist?.items)}));
  if(Array.isArray(projectedSaved.interestMixes))projectedSaved.interestMixes=projectedSaved.interestMixes.map(mix=>mix&&typeof mix==="object"&&Array.isArray(mix.learnedIds)?{...mix,learnedIds:ids(mix.learnedIds)}:mix);
  const hidden=new Set(ids(taste?.hiddenSongs));
  for(const group of groups){
    const physical=sourceById.get(group.id);
    if(physical&&blockedTrack(physical))hidden.add(group.id);
  }
  projectedTaste.hiddenSongs=[...hidden];
  const entries=Object.create(null),aggregated=new Map();
  const timestamp=value=>Number.isFinite(value)&&value>0&&value<=now+SKEW?Math.min(value,now):0;
  for(const entry of Object.values(taste?.entries||{}).slice(0,1000)){
    if(!validTrack(entry?.item))continue;
    const item=canonical(entry.item),at=timestamp(entry.at),lastPlayed=timestamp(entry.lastPlayed);
    const score=at?clamp(finite(entry.score),-8,8)*Math.exp(-Math.LN2*(now-at)/HALF_LIFE):0;
    const old=aggregated.get(item.id),plays=Math.floor(clamp(finite(entry.plays),0,10000));
    if(!old)aggregated.set(item.id,{item,score,at:now,lastPlayed,plays});
    else{
      // A confirmed alias is not another listen. Keep a rejection rather than
      // letting duplicate positive records erase it; never add plays/scores.
      old.score=old.score<0||score<0?Math.min(old.score,score):Math.max(old.score,score);
      old.lastPlayed=Math.max(old.lastPlayed,lastPlayed);old.plays=Math.max(old.plays,plays);
    }
  }
  for(const [id,entry]of aggregated)entries[id]=entry;
  projectedTaste.entries=entries;
  return {items:input=>projectItems(input,true),ids,familyIds:id=>validId(id)?[...(byId.get(id)?.family||[id])]:[],saved:projectedSaved,taste:projectedTaste,source};
}
