import {tracks} from "./music-state.js";

const DAY=86400000, HALF_LIFE=30*DAY;
const finite=value=>Number.isFinite(value)?value:0;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const decay=(entry,now)=>Math.exp(-Math.LN2*Math.max(0,now-entry.at)/HALF_LIFE);
const artistKeys=item=>(Array.isArray(item.artists)?item.artists:[]).filter(name=>typeof name==="string"&&name.length<200).map(name=>name.trim().toLocaleLowerCase()).filter(Boolean);

export function readTaste(storage) {
  let raw;try{raw=JSON.parse(storage?.getItem("deviload-music-taste-v1")||"{}");}catch{/* start with an empty profile */}
  const entries=Object.create(null);
  for(const entry of Object.values(raw?.entries||{}).sort((a,b)=>(b?.at||0)-(a?.at||0)).slice(0,1000)) {
    if(!tracks([entry?.item]).length)continue;
    entries[entry.item.id]={item:entry.item,score:clamp(finite(entry.score),-8,8),at:Math.max(0,finite(entry.at)),lastPlayed:Math.max(0,finite(entry.lastPlayed)),plays:clamp(finite(entry.plays),0,10000)};
  }
  return {version:1,entries,
    hiddenSongs:(Array.isArray(raw?.hiddenSongs)?raw.hiddenSongs:[]).filter(id=>typeof id==="string"&&/^[\w-]{11}$/.test(id)).slice(0,500),
    blockedArtists:(Array.isArray(raw?.blockedArtists)?raw.blockedArtists:[]).filter(name=>typeof name==="string"&&name.length<200).map(name=>name.trim().toLocaleLowerCase()).filter(Boolean).slice(0,300),
    mode:["balanced","familiar","discovery"].includes(raw?.mode)?raw.mode:"balanced"};
}

export function hideRecommendation(profile,item,artist=false) {
  if(!tracks([item]).length)return;
  if(artist)profile.blockedArtists=[...new Set([...artistKeys(item),...profile.blockedArtists])].slice(0,300);
  else profile.hiddenSongs=[...new Set([item.id,...profile.hiddenSongs])].slice(0,500);
}

function allowed(profile,item) {return !profile.hiddenSongs.includes(item.id)&&!artistKeys(item).some(key=>profile.blockedArtists.includes(key));}

// Likes remain explicit preferences; listening evidence gradually fades so a
// user can change taste. A seek or a paused player is never listening evidence.
export function recordListening(profile,item,{seconds=0,duration=0,skipped=false,session},now=Date.now()) {
  seconds=Math.max(0,finite(seconds));duration=Math.max(0,finite(duration));
  if(!tracks([item]).length||seconds<2)return false;
  const ratio=duration>0?Math.min(1,seconds/duration):0;
  const earlySkip=skipped&&seconds<20&&(duration===0||ratio<.2);
  const reward=earlySkip?-2.5:ratio>=.8?2.5:seconds>=30?1:0;
  const old=profile.entries[item.id];
  // Decide repeat eligibility once per session. Later checkpoints must not
  // turn a suppressed repeat into new listening evidence.
  const recent=old&&now-old.lastPlayed<10*60000;
  const sameSession=session!==undefined&&old?.session===session;
  const sessionEligible=sameSession?old.sessionEligible:!recent;
  const sessionReward=sessionEligible?reward:0;
  const adjustment=sessionReward-(sameSession?finite(old.sessionReward):0);
  const qualified=seconds>=30||ratio>=.8;
  const counted=Boolean(sameSession&&old.sessionCounted);
  const sessionCounted=counted||Boolean(sessionEligible&&qualified);
  profile.entries[item.id]={item,score:clamp((old?old.score*decay(old,now):0)+adjustment,-8,8),at:now,lastPlayed:now,plays:Math.min(10000,(old?.plays||0)+(sessionCounted&&!counted?1:0)),session,sessionReward,sessionEligible,sessionCounted};
  const all=Object.entries(profile.entries).sort((a,b)=>b[1].at-a[1].at);
  for(const [id]of all.slice(1000))delete profile.entries[id];
  return true;
}

