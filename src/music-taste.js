import {tracks} from "./music-state.js";

const DAY=86400000, HALF_LIFE=30*DAY, REPEAT_WINDOW=10*60000, TRACK_COOLDOWN=30*60000;
const MAX_ENTRIES=1000, MAX_CANDIDATES=5000, CLOCK_SKEW=5*60000;
const finite=value=>Number.isFinite(value)?value:0;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const safeNow=value=>Number.isFinite(value)?clamp(value,0,Number.MAX_SAFE_INTEGER):Date.now();
const validId=id=>typeof id==="string"&&/^[\w-]{11}$/.test(id);
const validSong=item=>item?.kind==="song"&&typeof item.title==="string"&&validId(item.id);
const songs=value=>tracks(Array.isArray(value)?value.filter(validSong):[]);
const entryList=profile=>Object.values(profile?.entries&&typeof profile.entries==="object"?profile.entries:{}).filter(entry=>validSong(entry?.item)).slice(0,MAX_ENTRIES);
const limitValue=(value,fallback,maximum=100)=>Number.isFinite(value)?clamp(Math.floor(value),0,maximum):fallback;

// Use the same identity for likes, collaborations, exclusions and followed artists.
// NFKC also joins composed/decomposed names and full-width variants. The display label stays unchanged.
export function canonicalArtistKey(value) {
  return typeof value==="string"&&value.length<=200?value.normalize("NFKC").replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200d\ufeff]/g,"").replace(/\s+/gu," ").trim().toLowerCase():"";
}
export function tasteArtistKeys(item) {
  return [...new Set((Array.isArray(item?.artists)?item.artists.slice(0,10):[]).map(canonicalArtistKey).filter(Boolean))];
}
const names=value=>[...new Set((Array.isArray(value)?value:[]).map(canonicalArtistKey).filter(Boolean))];
function timestamp(value,now) {return Number.isFinite(value)&&value>0&&value<=now+CLOCK_SKEW?Math.min(value,now):null;}
function age(value,now) {const at=timestamp(value,now);return at===null?Infinity:Math.max(0,now-at);}
const decay=(entry,now)=>Math.exp(-Math.LN2*age(entry.at,now)/HALF_LIFE);
const qualified=entry=>Boolean(entry&&(finite(entry.plays)>0||finite(entry.score)>=1));
function exclusions(profile) {
  const hidden=new Set((Array.isArray(profile?.hiddenSongs)?profile.hiddenSongs:[]).filter(validId).slice(0,500));
  const blocked=new Set(names(profile?.blockedArtists).slice(0,300));
  return item=>!hidden.has(item.id)&&!tasteArtistKeys(item).some(key=>blocked.has(key));
}

export function readTaste(storage) {
  let raw;try{const text=storage?.getItem("deviload-music-taste-v1")||"{}";if(text.length<=4*1024*1024)raw=JSON.parse(text);}catch{/* start with an empty profile */}
  const entries=Object.create(null);
  const source=Object.values(raw?.entries&&typeof raw.entries==="object"?raw.entries:{}).filter(entry=>validSong(entry?.item));
  for(const entry of source.sort((a,b)=>finite(b.at)-finite(a.at)).slice(0,MAX_ENTRIES)) {
    entries[entry.item.id]={item:entry.item,score:clamp(finite(entry.score),-8,8),at:clamp(finite(entry.at),0,Number.MAX_SAFE_INTEGER),lastPlayed:clamp(finite(entry.lastPlayed),0,Number.MAX_SAFE_INTEGER),plays:Math.floor(clamp(finite(entry.plays),0,10000))};
  }
  return {version:1,entries,
    hiddenSongs:[...new Set((Array.isArray(raw?.hiddenSongs)?raw.hiddenSongs:[]).filter(validId))].slice(0,500),
    blockedArtists:names(raw?.blockedArtists).slice(0,300),
    mode:["balanced","familiar","discovery"].includes(raw?.mode)?raw.mode:"balanced"};
}

export function hideRecommendation(profile,item,artist=false) {
  if(!validSong(item)||!profile||typeof profile!=="object")return;
  if(artist)profile.blockedArtists=[...new Set([...tasteArtistKeys(item),...names(profile.blockedArtists)])].slice(0,300);
  else profile.hiddenSongs=[...new Set([item.id,...(Array.isArray(profile.hiddenSongs)?profile.hiddenSongs:[]).filter(validId)])].slice(0,500);
}

