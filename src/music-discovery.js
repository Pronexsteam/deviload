import {recordingDescriptor,recordingMatch} from "./music-recordings.js";

const HOUR=3600000,NEGATIVE_TTL=600000,MAX_KEYS=24,MAX_RECORDINGS=3;
const tagsAllowed=new Set(["pop","rock","electronic","jazz","ambient","classical","instrumental","hip hop","phonk","metal","folk","soul","r&b","dance"]);
const idPattern=/^[\w-]{11}$/,mbidPattern=/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const normalize=value=>value.normalize("NFKC").replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200d\ufeff]/g,"").replace(/\s+/gu," ").trim();
const artistKey=value=>normalize(value).toLowerCase();
const active=guard=>{try{return guard()===true;}catch{return false;}};
const copy=items=>items.map(item=>({...item,artists:[...item.artists]}));
function names(values,limit=2){
  const result=[],seen=new Set();
  for(const value of Array.isArray(values)?values.slice(0,32):[]){
    if(typeof value!=="string"||value.length>200)continue;
    const name=normalize(value),key=artistKey(name);
    if(!name||key==="unknown artist"||seen.has(key))continue;
    seen.add(key);result.push(name);if(result.length===limit)break;
  }
  return result;
}
function credits(values){
  if(!Array.isArray(values)||!values.length||values.length>4)return null;
  if(values.some(value=>typeof value!=="string"||value.length>200||!normalize(value)))return null;
  return [...new Set(values.map(normalize))];
}
function song(value){
  if(value===null||typeof value!=="object"||value.kind!=="song"||typeof value.id!=="string"||!idPattern.test(value.id)||typeof value.title!=="string"||value.title.length>1024)return null;
  const title=normalize(value.title),artists=credits(value.artists);
  if(!title||!artists)return null;
  const seconds=recordingDescriptor(value).duration;
  if(seconds===null||seconds>86400)return null;
  const image=typeof value.image==="string"&&value.image.length<=512&&/^https:\/\/(?:i\.ytimg\.com|lh3\.googleusercontent\.com|yt3\.googleusercontent\.com)\//.test(value.image)?value.image:"";
  return {id:value.id,kind:"song",title,artists,duration:seconds,image,
    subtitle:typeof value.subtitle==="string"?normalize(value.subtitle).slice(0,180):""};
}
function recordings(value){
  const result=[],seenIds=new Set(),seenMetadata=new Set();
  for(const row of Array.isArray(value?.recordings)?value.recordings.slice(0,12):[]){
    if(row===null||typeof row!=="object"||typeof row.mbid!=="string"||!mbidPattern.test(row.mbid)||seenIds.has(row.mbid.toLowerCase()))continue;
    const item=song({...row,id:"___________",kind:"song"});
    if(!item)continue;
    const descriptor=recordingDescriptor(item),key=JSON.stringify(descriptor);
    if(seenMetadata.has(key))continue;
    seenIds.add(row.mbid.toLowerCase());seenMetadata.add(key);result.push(item);
  }
  return result;
}
function searchItems(value){
  const items=[];
  for(const section of Array.isArray(value?.sections)?value.sections.slice(0,12):[]){
    for(const raw of Array.isArray(section?.items)?section.items.slice(0,50):[]){
      const item=song(raw);if(item)items.push(item);
    }
  }
  return items;
}

