export const WEEKLY_STORAGE_KEY="deviload-music-weekly-v1";
const MAX_BYTES=160*1024,MAX_TRACKS=1000,MAX_ARTISTS=200,MAX_SONGS=300,MAX_SECONDS=90000;
// Monthly archive for Recap: totals and the leading artists and songs of each month, kept a little over a year.
const MONTHS_KEPT=13,MONTH_ARTISTS=20,MONTH_SONGS=25,MONTH_SECONDS=31*86400;
const validId=value=>typeof value==="string"&&/^[\w-]{11}$/.test(value);
const number=(value,max=MAX_SECONDS)=>typeof value==="number"&&Number.isFinite(value)&&value>=0&&value<=max;
const dayKey=value=>{const d=new Date(value);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;};
const weekKeys=value=>Array.from({length:7},(_,i)=>{const d=new Date(value);d.setHours(12,0,0,0);d.setDate(d.getDate()-i);return dayKey(d);});
const artistName=value=>typeof value==="string"?value.trim().replace(/\s+/g," ").slice(0,48):"";
const artistKey=value=>value.toLowerCase();
const songTitle=value=>typeof value==="string"?value.trim().replace(/\s+/g," ").slice(0,80):"";
const total=values=>[...values].reduce((sum,value)=>sum+value,0);
const monthKey=date=>date.slice(0,7);
// Days a little older than the week are still read, so they can be folded into their month.
const recentKeys=value=>new Set(Array.from({length:62},(_,i)=>{const d=new Date(value);d.setHours(12,0,0,0);d.setDate(d.getDate()-i);return dayKey(d);}));

