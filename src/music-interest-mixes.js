import {tracks} from "./music-state.js";
import {canonicalArtistKey,tasteArtistKeys,recommendWithReasons,familiarArtistKeys} from "./music-taste.js";

export const MAX_INTEREST_MIXES=8,MAX_INTEREST_PLAYLISTS=8;
const MAX_BASE_MEMBERS=500,MAX_LEARNED=100,MAX_MEMBERS=MAX_BASE_MEMBERS+MAX_LEARNED,MAX_ENTRIES=1000,MAX_CANDIDATES=5000,NAME_BYTES=160,CLOCK_SKEW=5*60000;
const id=value=>typeof value==="string"&&/^[-\w]{1,64}$/.test(value);
const songId=value=>typeof value==="string"&&/^[\w-]{11}$/.test(value);
const object=value=>value!==null&&typeof value==="object"&&!Array.isArray(value);
const finite=value=>Number.isFinite(value)?value:0;
const clean=items=>tracks(Array.isArray(items)?items.slice(0,MAX_MEMBERS):[]);
const encoder=new TextEncoder();
const fail=()=>{throw Error("Invalid interest mixes.");};
function label(value,strict){
  if(typeof value!=="string")return "";
  const normalized=value.replace(/[\u0000-\u001f\u007f]/g,"").replace(/\s+/gu," ").trim();
  let result="",bytes=0;
  for(const char of normalized){const size=encoder.encode(JSON.stringify(char)).length-2;if(bytes+size>NAME_BYTES){if(strict)fail();break;}bytes+=size;result+=char;}
  return result;
}
const playlistList=values=>(Array.isArray(values)?values.slice(0,30):[]).filter(list=>object(list)&&id(list.id));

// Persist only the user's configuration, never another copy of listening history
// or song metadata. A deleted playlist removes its reference, not the named mix.
export function sanitizeInterestMixes(values=[],playlists=[],{strict=false}={}){
  if(!Array.isArray(values)){if(strict)fail();return [];}
  if(strict&&values.length>MAX_INTEREST_MIXES)fail();
  const available=new Set(playlistList(playlists).map(list=>list.id)),seen=new Set(),result=[];
  for(const value of values.slice(0,MAX_INTEREST_MIXES)){
    if(!object(value)||!id(value.id)||seen.has(value.id)){if(strict)fail();continue;}
    const name=label(value.name,strict);
    if(!name||!Array.isArray(value.playlistIds)){if(strict)fail();continue;}
    if(strict&&value.playlistIds.length>MAX_INTEREST_PLAYLISTS)fail();
    const refs=[],used=new Set();
    for(const key of value.playlistIds.slice(0,MAX_INTEREST_PLAYLISTS)){
      if(!id(key)||used.has(key)){if(strict)fail();continue;}
      used.add(key);if(available.has(key))refs.push(key);
    }
    const learned=[];
    if(value.learnedIds!==undefined){
      if(!Array.isArray(value.learnedIds)){if(strict)fail();}
      else{
        if(strict&&value.learnedIds.length>MAX_LEARNED)fail();
        const usedLearned=new Set();
        for(const key of value.learnedIds.slice(0,MAX_LEARNED)){
          if(!songId(key)||usedLearned.has(key)){if(strict)fail();continue;}
          usedLearned.add(key);learned.push(key);
        }
      }
    }
    seen.add(value.id);result.push({id:value.id,name,playlistIds:refs,...(learned.length?{learnedIds:learned}:{})});
  }
  return result;
}

function sourceLists(saved,mixId){
  const playlists=playlistList(saved?.playlists),mix=sanitizeInterestMixes(saved?.interestMixes,playlists).find(value=>value.id===mixId)||null;
  const byId=new Map(playlists.map(list=>[list.id,list]));
  return {mix,lists:mix?mix.playlistIds.map(key=>byId.get(key)).filter(Boolean):[]};
}
function interleave(lists,maximum=MAX_BASE_MEMBERS){
  const pools=lists.map(list=>clean(Array.isArray(list.items)?list.items.slice(0,500):[])),result=[],seen=new Set();
  for(let index=0;result.length<maximum;index++){
    let found=false;
    for(const pool of pools){const item=pool[index];if(!item)continue;found=true;if(!seen.has(item.id)){seen.add(item.id);result.push(item);if(result.length===maximum)break;}}
    if(!found)break;
  }
  return result;
}
function membersFor(lists,mix,taste,now){
  const base=interleave(lists),learned=[];
  for(const key of mix?.learnedIds||[]){const entry=taste?.entries?.[key];
    if(entry?.item?.id===key&&finite(entry.plays)>0&&historyDate(entry.lastPlayed,now)&&clean([entry.item]).length)learned.push(entry.item);
  }
  // Newly qualified discoveries are represented alongside the original sources,
  // not buried behind a long playlist. Only references are ever persisted.
  return learned.length?interleave([{items:base},{items:learned}],MAX_MEMBERS):base;
}
export function interestSources(saved,mixId,taste={}, {now=Date.now()}={}){
  const {mix,lists}=sourceLists(saved,mixId);return membersFor(lists,mix,taste,safeNow(now));
}
export function rememberInterestTrack(mixes,mixId,trackId){
  if(!Array.isArray(mixes)||!id(mixId)||!songId(trackId)||!mixes.some(value=>value?.id===mixId))return mixes;
  return mixes.map(value=>value?.id===mixId?{...value,learnedIds:[...new Set([trackId,...(Array.isArray(value.learnedIds)?value.learnedIds:[]).filter(songId)])].slice(0,MAX_LEARNED)}:value);
}