// Short passive exposure has zero reward and zero qualified plays. Navigation and
// recommendation Next are not durable dislikes: transient fatigue belongs to the
// caller's session state. Calls without an intent retain legacy skip semantics.
export function recordListening(profile,item,evidence={},now=Date.now()) {
  if(!validSong(item)||!profile?.entries||typeof profile.entries!=="object")return false;
  const {seconds:rawSeconds=0,duration:rawDuration=0,skipped=false,session,intent}=evidence||{};
  const seconds=Math.max(0,finite(rawSeconds)),duration=Math.max(0,finite(rawDuration));now=safeNow(now);
  if(seconds<2)return false;
  const ratio=duration>0?Math.min(1,seconds/duration):0;
  const earlySkip=skipped===true&&seconds<20&&(duration===0||ratio<.2);
  const negativeSkip=earlySkip&&intent!=="navigation"&&intent!=="next";
  const currentQualified=seconds>=30||ratio>=.8;
  const reward=negativeSkip?-2.5:ratio>=.8?2.5:seconds>=30?1:0;
  const old=Object.hasOwn(profile.entries,item.id)?profile.entries[item.id]:null;
  // A short passive exposure (including one restored after restart) must not
  // prevent the first qualified listen from teaching taste.
  const recent=old&&(qualified(old)||finite(old.score)<0)&&age(old.lastPlayed,now)<REPEAT_WINDOW;
  const sameSession=session!==undefined&&old?.session===session;
  const sessionEligible=sameSession?old.sessionEligible===true:!recent;
  const sessionReward=sessionEligible?reward:0;
  const adjustment=sessionReward-(sameSession?finite(old.sessionReward):0);
  const counted=Boolean(sameSession&&old.sessionCounted);
  const sessionCounted=counted||Boolean(sessionEligible&&currentQualified);
  // A brief revisit must not turn cumulative old plays into a new qualified
  // cooldown. Legacy negative skips retain their original timestamp semantics.
  const lastPlayed=qualified(old)&&!currentQualified&&!negativeSkip?Math.max(0,finite(old.lastPlayed)):now;
  profile.entries[item.id]={item,score:clamp((old?clamp(finite(old.score),-8,8)*decay(old,now):0)+adjustment,-8,8),at:now,lastPlayed,
    plays:Math.min(10000,Math.max(0,finite(old?.plays))+(sessionCounted&&!counted?1:0)),session,sessionReward,sessionEligible,sessionCounted};
  const all=Object.entries(profile.entries).sort((a,b)=>finite(b[1]?.at)-finite(a[1]?.at));
  for(const [id]of all.slice(MAX_ENTRIES))delete profile.entries[id];
  return true;
}

// A mean of the strongest three distinct-track signals limits discography-size
// bias. Age is applied before averaging, and weak old evidence cannot drown out
// a new listen. A collaboration divides its credit between its named artists.
function addEvidence(map,key,value,at) {
  if(Math.abs(value)<.001)return;
  const values=map.get(key)||[];values.push({value,at});values.sort((a,b)=>Math.abs(b.value)-Math.abs(a.value)||b.at-a.at);map.set(key,values.slice(0,3));
}
function meanEvidence(values=[]) {
  const weight=values.reduce((sum,row)=>sum+Math.abs(row.value),0);
  return weight?values.reduce((sum,row)=>sum+row.value*Math.abs(row.value),0)/weight:0;
}
function affinities(profile,favorites,now,followedArtists=[]) {
  const allowed=exclusions(profile),entries=new Map(),songScores=new Map(),history=new Map(),likes=new Map(),knownArtists=new Set(),recentArtists=new Map();
  const favoriteSongs=songs(favorites),liked=new Set(favoriteSongs.map(item=>item.id)),followed=new Set(names(followedArtists));
  for(const entry of entryList(profile)) {
    if(!allowed(entry.item))continue;
    const score=clamp(finite(entry.score),-8,8)*decay(entry,now),keys=tasteArtistKeys(entry.item);
    entries.set(entry.item.id,entry);songScores.set(entry.item.id,score);
    for(const key of keys) {
      addEvidence(history,key,score/keys.length,timestamp(entry.at,now)||0);
      // Interest can fade or turn negative without making a previously heard
      // artist a discovery again. Familiarity lasts within the retained history.
      if(qualified(entry)&&age(entry.lastPlayed,now)<Infinity)knownArtists.add(key);
      const since=age(entry.lastPlayed,now);
      if(qualified(entry)&&since<6*3600000)recentArtists.set(key,(recentArtists.get(key)||0)+Math.exp(-since/(2*3600000))/keys.length);
    }
  }
  for(const item of favoriteSongs) {
    if(!allowed(item))continue;
    songScores.set(item.id,(songScores.get(item.id)||0)+5);
    const keys=tasteArtistKeys(item);
    for(const key of keys){addEvidence(likes,key,4/keys.length,0);knownArtists.add(key);}
  }
  const artists=new Map();
  for(const key of new Set([...history.keys(),...likes.keys()]))artists.set(key,clamp(meanEvidence(history.get(key))*.8+meanEvidence(likes.get(key)),-6,8));
  for(const key of followed)knownArtists.add(key);
  return {entries,songs:songScores,artists,liked,knownArtists,recentArtists,followed,allowed};
}
function jitter(random) {
  try{return (clamp(finite(typeof random==="function"?random():.5),0,1)-.5)*.2;}catch{return 0;}
}
function rankingAdjustment(values,id,minimum,maximum) {
  // Only actual Maps are accepted; arbitrary imported objects/getters are not a
  // scoring callback. Non-finite values cannot poison comparisons or exclusions.
  return values instanceof Map?clamp(finite(Map.prototype.get.call(values,id)),minimum,maximum):0;
}
function sessionAffinity(items) {
  const artists=new Map();
  const context=songs(Array.isArray(items)?items.slice(0,40):[]);
  context.forEach((item,index)=>{
    const keys=tasteArtistKeys(item),weight=Math.exp(-index/6)/Math.max(1,keys.length);
    for(const key of keys)artists.set(key,Math.min(1,(artists.get(key)||0)+weight));
  });
  return artists;
}

