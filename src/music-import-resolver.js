import {selectImportMatch} from "./music-import-model.js";
import {sanitizeMusicTrack} from "./music-profile.js";

const RATE_LIMIT="Music catalog is temporarily rate-limited. Try again later.";
const FAILED="Could not match this imported song.";
const isRateLimit=error=>/\b429\b|too many requests|rate[ -]?limit/i.test(String(error?.message||error));
const text=value=>typeof value==="string"?value.replace(/[\u0000-\u001f\u007f]/g," ").replace(/\s+/g," ").trim():"";
const validId=value=>typeof value==="string"&&/^[\w-]{11}$/.test(value);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function canceled(){const error=Error("Music import canceled.");error.name="AbortError";return error;}
function check(signal){if(signal?.aborted)throw canceled();}
function wait(promise,signal){
  if(!signal)return Promise.resolve(promise);check(signal);
  return new Promise((resolve,reject)=>{
    const abort=()=>{signal.removeEventListener("abort",abort);reject(canceled());};
    signal.addEventListener("abort",abort,{once:true});
    Promise.resolve(promise).then(value=>{signal.removeEventListener("abort",abort);if(signal.aborted)reject(canceled());else resolve(value);},error=>{signal.removeEventListener("abort",abort);reject(signal.aborted?canceled():error);});
  });
}
function candidates(result){
  const all=[];
  for(const section of Array.isArray(result?.sections)?result.sections:[])for(const item of Array.isArray(section?.items)?section.items:[]){
    try{all.push(sanitizeMusicTrack(item));}catch{/* Albums, invalid rows and unavailable videos cannot be song matches. */}
  }
  return all;
}
function caller(invoke,signal,delay){
  let requested=false;
  return async args=>{check(signal);if(requested)await wait(delay(250),signal);check(signal);requested=true;const result=await wait(invoke("music_catalog",args),signal);check(signal);return result;};
}

const matchCaches=new WeakMap();
export async function resolveMusicImport(entries,{invoke,language="en",signal,onProgress=()=>{},onRow=()=>{},delay=sleep,concurrency=3}={}){
  if(!Array.isArray(entries))throw Error("Invalid music import.");
  if(entries.length>500)throw Error("Match up to 500 songs at a time.");
  if(typeof invoke!=="function")throw Error("Music catalog is unavailable.");
  check(signal);const rows=new Array(entries.length);let cursor=0,done=0,errors=0,limited=false,fatal=null,gate=Promise.resolve(),requested=false;
  let cache=matchCaches.get(invoke);if(!cache){cache=new Map();matchCaches.set(invoke,cache);}
  async function request(args){
    const turn=gate.then(async()=>{check(signal);if(requested)await wait(delay(150),signal);check(signal);requested=true;});gate=turn.catch(()=>{});await turn;
    if(limited)throw Error(RATE_LIMIT);if(fatal)throw fatal;
    return wait(invoke("music_catalog",args),signal);
  }
  async function worker(){
    while(cursor<entries.length&&!fatal){
      check(signal);const index=cursor++,entry=entries[index];let row={entry,item:null,confidence:"none"};
      if(limited)row.error=RATE_LIMIT;
      else if(!entry||typeof entry!=="object")row.error="Invalid music import.";
      else if(validId(entry.videoId)&&text(entry.title)){
        row={entry,item:sanitizeMusicTrack({kind:"song",id:entry.videoId,title:entry.title,artists:entry.artists,subtitle:(Array.isArray(entry.artists)?entry.artists:[]).filter(value=>typeof value==="string").join(", "),image:""}),confidence:"exact"};
      }else{
        const title=text(entry.title),artists=(Array.isArray(entry.artists)?entry.artists:[]).map(text).filter(Boolean);
        const key=JSON.stringify([language,entry.videoId||"",title,artists]),cached=cache.get(key);
        if(!validId(entry.videoId)&&(!title||!artists.length))row.error="Invalid music import.";
        else if(cached&&Date.now()-cached.at<30*60*1000){row={entry,...cached.match};}
        else try{
          const args=validId(entry.videoId)?{kind:"radio",value:entry.videoId,language}:{kind:"search",value:(title+" "+artists.join(" ")).slice(0,120),filter:"songs",language};
          const result=await request(args);check(signal);errors=0;
          const match=selectImportMatch(entry,candidates(result));row={entry,...match};
          if(match.item){if(cache.size>=300)cache.delete(cache.keys().next().value);cache.set(key,{at:Date.now(),match});}
        }catch(error){
          if(signal?.aborted||error?.name==="AbortError")throw canceled();
          if(isRateLimit(error)){limited=true;row.error=RATE_LIMIT;}
          else{row.error=FAILED;if(++errors>=3)fatal=Error("Music matching stopped after repeated connection errors. Try again later.");}
        }
      }
      check(signal);rows[index]=row;onRow(row,index);onProgress(++done,entries.length);check(signal);
    }
  }
  const count=Math.max(1,Math.min(3,Math.floor(Number(concurrency)||3),entries.length||1));
  await Promise.all(Array.from({length:count},worker));check(signal);if(fatal)throw fatal;return rows;
}

