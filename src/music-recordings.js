const MAX_BINDINGS=200,MAX_CANDIDATES=2000;
const validId=value=>typeof value==="string"&&/^[\w-]{11}$/.test(value);
const validTrack=item=>item!==null&&typeof item==="object"&&item.kind==="song"&&validId(item.id)&&typeof item.title==="string"&&item.title.length<=1024&&text(item.title).length>0;
const text=value=>typeof value==="string"?value.normalize("NFKC").replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200d\ufeff]/g,"").replace(/[‐‑‒–—−]/g,"-").replace(/[‘’]/g,"'").replace(/\s+/gu," ").trim().toLowerCase():"";
const tokens=value=>new Set(value.match(/[\p{L}\p{M}\p{N}]+/gu)||[]);
const same=(a,b)=>a.length===b.length&&a.every((value,index)=>value===b[index]);
const artistNames=item=>[...new Set((Array.isArray(item?.artists)?item.artists.slice(0,10):[]).filter(value=>typeof value==="string"&&value.length<=200).map(text).filter(Boolean))].sort();
const rules=[
  ["slowed","slowed(?:\\s+down)?|\u0437\u0430\u043c\u0435\u0434\u043b\u0435\u043d[\\p{L}]*|\u0437\u0430\u043c\u0435\u0434\u043b\u0435\u043d\u043e|ralentizad[oa]"],
  ["sped","sped\\s+up|speed\\s+up|nightcore|\u0443\u0441\u043a\u043e\u0440\u0435\u043d[\\p{L}]*|acelerad[oa]"],
  ["reverb","reverb(?:ed)?|\u0440\u0435\u0432\u0435\u0440\u0431[\\p{L}]*|reverberaci[oó]n"],
  ["remix","remix|remezcla|\u0440\u0435\u043c\u0438\u043a\u0441|\u0440\u0435\u043c\u0456\u043a\u0441"],
  ["live","live|en\\s+vivo|en\\s+directo|\u043a\u043e\u043d\u0446\u0435\u0440\u0442[\\p{L}]*|\u0436\u0438\u0432\u043e\u0435\\s+\u0438\u0441\u043f\u043e\u043b\u043d\u0435\u043d\u0438\u0435|\u043d\u0430\u0436\u0438\u0432\u043e"],
  ["cover","cover|\u043a\u0430\u0432\u0435\u0440|\u043a\u0430\u0432\u0435\u0440[\\p{L}]*"],
  ["acoustic","acoustic|ac[uú]stic[oa]|\u0430\u043a\u0443\u0441\u0442\u0438\u0447[\\p{L}]*"],
  ["instrumental","instrumental|\u0438\u043d\u0441\u0442\u0440\u0443\u043c\u0435\u043d\u0442\u0430\u043b[\\p{L}]*|karaoke|\u043a\u0430\u0440\u0430\u043e\u043a\u0435"],
  ["remaster","remaster(?:ed)?|\u0440\u0435\u043c\u0430\u0441\u0442\u0435\u0440[\\p{L}]*|remasterizad[oa]"],
  ["extended","extended|extendid[oa]"],
  ["edit","radio\\s+edit|club\\s+edit|single\\s+version|dub\\s+mix|original\\s+mix"],
].map(([kind,pattern])=>[kind,new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:${pattern})(?=$|[^\\p{L}\\p{N}])`,"iu")]);
const studio=/^(?:original(?: version)?|studio(?: version)?|versi[oó]n original|versi[oó]n de estudio|\u043e\u0440\u0438\u0433\u0438\u043d\u0430\u043b(?:\u044c\u043d\u0430\u044f \u0432\u0435\u0440\u0441\u0438\u044f)?|\u0441\u0442\u0443\u0434\u0438\u0439\u043d\u0430\u044f \u0432\u0435\u0440\u0441\u0438\u044f)$/iu;
const decoration=/^(?:official(?: music)? (?:audio|video|visuali[sz]er|lyric video)|lyrics?|audio oficial|video oficial|letra)$/iu;
function kinds(value){return rules.filter(([,pattern])=>pattern.test(value)).map(([kind])=>kind);}
function detail(value){return text(value).replace(/\s*\+\s*/g," ").replace(/\bremastered\b/g,"remaster").replace(/\bspeed up\b/g,"sped up").replace(/\s+/g," ").trim();}
function duration(item){
  const values=[item?.duration,item?.durationSeconds].filter(value=>typeof value==="number"&&Number.isFinite(value)&&value>0&&value<=7*86400);
  if(!values.length||values.length>1&&Math.abs(values[0]-values[1])>.01)return null;
  return values[0];
}
function overlap(left,right){
  const a=tokens(left),b=tokens(right);if(!a.size||!b.size)return 0;
  return [...a].filter(value=>b.has(value)).length/new Set([...a,...b]).size;
}

// This describes supplied metadata, not the decoded audio. Version names, mix
// authors, speeds and remaster years remain in the signature; accents are kept.
export function recordingDescriptor(item){
  if(!validTrack(item))return {title:"",artists:[],variant:{kinds:[],details:[]},duration:null};
  const artists=artistNames(item),full=text(item.title),found=new Set(),details=[];
  let title=full;
  const prefix=title.match(/^(.+?)\s+-\s+(.+)$/u);
  if(prefix&&artists.includes(text(prefix[1])))title=prefix[2];
  const version=segment=>{
    const key=text(segment);if(studio.test(key)||decoration.test(key))return true;
    const types=kinds(key);if(!types.length)return false;
    for(const kind of types)found.add(kind);details.push(detail(key));return true;
  };
  title=title.replace(/\(([^()]*)\)|\[([^\[\]]*)\]/gu,(original,round,square)=>version(round??square)?" ":original);
  // Explicit separated suffixes retain the entire named version, rather than
  // keeping only the word "remix" and losing which remix it was.
  for(let count=0;count<8;count++){
    const suffix=title.match(/^(.*?)\s+(?:-|\|)\s+([^|]+)$/u);
    if(!suffix||!version(suffix[2]))break;
    title=suffix[1];
  }
  // Common unbracketed endings. A word at the beginning of a song title (for
  // example "Live and Let Die" or "Cover Me") is never stripped by this rule.
  const ending=title.match(/^(\S.*?)\s+(slowed(?:\s+down)?(?:\s*\+?\s*reverb)?|sped\s+up|speed\s+up|reverb|remix|live(?:\s+(?:at|from|in)\s+.+)?|acoustic|instrumental|cover|remaster(?:ed)?(?:\s+\d{4})?|\u0437\u0430\u043c\u0435\u0434\u043b\u0435\u043d[\p{L}]*|\u0443\u0441\u043a\u043e\u0440\u0435\u043d[\p{L}]*|\u0440\u0435\u043c\u0438\u043a\u0441|en\s+vivo|en\s+directo|ac[uú]stic[oa]|ralentizad[oa]|acelerad[oa])$/iu);
  if(ending&&version(ending[2]))title=ending[1];
  title=text(title).replace(/\s+([,;])/g,"$1");
  return {title,artists,variant:{kinds:found.size?[...found].sort():["studio"],details:[...new Set(details)].sort()},duration:duration(item)};
}

// "high" means strong metadata agreement suitable for a suggestion. It never
// proves audio identity and must not silently create a binding or merge tracks.
export function recordingMatch(original,candidate){
  if(!validTrack(original)||!validTrack(candidate))return {confidence:"none",score:0,reasons:["invalid_track"]};
  const a=recordingDescriptor(original),b=recordingDescriptor(candidate),reasons=[];
  if(!a.title||!b.title)return {confidence:"none",score:0,reasons:["title_unknown"]};
  const exactTitle=a.title===b.title,titleScore=exactTitle?1:overlap(a.title,b.title);
  if(titleScore<.45)return {confidence:"none",score:0,reasons:["title_mismatch"]};
  reasons.push(exactTitle?"title_exact":"title_similar");
  const exactArtists=a.artists.length>0&&same(a.artists,b.artists);
  const artistScore=a.artists.length&&b.artists.length?a.artists.filter(name=>b.artists.includes(name)).length/new Set([...a.artists,...b.artists]).size:0;
  reasons.push(exactArtists?"artist_exact":!a.artists.length||!b.artists.length?"artist_unknown":artistScore?"artist_overlap":"artist_mismatch");
  const exactVersion=same(a.variant.kinds,b.variant.kinds)&&same(a.variant.details,b.variant.details);
  reasons.push(exactVersion?"version_exact":"version_mismatch");
  const knownDuration=a.duration!==null&&b.duration!==null;
  const closeDuration=knownDuration&&Math.abs(a.duration-b.duration)<=Math.min(2,Math.max(.5,Math.min(a.duration,b.duration)*.005));
  reasons.push(!knownDuration?"duration_unknown":closeDuration?"duration_close":"duration_mismatch");
  const high=exactTitle&&exactArtists&&exactVersion&&closeDuration;
  const score=high?1:Math.min(.89,titleScore*.4+artistScore*.4+(exactVersion?.15:0)+(closeDuration?.05:0));
  return {confidence:high?"high":"review",score,reasons};
}

export function recordingAlternatives(original,candidates,{limit=12}={}){
  if(!validTrack(original))return [];
  limit=Number.isFinite(limit)?Math.max(0,Math.min(50,Math.floor(limit))):12;
  if(!limit)return [];
  const seen=new Set([original.id]);
  return (Array.isArray(candidates)?candidates.slice(0,MAX_CANDIDATES):[])
    .filter(item=>validTrack(item)&&!seen.has(item.id)&&seen.add(item.id))
    .map((item,index)=>({item,index,...recordingMatch(original,item)})).filter(row=>row.confidence!=="none")
    .sort((a,b)=>Number(b.confidence==="high")-Number(a.confidence==="high")||b.score-a.score||a.index-b.index)
    .slice(0,limit).map(({index,...row})=>row);
}

function bindingsList(bindings){
  const seen=new Set();
  return (Array.isArray(bindings)?bindings.slice(0,MAX_BINDINGS):[]).filter(binding=>
    binding!==null&&typeof binding==="object"&&validId(binding.trackId)&&validTrack(binding.source)&&binding.trackId!==binding.source.id&&!seen.has(binding.trackId)&&seen.add(binding.trackId));
}
export function resolveRecordingSource(item,bindings=[]){
  if(!validTrack(item))return item;
  return bindingsList(bindings).find(binding=>binding.trackId===item.id)?.source||item;
}
export function removeRecordingSource(bindings,trackId){
  return bindingsList(bindings).filter(binding=>binding.trackId!==trackId).map(binding=>({trackId:binding.trackId,source:binding.source,
    ...(validTrack(binding.track)&&binding.track.id===binding.trackId?{track:binding.track}:{})}));
}
export function setRecordingSource(bindings,trackId,source){
  if(!validId(trackId)||!validTrack(source))throw TypeError("Invalid recording source.");
  const next=removeRecordingSource(bindings,trackId);
  if(source.id===trackId)return next;
  if(next.length>=MAX_BINDINGS)throw RangeError("You can save up to 200 source choices.");
  const old=bindingsList(bindings).find(binding=>binding.trackId===trackId);
  return [{trackId,source,...(validTrack(old?.track)&&old.track.id===trackId?{track:old.track}:{})},...next];
}

// Only explicit user choices establish alias families. Heuristic metadata
// agreement is intentionally excluded, including "high" recordingMatch rows.
function families(bindings){
  const edges=new Map();
  for(const binding of bindingsList(bindings)){
    for(const [a,b]of [[binding.trackId,binding.source.id],[binding.source.id,binding.trackId]]){
      if(!edges.has(a))edges.set(a,new Set());edges.get(a).add(b);
    }
  }
  const byId=new Map();
  for(const id of edges.keys()){
    if(byId.has(id))continue;
    const family=[],pending=[id],seen=new Set([id]);
    for(let index=0;index<pending.length&&family.length<400;index++){
      const value=pending[index];family.push(value);
      for(const next of edges.get(value)||[])if(!seen.has(next)){seen.add(next);pending.push(next);}
    }
    for(const value of family)byId.set(value,family);
  }
  return byId;
}
export function recordingFamilyIds(id,bindings=[]){
  if(!validId(id))return [];
  const family=families(bindings).get(id)||[];
  return [id,...family.filter(value=>value!==id)].slice(0,400);
}
export function dedupeRecordings(items,bindings=[],{limit=2000}={}){
  limit=Number.isFinite(limit)?Math.max(0,Math.min(MAX_CANDIDATES,Math.floor(limit))):MAX_CANDIDATES;
  const byId=families(bindings),seen=new Set(),result=[];
  for(const item of Array.isArray(items)?items.slice(0,MAX_CANDIDATES):[]){
    if(result.length>=limit)break;
    if(!validTrack(item)||seen.has(item.id))continue;
    const family=byId.get(item.id)||[item.id];
    if(family.some(id=>seen.has(id)))continue;
    result.push(item);for(const id of family)seen.add(id);
  }
  return result;
}