export function tasteSeeds(profile,favorites,{now=Date.now(),random=Math.random,limit=3}={}) {
  now=safeNow(now);limit=limitValue(limit,3,10);if(!limit)return [];
  const evidence=affinities(profile,favorites,now);
  const candidates=songs([...songs(favorites),...entryList(profile).map(entry=>entry.item)])
    .filter(item=>evidence.allowed(item)&&(evidence.songs.get(item.id)||0)>0)
    .map((item,index)=>({item,index,keys:tasteArtistKeys(item),score:(evidence.songs.get(item.id)||0)+Math.max(0,...tasteArtistKeys(item).map(key=>evidence.artists.get(key)||0))*.2+jitter(random)}))
    .sort((a,b)=>b.score-a.score||a.index-b.index);
  const chosen=[],seen=new Set();
  for(const {item,keys}of candidates) {
    if(keys.some(key=>seen.has(key)))continue;
    chosen.push(item);for(const key of keys)seen.add(key);if(chosen.length>=limit)break;
  }
  return chosen;
}

function reasonFor(item,evidence,now) {
  const keys=tasteArtistKeys(item),display=key=>(item.artists||[]).find(name=>canonicalArtistKey(name)===key)?.normalize("NFKC").replace(/\s+/gu," ").trim()||key;
  if(evidence.liked.has(item.id))return {code:"liked"};
  if(!keys.length)return {code:"catalog"};
  const followed=keys.find(key=>evidence.followed.has(key));if(followed)return {code:"followed_artist",artist:display(followed)};
  const entry=evidence.entries.get(item.id);
  if(qualified(entry)&&age(entry.lastPlayed,now)<Infinity)return {code:"listening_history"};
  const related=keys.filter(key=>(evidence.artists.get(key)||0)>.2).sort((a,b)=>evidence.artists.get(b)-evidence.artists.get(a))[0];
  if(related)return {code:"related_artist",artist:display(related)};
  return {code:keys.some(key=>evidence.knownArtists.has(key))?"catalog":"discovery"};
}

// Reason codes describe observed local signals, never inferred genre/audio similarity.
export function recommendationReason(item,profile,favorites,{now=Date.now(),followedArtists=[]}={}) {
  if(!validSong(item))return {code:"catalog"};
  now=safeNow(now);return reasonFor(item,affinities(profile,favorites,now,followedArtists),now);
}