function playlistId(input){
  try{
    const url=new URL(typeof input==="string"?input.trim():"");
    if(url.protocol!=="https:"||url.username||url.password||url.port||url.hash||!["music.youtube.com","youtube.com","www.youtube.com"].includes(url.hostname)||url.pathname!=="/playlist"||url.searchParams.getAll("list").length!==1)throw Error();
    const id=url.searchParams.get("list");
    if(!/^(?:PL[\w-]{10,150}|OLAK[\w-]{10,146})$/.test(id))throw Error();return id;
  }catch{throw Error("Enter a public YouTube Music playlist link.");}
}
export async function readPlaylistLink(input,{invoke,language="en",signal,onProgress=()=>{},delay=sleep}={}){
  let url;try{url=new URL(typeof input==='string'?input.trim():'');}catch{}
  if(url?.hostname==='open.spotify.com'){
    if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash||!/^\/(?:intl-[a-zA-Z-]{2,7}\/)?playlist\/[a-zA-Z0-9]{22}\/?$/.test(url.pathname))throw Error("Enter a public Spotify playlist link.");
    if(typeof invoke!=="function")throw Error("Music catalog is unavailable.");check(signal);
    const result=await wait(invoke("music_import_spotify_playlist",{link:url.href}),signal);check(signal);
    if(!Array.isArray(result?.entries)||!result.entries.length||result.entries.length>500)throw Error("Could not read this public Spotify playlist. Try a music export instead.");
    onProgress(result.entries.length,result.entries.length);return result;
  }
  const id=playlistId(input);if(typeof invoke!=="function")throw Error("Music catalog is unavailable.");check(signal);
  const result={source:"youtube",name:"Imported YouTube Music playlist",entries:[],playlists:[],warnings:[]},request=caller(invoke,signal,delay),seen=new Set(),tokens=new Set();
  let continuation;
  for(let page=0;page<10;page++){
    check(signal);let response;
    try{response=await request({kind:"browse",value:"VL"+id,language,...(continuation?{continuation}:{})});}
    catch(error){
      if(signal?.aborted||error?.name==="AbortError")throw canceled();
      const message=isRateLimit(error)?RATE_LIMIT:"Only part of the playlist could be read.";
      if(!result.entries.length)throw Error(isRateLimit(error)?RATE_LIMIT:"Could not read this YouTube Music playlist.");
      result.warnings.push(message);break;
    }
    const items=candidates(response);let overflow=false;
    for(const item of items){
      if(seen.has(item.id))continue;if(result.entries.length>=500){overflow=true;break;}
      seen.add(item.id);result.entries.push({key:"youtube:"+item.id,title:item.title,artists:item.artists,videoId:item.id,liked:false,plays:0});
    }
    onProgress(result.entries.length,500);check(signal);
    const invalidContinuation=response?.continuation&&(typeof response.continuation!=="string"||response.continuation.length>20000);
    if(invalidContinuation){result.warnings.push("Only part of the playlist could be read.");break;}
    const next=typeof response?.continuation==="string"?response.continuation:"";
    if(overflow||result.entries.length>=500&&next){result.warnings.push("Only the first 500 playlist songs were imported.");break;}
    if(!next)break;
    if(tokens.has(next)){result.warnings.push("Playlist pagination repeated. Only part of the playlist was imported.");break;}
    tokens.add(next);continuation=next;
    if(page===9)result.warnings.push("Only the first 10 playlist pages were imported.");
  }
  check(signal);
  if(!result.entries.length)result.warnings.push("No songs were found in this playlist.");
  result.playlists.push({name:result.name,keys:result.entries.map(entry=>entry.key)});return result;
}
