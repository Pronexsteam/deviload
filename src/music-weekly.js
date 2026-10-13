export const WEEKLY_STORAGE_KEY="deviload-music-weekly-v1";
const MAX_BYTES=100*1024,MAX_TRACKS=1000,MAX_ARTISTS=200,MAX_SECONDS=90000;
const validId=value=>typeof value==="string"&&/^[\w-]{11}$/.test(value);
const number=(value,max=MAX_SECONDS)=>typeof value==="number"&&Number.isFinite(value)&&value>=0&&value<=max;
const dayKey=value=>{const d=new Date(value);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;};
const weekKeys=value=>Array.from({length:7},(_,i)=>{const d=new Date(value);d.setHours(12,0,0,0);d.setDate(d.getDate()-i);return dayKey(d);});
const artistName=value=>typeof value==="string"?value.trim().replace(/\s+/g," ").slice(0,48):"";
const artistKey=value=>value.toLowerCase();

// Store only counts and short artist labels, never URLs or playback credentials.
export function createWeeklyStats(storage,{now=Date.now}={}){
  let days=new Map(),tracks=new Map(),artists=new Map(),cappedOn=null;
  const prune=()=>{
    const allowed=new Set(weekKeys(now()));
    for(const date of days.keys())if(!allowed.has(date))days.delete(date);
    for(const [id,date]of tracks)if(!allowed.has(date))tracks.delete(id);
    for(const [key,artist]of artists){
      for(const date of artist.days.keys())if(!allowed.has(date))artist.days.delete(date);
      if(!artist.days.size)artists.delete(key);
    }
    if(!allowed.has(cappedOn))cappedOn=null;
    return allowed;
  };
  const payload=()=>JSON.stringify({version:1,days:[...days],tracks:[...tracks],artists:[...artists.values()].map(artist=>[artist.name,[...artist.days]]),cappedOn});
  const persist=()=>{
    let value=payload();
    // UTF-8 bytes, rather than string length, also bound non-Latin names.
    while(new TextEncoder().encode(value).length>MAX_BYTES&&artists.size){artists.delete(artists.keys().next().value);value=payload();}
    try{storage?.setItem(WEEKLY_STORAGE_KEY,value);}catch{/* Continue tracking in memory when storage is full or blocked. */}
  };
  try{
    const text=storage?.getItem(WEEKLY_STORAGE_KEY);
    if(text&&text.length<=MAX_BYTES&&new TextEncoder().encode(text).length<=MAX_BYTES){
      const raw=JSON.parse(text),allowed=prune();
      if(raw?.version===1){
        for(const row of (Array.isArray(raw.days)?raw.days:[]).slice(0,8)){
          if(!Array.isArray(row)||!allowed.has(row[0])||!Array.isArray(row[1]))continue;
          const [seconds,plays]=row[1];
          if(number(seconds)&&Number.isInteger(plays)&&number(plays,10000))days.set(row[0],[seconds,plays]);
        }
        for(const row of (Array.isArray(raw.tracks)?raw.tracks:[]).slice(0,MAX_TRACKS))if(Array.isArray(row)&&validId(row[0])&&allowed.has(row[1]))tracks.set(row[0],row[1]);
        for(const row of (Array.isArray(raw.artists)?raw.artists:[]).slice(0,MAX_ARTISTS)){
          if(!Array.isArray(row)||!Array.isArray(row[1]))continue;
          const name=artistName(row[0]);if(!name)continue;
          const values=new Map();
          for(const pair of row[1].slice(0,8))if(Array.isArray(pair)&&allowed.has(pair[0])&&number(pair[1]))values.set(pair[0],pair[1]);
          if(values.size)artists.set(artistKey(name),{name,days:values});
        }
        if(allowed.has(raw.cappedOn))cappedOn=raw.cappedOn;
      }
    }
  }catch{/* Ignore corrupt or unavailable local statistics. */}
  // Purge expired data on opening, including when no new music is played.
  prune();persist();
  const rememberTrack=(id,date)=>{
    tracks.delete(id);tracks.set(id,date);
    if(tracks.size>MAX_TRACKS){tracks.delete(tracks.keys().next().value);cappedOn=date;}
  };
  function record({item,seconds=0,qualified=false}={}){
    if(!validId(item?.id)||!number(seconds)||(seconds===0&&qualified!==true))return false;
    const end=now();if(!Number.isFinite(end))return false;
    const allowed=prune(),today=dayKey(end),names=[...new Map((Array.isArray(item.artists)?item.artists:[]).slice(0,10).map(artistName).filter(Boolean).map(name=>[artistKey(name),name])).values()];
    let cursor=end-seconds*1000;
    while(cursor<end){
      const date=dayKey(cursor),midnight=new Date(cursor);midnight.setHours(24,0,0,0);
      const next=Math.min(end,midnight.getTime()),delta=(next-cursor)/1000;
      if(allowed.has(date)&&delta>0){
        const bucket=days.get(date)||[0,0];bucket[0]=Math.min(MAX_SECONDS,bucket[0]+delta);days.set(date,bucket);rememberTrack(item.id,date);
        for(const name of names){
          const key=artistKey(name);
          if(!artists.has(key)){
            if(artists.size>=MAX_ARTISTS){const weakest=[...artists].sort((a,b)=>[...a[1].days.values()].reduce((x,y)=>x+y,0)-[...b[1].days.values()].reduce((x,y)=>x+y,0))[0];artists.delete(weakest[0]);}
            artists.set(key,{name,days:new Map()});
          }
          const artist=artists.get(key);artist.days.set(date,Math.min(MAX_SECONDS,(artist.days.get(date)||0)+delta));
        }
      }
      cursor=next;
    }
    if(qualified===true){const bucket=days.get(today)||[0,0];bucket[1]=Math.min(10000,bucket[1]+1);days.set(today,bucket);rememberTrack(item.id,today);}
    persist();return true;
  }
  function summary(){
    prune();
    const totalSeconds=[...days.values()].reduce((sum,[seconds])=>sum+seconds,0),totalQualifiedPlays=[...days.values()].reduce((sum,[,plays])=>sum+plays,0);
    const ranking=[...artists.values()].map(artist=>({name:artist.name,seconds:[...artist.days.values()].reduce((sum,value)=>sum+value,0)})).sort((a,b)=>b.seconds-a.seconds||a.name.localeCompare(b.name));
    return {totalSeconds,totalMinutes:Math.floor(totalSeconds/60),totalQualifiedPlays,uniqueTracks:tracks.size,uniqueTracksCapped:cappedOn!==null,topArtist:ranking[0]?.name||null,topArtistSeconds:ranking[0]?.seconds||0};
  }
  return {record,summary};
}