// Context is most-recent-first. It affects recommendations only, never a manually
// assembled queue. Artist cooldown is soft so a one-artist radio can still continue.
export function recommendWithReasons(items,profile,favorites,{now=Date.now(),random=Math.random,limit=20,exclude=[],followedArtists=[],contextItems=[],recentArtists=[],sessionItems=[],candidateScores,itemAdjustments}={}) {
  now=safeNow(now);limit=limitValue(limit,20);if(!limit)return [];
  const evidence=affinities(profile,favorites,now,followedArtists),excluded=new Set(Array.isArray(exclude)?exclude.filter(validId):[]);
  const mode=["familiar","discovery"].includes(profile?.mode)?profile.mode:"balanced",context=new Map();
  // Positive session fit is deliberately limited to named artists. Candidate
  // retrieval may add bounded source evidence, never invented audio/genre labels.
  const sessionArtists=sessionAffinity(sessionItems);
  const past=songs(contextItems).slice(0,40),recent=(Array.isArray(recentArtists)?recentArtists:[]).slice(0,40).map(canonicalArtistKey).filter(Boolean);
  past.forEach((item,index)=>{for(const key of tasteArtistKeys(item))context.set(key,(context.get(key)||0)+Math.exp(-index/6));});
  recent.forEach((key,index)=>context.set(key,(context.get(key)||0)+Math.exp(-index/6)));
  let previous=new Set(past.length?tasteArtistKeys(past[0]):recent.slice(0,1));
  const pool=songs(Array.isArray(items)?items.slice(0,MAX_CANDIDATES):[]).filter(item=>evidence.allowed(item)&&!excluded.has(item.id))
    .map((item,index)=>{
      const entry=evidence.entries.get(item.id),keys=tasteArtistKeys(item),since=age(entry?.lastPlayed,now),heard=qualified(entry)&&since<Infinity,score=evidence.songs.get(item.id)||0;
      if((score<=-2&&!evidence.liked.has(item.id))||(heard&&since<TRACK_COOLDOWN))return null;
      const knownArtist=keys.some(key=>evidence.knownArtists.has(key)),affinity=keys.length?Math.max(...keys.map(key=>evidence.artists.get(key)||0)):0;
      const freshness=heard?Math.exp(-since/(2*DAY)):0;
      const preference=mode==="discovery"?(!knownArtist?5:heard?-2.5:-1):mode==="familiar"?(knownArtist?4:0)+(heard||evidence.liked.has(item.id)?2:0):!knownArtist?.45:0;
      const artistCooldown=Math.max(0,...keys.map(key=>Math.min(2.5,Math.log1p(evidence.recentArtists.get(key)||0))));
      const contextPenalty=Math.max(0,...keys.map(key=>Math.min(3,context.get(key)||0)))*1.5;
      const sessionFit=Math.max(0,...keys.map(key=>sessionArtists.get(key)||0))*2;
      const sourceFit=rankingAdjustment(candidateScores,item.id,0,3),adjustment=rankingAdjustment(itemAdjustments,item.id,-6,0);
      return {item,index,keys,knownArtist,score:score*.8+affinity*.8-freshness*3+preference+(keys.some(key=>evidence.followed.has(key))?4:0)+sessionFit+sourceFit+adjustment-artistCooldown-contextPenalty+jitter(random)};
    }).filter(Boolean);
  const counts=new Map(),artists=new Set(pool.flatMap(row=>row.keys)),cap=Math.max(2,Math.ceil(limit/Math.max(1,artists.size))),flexible=artists.size<3,result=[];
  const frequency=mode==="discovery"?2:mode==="familiar"?6:3;
  while(pool.length&&result.length<limit) {
    let available=pool.filter(row=>row.keys.every(key=>(counts.get(key)||0)<cap));if(!available.length){if(!flexible)break;available=pool;}
    const nonAdjacent=available.filter(row=>!row.keys.some(key=>previous.has(key)));
    if(nonAdjacent.length)available=nonAdjacent;
    else if(flexible){const alternatives=pool.filter(row=>!row.keys.some(key=>previous.has(key)));if(alternatives.length)available=alternatives;}
    if(result.length%frequency===frequency-1){const discoveries=available.filter(row=>!row.knownArtist);if(discoveries.length)available=discoveries;}
    let chosen=null,best=-Infinity;
    for(const row of available) {
      const repeats=row.keys.length?Math.max(...row.keys.map(key=>counts.get(key)||0)):0;
      const share=row.keys.reduce((sum,key)=>sum+(counts.get(key)||0),0);
      const score=row.score-repeats*1.8-share*.35;
      if(score>best||(score===best&&row.index<chosen.index)){chosen=row;best=score;}
    }
    pool.splice(pool.indexOf(chosen),1);result.push({item:chosen.item,reason:reasonFor(chosen.item,evidence,now)});
    previous=new Set(chosen.keys);for(const key of chosen.keys)counts.set(key,(counts.get(key)||0)+1);
  }
  return result;
}

export function recommend(items,profile,favorites,options={}) {return recommendWithReasons(items,profile,favorites,options).map(row=>row.item);}

export function listeningClock() {
  let position=null,wall=null,seconds=0,wasPlaying=false;
  return {
    sample(time,now,playing) {
      if(!Number.isFinite(time)||!Number.isFinite(now)||time<0){position=null;wall=null;wasPlaying=false;return seconds;}
      if(playing===true&&wasPlaying&&position!==null&&wall!==null) {
        const delta=time-position,elapsed=(now-wall)/1000;
        if(delta>0&&elapsed>0&&delta<=Math.min(60,elapsed+.5))seconds+=Math.min(delta,elapsed);
      }
      position=time;wall=now;wasPlaying=playing===true;return seconds;
    },
    reset(){position=null;wall=null;seconds=0;wasPlaying=false;},
    get seconds(){return seconds;}
  };
}