// ListenBrainz supplies public metadata, never a playable ID. Resolve a small
// number of recordings against the existing catalog, requiring exact metadata
// agreement before adding candidates. Nothing here changes playback or taste.
export function createMusicDiscovery({invoke,now=Date.now}={}){
  let generation=0;
  const cache=new Map(),pending=new Map();
  const clock=()=>{const value=now();return Number.isFinite(value)?value:Date.now();};
  function put(key,items){
    cache.delete(key);cache.set(key,{expires:clock()+(items.length?HOUR:NEGATIVE_TTL),items:copy(items)});
    while(cache.size>MAX_KEYS)cache.delete(cache.keys().next().value);
  }
  async function resolve(entry,input){
    const live=()=>entry.generation===generation&&[...entry.consumers].some(active);
    const result=[];let cacheable=true;
    try{
      if(!live())return [];
      const response=await invoke("music_discovery",{artists:input.artists,tags:input.tags});
      if(!live())return [];
      if(!Array.isArray(response?.recordings))return [];
      // One seed may fail while another produces usable metadata. Keep those
      // candidates available, but do not cache an incomplete service attempt.
      if(response.retryable===true)cacheable=false;
      const available=recordings(response),count=Math.min(MAX_RECORDINGS,available.length);
      // Native metadata can outlive the resolved-source cache. Rotate the small
      // search window hourly so cached radio metadata can yield new candidates,
      // without spending more searches or adding any listening-history state.
      const offset=available.length?(Math.floor(Math.max(0,clock())/HOUR)%available.length*MAX_RECORDINGS)%available.length:0;
      for(let index=0;index<count;index++){
        const recording=available[(offset+index)%available.length];
        if(!live())return [];
        const value=[...recording.artists,recording.title].join(" ").replace(/\s+/gu," ").trim().slice(0,180);
        let response;
        try{response=await invoke("music_catalog",{kind:"search",value,filter:"songs",language:input.language});}
        catch{if(!live())return [];cacheable=false;continue;}
        if(!live())return [];
        if(!Array.isArray(response?.sections)){cacheable=false;continue;}
        const matches=searchItems(response).filter(item=>recordingMatch(recording,item).confidence==="high")
          .sort((a,b)=>Math.abs(a.duration-recording.duration)-Math.abs(b.duration-recording.duration));
        const found=matches.find(item=>!result.some(other=>other.id===item.id));if(found)result.push(found);
      }
    }catch{cacheable=false;/* Discovery is optional: the primary radio stays available. */}
    if(!live())return [];
    if(cacheable)put(input.key,result);return result;
  }
  return {
    async candidates({seeds=[],artists,tags=[],language="en",isCurrent=()=>true}={}){
      if(typeof invoke!=="function"||!active(isCurrent))return [];
      const selected=Array.isArray(artists)?artists:(Array.isArray(seeds)?seeds.slice(0,32):[]).map(item=>names(item?.artists,1)[0]);
      const artistNames=names(selected),tagNames=[...new Set((Array.isArray(tags)?tags.slice(0,32):[]).filter(value=>typeof value==="string"&&value.length<=40).map(value=>normalize(value).toLowerCase()).filter(value=>tagsAllowed.has(value)))].slice(0,2);
      if(!artistNames.length&&!tagNames.length)return [];
      language=["en","ru","es"].includes(language)?language:"en";
      // The backend treats seeds as a set. Normalize order/case for coalescing,
      // while retaining the supplied spelling in the actual public lookup.
      const key=JSON.stringify([artistNames.map(artistKey).sort(),[...tagNames].sort(),language]);
      const cached=cache.get(key);
      if(cached&&cached.expires>clock()){
        cache.delete(key);cache.set(key,cached);return active(isCurrent)?copy(cached.items):[];
      }
      cache.delete(key);
      let entry=pending.get(key);
      if(!entry){
        // Rapid view changes must not accumulate unbounded retained requests.
        // Existing equivalent consumers can still share their in-flight work.
        if(pending.size>=MAX_KEYS)return [];
        entry={generation,consumers:new Set(),promise:null};pending.set(key,entry);
      }
      entry.consumers.add(isCurrent);
      if(!entry.promise)entry.promise=resolve(entry,{artists:artistNames,tags:tagNames,language,key})
        .finally(()=>{if(pending.get(key)===entry)pending.delete(key);});
      try{
        const items=await entry.promise;
        return entry.generation===generation&&active(isCurrent)?copy(items):[];
      }finally{entry.consumers.delete(isCurrent);}
    },
    clear(){generation++;cache.clear();pending.clear();},
  };
}