function scopeOf(members){
  const ids=new Set(members.map(item=>item.id)),artists=new Set(members.flatMap(tasteArtistKeys));
  return {ids,artists,includes:item=>ids.has(item?.id)||tasteArtistKeys(item).some(key=>artists.has(key))};
}
function exclusions(taste){
  const hidden=new Set((Array.isArray(taste?.hiddenSongs)?taste.hiddenSongs:[]).filter(songId).slice(0,500));
  const blocked=new Set((Array.isArray(taste?.blockedArtists)?taste.blockedArtists:[]).slice(0,300).map(canonicalArtistKey).filter(Boolean));
  return {hidden,blocked,allowed:item=>!hidden.has(item.id)&&!tasteArtistKeys(item).some(key=>blocked.has(key))};
}
const qualified=entry=>finite(entry?.plays)>0||finite(entry?.score)>=1;
const historyDate=(value,now)=>Number.isFinite(value)&&value>0&&value<=now+CLOCK_SKEW;
const safeNow=value=>Number.isFinite(value)&&value>=0?value:Date.now();

// The scoped object is ephemeral. Related qualified events provide positive
// affinity; out-of-scope entries retain only exact-item rejection/cooldown data.
export function interestProfile(saved,taste,mixId,{now=Date.now()}={}){
  now=safeNow(now);const {mix,lists}=sourceLists(saved,mixId),members=membersFor(lists,mix,taste,now),scope=scopeOf(members),rules=exclusions(taste);
  const entries=Object.create(null),source=object(taste?.entries)?Object.values(taste.entries).slice(0,MAX_ENTRIES):[];
  for(const entry of source){
    if(!clean([entry?.item]).length)continue;
    const related=scope.includes(entry.item),positive=related&&qualified(entry)&&historyDate(entry.lastPlayed,now),score=Math.max(-8,Math.min(8,finite(entry.score)));
    entries[entry.item.id]={item:related?entry.item:{...entry.item,artists:[]},score:positive?score:Math.min(0,score),
      at:Math.max(0,finite(entry.at)),lastPlayed:Math.max(0,finite(entry.lastPlayed)),plays:Math.max(0,Math.min(10000,Math.floor(finite(entry.plays))))};
  }
  const favorites=tracks(Array.isArray(saved?.favorites)?saved.favorites:[]).filter(scope.includes);
  return {mix,members,artistKeys:[...scope.artists],favorites,
    profile:{version:1,entries,hiddenSongs:[...rules.hidden],blockedArtists:[...rules.blocked],mode:["balanced","familiar","discovery"].includes(taste?.mode)?taste.mode:"balanced"}};
}

function representatives(items,limit,rotation=0){
  if(!items.length||!limit)return [];
  const start=Number.isSafeInteger(rotation)?((rotation%items.length)+items.length)%items.length:0;
  const rotated=[...items.slice(start),...items.slice(0,start)],result=[],seen=new Set();
  for(const item of rotated){const keys=tasteArtistKeys(item);if(keys.some(key=>seen.has(key)))continue;result.push(item);for(const key of keys)seen.add(key);if(result.length===limit)break;}
  return result;
}
function eligibleMembers(scope,taste){
  const rules=exclusions(taste),liked=new Set(scope.favorites.map(item=>item.id));
  // A rejected source is not a useful radio seed. An explicit retained like is
  // still intentional preference; final candidate exclusions remain in the core.
  return scope.members.filter(item=>rules.allowed(item)&&(!(finite(taste?.entries?.[item.id]?.score)<0)||liked.has(item.id)));
}
export function interestSeeds(saved,taste,mixId,{limit=3,rotation=0,now=Date.now()}={}){
  limit=Number.isFinite(limit)?Math.max(0,Math.min(8,Math.floor(limit))):3;
  const scope=interestProfile(saved,taste,mixId,{now});
  return scope.mix?representatives(eligibleMembers(scope,taste),limit,rotation):[];
}

// Candidates come from the selected mix's source radios. This wrapper isolates
// preference, not acoustic genres: it must not claim that an unknown artist has
// a measured sonic similarity to the playlist.
export function rankInterestMix(candidates,saved,taste,mixId,options={}){
  const now=safeNow(options?.now),scope=interestProfile(saved,taste,mixId,{now});
  const members=eligibleMembers(scope,taste);
  if(!scope.mix||!members.length)return [];
  const direction=scopeOf(scope.members);
  const followed=(Array.isArray(saved?.collections)?saved.collections:[]).filter(item=>item?.kind==="artist").map(item=>item.title);
  if(Array.isArray(options?.followedArtists))followed.push(...options.followedArtists);
  const relevantFollowed=[...new Set(followed.map(canonicalArtistKey).filter(key=>direction.artists.has(key)))];
  const familiar=familiarArtistKeys(taste,Array.isArray(saved?.favorites)?saved.favorites:[],{now,followedArtists:followed});
  // Global familiarity still describes identity honestly, but cannot make an
  // unrelated favorite outrank this mix's sources in Familiar mode.
  const familiarBoostIds=tracks(Array.isArray(candidates)?candidates.slice(0,MAX_CANDIDATES):[]).filter(direction.includes).map(item=>item.id);
  const session=clean(options?.sessionItems).filter(direction.includes);
  const profile={...scope.profile,mode:["balanced","familiar","discovery"].includes(options?.mode)?options.mode:scope.profile.mode};
  return recommendWithReasons(candidates,profile,scope.favorites,{...options,now,
    random:typeof options?.random==="function"?options.random:()=>.5,
    followedArtists:relevantFollowed,familiarArtists:familiar,familiarBoostIds,
    sessionItems:session.length?session:representatives(members,40)});
}