// Store only counts and short artist labels, never URLs or playback credentials.
export function createWeeklyStats(storage,{now=Date.now}={}){
  // Songs keep a short title and first artist for the detailed view; never a URL or artwork address.
  let days=new Map(),tracks=new Map(),artists=new Map(),songs=new Map(),months=new Map(),cappedOn=null;
  const month=key=>{if(!months.has(key))months.set(key,{seconds:0,plays:0,artists:new Map(),songs:new Map()});return months.get(key);};
  const keepTop=(map,limit,value)=>{if(map.size<=limit)return;const kept=[...map].sort((a,b)=>value(b[1])-value(a[1])).slice(0,limit);map.clear();for(const [key,item]of kept)map.set(key,item);};
  const trimMonths=()=>{
    for(const entry of months.values()){keepTop(entry.artists,MONTH_ARTISTS,v=>v);keepTop(entry.songs,MONTH_SONGS,v=>v.seconds);}
    const keys=[...months.keys()].sort();for(const key of keys.slice(0,Math.max(0,keys.length-MONTHS_KEPT)))months.delete(key);
  };
  const prune=()=>{
    const allowed=new Set(weekKeys(now()));
    // A day leaving the week is folded into its month before it is forgotten.
    let folded=false;
    for(const [date,[seconds,plays]]of days)if(!allowed.has(date)){const entry=month(monthKey(date));entry.seconds=Math.min(MONTH_SECONDS,entry.seconds+seconds);entry.plays+=plays;folded=true;}
    for(const artist of artists.values())for(const [date,seconds]of artist.days)if(!allowed.has(date)){const entry=month(monthKey(date));entry.artists.set(artist.name,(entry.artists.get(artist.name)||0)+seconds);folded=true;}
    for(const [id,song]of songs)for(const [date,seconds]of song.days)if(!allowed.has(date)){const entry=month(monthKey(date)),old=entry.songs.get(id);entry.songs.set(id,{title:song.title||old?.title||"",artist:song.artist||old?.artist||"",seconds:(old?.seconds||0)+seconds});folded=true;}
    if(folded)trimMonths();
    for(const date of days.keys())if(!allowed.has(date))days.delete(date);
    for(const [id,date]of tracks)if(!allowed.has(date))tracks.delete(id);
    for(const [key,artist]of artists){
      for(const date of artist.days.keys())if(!allowed.has(date))artist.days.delete(date);
      if(!artist.days.size)artists.delete(key);
    }
    for(const [id,song]of songs){
      for(const date of song.days.keys())if(!allowed.has(date))song.days.delete(date);
      if(!song.days.size)songs.delete(id);
    }
    if(!allowed.has(cappedOn))cappedOn=null;
    return allowed;
  };
  const payload=()=>JSON.stringify({version:1,days:[...days],tracks:[...tracks],artists:[...artists.values()].map(artist=>[artist.name,[...artist.days]]),songs:[...songs].map(([id,song])=>[id,song.title,song.artist,[...song.days]]),months:[...months].map(([key,entry])=>[key,entry.seconds,entry.plays,[...entry.artists],[...entry.songs].map(([id,song])=>[id,song.title,song.artist,song.seconds])]),cappedOn});
  const persist=()=>{
    let value=payload();
    // UTF-8 bytes, rather than string length, also bound non-Latin names.
    while(new TextEncoder().encode(value).length>MAX_BYTES&&(songs.size||artists.size)){if(songs.size)songs.delete(songs.keys().next().value);else artists.delete(artists.keys().next().value);value=payload();}
    try{storage?.setItem(WEEKLY_STORAGE_KEY,value);}catch{/* Continue tracking in memory when storage is full or blocked. */}
  };
  try{
    const text=storage?.getItem(WEEKLY_STORAGE_KEY);
    if(text&&text.length<=MAX_BYTES&&new TextEncoder().encode(text).length<=MAX_BYTES){
      const raw=JSON.parse(text),allowed=recentKeys(now());
      if(raw?.version===1){
        for(const row of (Array.isArray(raw.days)?raw.days:[]).slice(0,62)){
          if(!Array.isArray(row)||!allowed.has(row[0])||!Array.isArray(row[1]))continue;
          const [seconds,plays]=row[1];
          if(number(seconds)&&Number.isInteger(plays)&&number(plays,10000))days.set(row[0],[seconds,plays]);
        }
        for(const row of (Array.isArray(raw.tracks)?raw.tracks:[]).slice(0,MAX_TRACKS))if(Array.isArray(row)&&validId(row[0])&&allowed.has(row[1]))tracks.set(row[0],row[1]);
        for(const row of (Array.isArray(raw.artists)?raw.artists:[]).slice(0,MAX_ARTISTS)){
          if(!Array.isArray(row)||!Array.isArray(row[1]))continue;
          const name=artistName(row[0]);if(!name)continue;
          const values=new Map();
          for(const pair of row[1].slice(0,62))if(Array.isArray(pair)&&allowed.has(pair[0])&&number(pair[1]))values.set(pair[0],pair[1]);
          if(values.size)artists.set(artistKey(name),{name,days:values});
        }
        for(const row of (Array.isArray(raw.songs)?raw.songs:[]).slice(0,MAX_SONGS)){
          if(!Array.isArray(row)||!validId(row[0])||!Array.isArray(row[3]))continue;
          const values=new Map();
          for(const pair of row[3].slice(0,62))if(Array.isArray(pair)&&allowed.has(pair[0])&&number(pair[1]))values.set(pair[0],pair[1]);
          if(values.size)songs.set(row[0],{title:songTitle(row[1]),artist:artistName(row[2]),days:values});
        }
        for(const row of (Array.isArray(raw.months)?raw.months:[]).slice(-MONTHS_KEPT)){
          if(!Array.isArray(row)||typeof row[0]!=="string"||!/^\d{4}-\d{2}$/.test(row[0])||!number(row[1],MONTH_SECONDS)||!Number.isInteger(row[2])||!number(row[2],1e6))continue;
          const entry=month(row[0]);entry.seconds=row[1];entry.plays=row[2];
          for(const pair of (Array.isArray(row[3])?row[3]:[]).slice(0,MONTH_ARTISTS))if(Array.isArray(pair)&&artistName(pair[0])&&number(pair[1],MONTH_SECONDS))entry.artists.set(artistName(pair[0]),pair[1]);
          for(const song of (Array.isArray(row[4])?row[4]:[]).slice(0,MONTH_SONGS))if(Array.isArray(song)&&validId(song[0])&&number(song[3],MONTH_SECONDS))entry.songs.set(song[0],{title:songTitle(song[1]),artist:artistName(song[2]),seconds:song[3]});
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
        if(!songs.has(item.id)){
          if(songs.size>=MAX_SONGS){const weakest=[...songs].sort((a,b)=>total(a[1].days.values())-total(b[1].days.values()))[0];songs.delete(weakest[0]);}
          songs.set(item.id,{title:songTitle(item.title),artist:names[0]||"",days:new Map()});
        }
        const song=songs.get(item.id);song.days.set(date,Math.min(MAX_SECONDS,(song.days.get(date)||0)+delta));
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
  const daily=()=>{prune();return weekKeys(now()).reverse().map(date=>({date,seconds:days.get(date)?.[0]||0}));};
  // The most listened artists and songs of the last seven days, by time.
  const artistRanking=(limit=5)=>{prune();return [...artists.values()].map(artist=>({name:artist.name,seconds:total(artist.days.values())})).sort((a,b)=>b.seconds-a.seconds||a.name.localeCompare(b.name)).slice(0,limit);};
  const songRanking=(limit=5)=>{prune();return [...songs].map(([id,song])=>({id,title:song.title,artist:song.artist,seconds:total(song.days.values())})).sort((a,b)=>b.seconds-a.seconds||a.title.localeCompare(b.title)).slice(0,limit);};
  // Recap of the current month or year: the archive plus this week's days in that period.
  function recap(kind="month"){
    prune();
    const today=dayKey(now()),prefix=kind==="year"?today.slice(0,4):today.slice(0,7),inside=key=>key.startsWith(prefix);
    let seconds=0,plays=0;const artistTotals=new Map(),songTotals=new Map(),byMonth=new Map();
    for(const [key,entry]of months)if(inside(key)){
      seconds+=entry.seconds;plays+=entry.plays;byMonth.set(key,(byMonth.get(key)||0)+entry.seconds);
      for(const [name,value]of entry.artists)artistTotals.set(name,(artistTotals.get(name)||0)+value);
      for(const [id,song]of entry.songs){const old=songTotals.get(id);songTotals.set(id,{id,title:song.title||old?.title||"",artist:song.artist||old?.artist||"",seconds:(old?.seconds||0)+song.seconds});}
    }
    for(const [date,[value,count]]of days)if(inside(date)){seconds+=value;plays+=count;byMonth.set(monthKey(date),(byMonth.get(monthKey(date))||0)+value);}
    for(const artist of artists.values())for(const [date,value]of artist.days)if(inside(date))artistTotals.set(artist.name,(artistTotals.get(artist.name)||0)+value);
    for(const [id,song]of songs)for(const [date,value]of song.days)if(inside(date)){const old=songTotals.get(id);songTotals.set(id,{id,title:song.title||old?.title||"",artist:song.artist||old?.artist||"",seconds:(old?.seconds||0)+value});}
    const year=today.slice(0,4);
    return {kind,seconds,minutes:Math.floor(seconds/60),plays,
      artists:[...artistTotals].map(([name,value])=>({name,seconds:value})).sort((a,b)=>b.seconds-a.seconds||a.name.localeCompare(b.name)).slice(0,5),
      songs:[...songTotals.values()].sort((a,b)=>b.seconds-a.seconds||a.title.localeCompare(b.title)).slice(0,5),
      months:kind==="year"?Array.from({length:12},(_,i)=>{const key=`${year}-${String(i+1).padStart(2,"0")}`;return {key,seconds:byMonth.get(key)||0};}):[]};
  }
  return {record,summary,daily,artists:artistRanking,songs:songRanking,recap};
}