function affinities(profile,favorites,now) {
  const songs=new Map(),artists=new Map(),liked=new Set(tracks(favorites).map(item=>item.id));
  for(const entry of Object.values(profile.entries)) {
    const score=entry.score*decay(entry,now);
    songs.set(entry.item.id,score);
    for(const artist of artistKeys(entry.item))artists.set(artist,clamp((artists.get(artist)||0)+score,-15,15));
  }
  for(const item of tracks(favorites)) {
    songs.set(item.id,(songs.get(item.id)||0)+5);
    for(const artist of artistKeys(item))artists.set(artist,clamp((artists.get(artist)||0)+4,-15,15));
  }
  return {songs,artists,liked};
}

export function tasteSeeds(profile,favorites,{now=Date.now(),random=Math.random,limit=3}={}) {
  const {songs,artists}=affinities(profile,favorites,now);
  const candidates=tracks([...favorites,...Object.values(profile.entries).map(entry=>entry.item)])
    .filter(item=>allowed(profile,item)&&(songs.get(item.id)||0)>0)
    .map(item=>({item,score:(songs.get(item.id)||0)+Math.max(0,...artistKeys(item).map(key=>artists.get(key)||0))*.2+random()*4}))
    .sort((a,b)=>b.score-a.score);
  const chosen=[],seen=new Set();
  for(const {item}of candidates) {
    const artist=artistKeys(item)[0]||item.id;
    if(seen.has(artist))continue;
    chosen.push(item);seen.add(artist);if(chosen.length>=limit)break;
  }
  return chosen;
}

export function recommend(items,profile,favorites,{now=Date.now(),random=Math.random,limit=20,exclude=[],followedArtists=[]}={}) {
  const {songs,artists,liked}=affinities(profile,favorites,now),excluded=new Set(exclude);
  const followed=new Set(followedArtists.map(name=>name.trim().toLocaleLowerCase()));
  const pool=tracks(items).filter(item=>allowed(profile,item)&&!excluded.has(item.id)&&((songs.get(item.id)||0)>-2||liked.has(item.id)))
    .map(item=>{
      const entry=profile.entries[item.id],heard=entry?.lastPlayed>0;
      const freshness=heard?Math.exp(-Math.max(0,now-entry.lastPlayed)/(2*DAY)):0;
      const keys=artistKeys(item);
      const affinity=keys.length?Math.max(-10,...keys.map(key=>artists.get(key)||0)):0;
      const preference=profile.mode==="discovery"?(!heard?5:-2):profile.mode==="familiar"?(heard||liked.has(item.id)?5:0):0;
      return {item,heard,score:(songs.get(item.id)||0)*.5+affinity*.6-freshness*5+preference+(keys.some(key=>followed.has(key))?3:0)+random()*3};
    }).sort((a,b)=>b.score-a.score);
  const result=[],counts=new Map();
  // Every third slot explores an unheard song. Artist limits prevent a liked
  // artist from turning the entire queue into their discography.
  while(pool.length&&result.length<limit) {
    const frequency=profile.mode==="discovery"?2:profile.mode==="familiar"?6:3;
    const explore=result.length%frequency===frequency-1;
    let choice=pool.findIndex(({item,heard})=>(!explore||!heard)&&artistKeys(item).every(key=>(counts.get(key)||0)<2));
    if(choice<0)choice=pool.findIndex(({item})=>artistKeys(item).every(key=>(counts.get(key)||0)<2));
    if(choice<0)break;
    const {item}=pool.splice(choice,1)[0];result.push(item);
    for(const key of artistKeys(item))counts.set(key,(counts.get(key)||0)+1);
  }
  return result;
}

export function listeningClock() {
  let position=null,wall=null,seconds=0;
  return {
    sample(time,now,playing) {
      if(playing&&position!==null&&wall!==null) {
        const delta=time-position,elapsed=(now-wall)/1000;
        if(delta>0&&elapsed>0&&delta<=Math.min(60,elapsed+.5))seconds+=Math.min(delta,elapsed);
      }
      position=time;wall=now;return seconds;
    },
    reset(){position=null;wall=null;seconds=0;},
    get seconds(){return seconds;}
  };
}
