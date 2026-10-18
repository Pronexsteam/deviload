import {readMusicState} from "./music-state.js";
import {readTaste} from "./music-taste.js";
import {playlistCover} from "./music-library-model.js";
import {musicGain} from "./music-volume.js";

export const PROFILE_LIMIT=2*1024*1024;
export const PROFILE_KEY="deviload-music-profile-v1";
const encoder=new TextEncoder(),idPattern=/^[\w-]{11}$/;
const object=value=>value!==null&&typeof value==="object"&&!Array.isArray(value);
const bytes=text=>encoder.encode(text).length;
const fail=()=>{throw Error("Invalid music profile.");};
// Bound serialized text, including JSON escapes, rather than trusting metadata length.
function text(value,limit){
  let result="",size=0;
  for(const char of String(value||"").replace(/[\u0000-\u001f\u007f]/g,"").trim()){
    size+=bytes(JSON.stringify(char))-2;if(size>limit)break;result+=char;
  }
  return result;
}
function item(value){
  if(!object(value)||value.kind!=="song"||typeof value.id!=="string"||!idPattern.test(value.id)||typeof value.title!=="string"||!value.title.trim())fail();
  const image=typeof value.image==="string"&&/^https:\/\/(i\.ytimg\.com|lh3\.googleusercontent\.com|yt3\.googleusercontent\.com)\//.test(value.image)&&bytes(value.image)<=256?value.image:"";
  return {id:value.id,kind:"song",title:text(value.title,240),subtitle:text(value.subtitle,180),
    artists:[...new Set((Array.isArray(value.artists)?value.artists:[]).filter(name=>typeof name==="string").map(name=>text(name,80)).filter(Boolean))].slice(0,4),image};
}
export const sanitizeMusicTrack=item;
export function sanitizeMusicCollection(value){
  if(!object(value)||!['album','artist','playlist'].includes(value.kind)||typeof value.id!=="string"||! /^(MPRE|UC|VL)[\w-]{1,156}$/.test(value.id))fail();
  const track=item({...value,kind:"song",id:"___________"});
  return {...track,id:value.id,kind:value.kind};
}
function collections(values=[]){
  if(!Array.isArray(values)||values.length>200)fail();
  const seen=new Set();return values.map(sanitizeMusicCollection).filter(value=>!seen.has(value.id)&&seen.add(value.id));
}
function playlists(values=[],strict=false){
  if(!Array.isArray(values)||values.length>30)fail();
  let count=0;const ids=new Set();
  return values.map(value=>{
    if(!object(value)||typeof value.id!=="string"||!/^[-\w]{1,64}$/.test(value.id)||ids.has(value.id)||typeof value.name!=="string"||!value.name.trim())fail();
    ids.add(value.id);const items=list(value.items,500,strict);count+=items.length;if(count>500)fail();
    return {id:value.id,name:text(value.name,160),items,
      ...(value.description?{description:text(value.description,600)}:{}),
      ...(value.pinned===true?{pinned:true}:{}),
      ...(playlistCover(value.cover)?{cover:playlistCover(value.cover)}:{})};
  });
}
function list(values,limit,strict){
  if(!Array.isArray(values)||(strict&&values.length>limit))fail();
  const seen=new Set();return values.slice(0,limit).map(item).filter(track=>!seen.has(track.id)&&seen.add(track.id));
}
function normalize(saved,taste,strict=false){
  if(!object(saved)||!object(taste)||!object(taste.entries))fail();
  // Likes are an explicit collection, never an automatically evicted history.
  // The serialized profile limit bounds storage without dropping older likes.
  const favorites=list(saved.favorites,Number.MAX_SAFE_INTEGER,strict),recent=list(saved.recent,80,strict);
  const entries=Object.create(null),source=Object.values(taste.entries);
  if(strict&&source.length>1000)fail();
  for(const entry of source.sort((a,b)=>(b?.at||0)-(a?.at||0)).slice(0,1000)){
    if(!object(entry)||![entry.score,entry.at,entry.lastPlayed,entry.plays].every(Number.isFinite))fail();
    const track=item(entry.item),now=Date.now();
    entries[track.id]={item:track,score:Math.max(-8,Math.min(8,entry.score)),at:Math.max(0,Math.min(now,entry.at)),
      lastPlayed:Math.max(0,Math.min(now,entry.lastPlayed)),plays:Math.max(0,Math.min(10000,Math.floor(entry.plays)))};
  }
  if(!Array.isArray(taste.hiddenSongs)||!Array.isArray(taste.blockedArtists)||
    (strict&&(taste.hiddenSongs.length>500||taste.blockedArtists.length>300)))fail();
  const hiddenSongs=[...new Set(taste.hiddenSongs.filter(id=>typeof id==="string"&&idPattern.test(id)))].slice(0,500);
  const blockedArtists=[...new Set(taste.blockedArtists.filter(name=>typeof name==="string").map(name=>text(name,160).toLocaleLowerCase()).filter(Boolean))].slice(0,300);
  if(!["balanced","familiar","discovery"].includes(taste.mode))fail();
  return {saved:{favorites,recent,playlists:playlists(saved.playlists,strict),collections:collections(saved.collections),showRegional:saved.showRegional!==false,volume:musicGain(saved.volume),
      ...(Number.isFinite(saved.volumeBeforeMute)&&saved.volumeBeforeMute>0?{volumeBeforeMute:musicGain(saved.volumeBeforeMute)}:{})},
    taste:{version:1,entries,hiddenSongs,blockedArtists,mode:taste.mode}};
}
export function exportMusicProfile(saved,taste){
  const profile=normalize(saved,taste);
  const result=JSON.stringify({format:"devil-music-profile",version:2,...profile});
  if(bytes(result)>PROFILE_LIMIT)throw Error("Music profile is too large (maximum 2 MB).");
  return result;
}
export function importMusicProfile(source){
  if(typeof source!=="string"||bytes(source)>PROFILE_LIMIT)throw Error("Music profile is too large (maximum 2 MB).");
  let raw;try{raw=JSON.parse(source);}catch{fail();}
  if(!object(raw)||raw.format!=="devil-music-profile")fail();
  if(![1,2].includes(raw.version))throw Error("This music profile version is not supported.");
  return normalize(raw.saved,raw.taste,true);
}
export function saveMusicProfile(storage,saved,taste){
  if(!storage)throw Error("Could not save your music preferences.");
  // One write keeps an interrupted import from replacing only half the profile.
  storage.setItem(PROFILE_KEY,exportMusicProfile(saved,taste));
}
export function readMusicProfile(storage){
  try{const raw=storage?.getItem(PROFILE_KEY);if(raw)return importMusicProfile(raw);}catch{/* recover the previous local format */}
  return {saved:readMusicState(storage),taste:readTaste(storage)};
}
