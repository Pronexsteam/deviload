import test from "node:test";
import assert from "node:assert/strict";
import {exportMusicProfile,importMusicProfile,readMusicProfile,saveMusicProfile,PROFILE_KEY,PROFILE_LIMIT} from "../src/music-profile.js";
import {readTaste,recordListening,recommend} from "../src/music-taste.js";
import {transferPlaylistTracks} from "../src/music-library-model.js";
const song=n=>({kind:"song",id:String(n).padStart(11,"0"),title:`Track ${n}`,subtitle:"Artist",artists:["Artist"],image:"https://i.ytimg.com/vi/00000000001/hqdefault.jpg"});
const saved=()=>({favorites:[song(1)],recent:[song(2)],volume:.4});
const taste=()=>readTaste();
test("profile round trip preserves preferences and ranking, strips session state and unrelated data",()=>{
  const state=saved(),profile=taste(),now=Date.now()-1000;
  recordListening(profile,song(2),{seconds:90,duration:100,session:42},now);
  profile.hiddenSongs=[song(3).id];profile.blockedArtists=["blocked"];profile.mode="discovery";
  state.cookies="private";state.favorites[0].token="secret";profile.password="private";
  const file=exportMusicProfile(state,profile),restored=importMusicProfile(file);
  assert.equal(restored.taste.entries[song(2).id].score,2.5);
  assert.equal(restored.taste.entries[song(2).id].session,undefined);
  assert.deepEqual(restored.saved.favorites,saved().favorites);
  assert.deepEqual(restored.taste.hiddenSongs,profile.hiddenSongs);
  assert.deepEqual(restored.taste.blockedArtists,profile.blockedArtists);
  const options={now,random:()=>0};
  assert.deepEqual(recommend([song(1),song(2),song(3)],restored.taste,restored.saved.favorites,options),recommend([song(1),song(2),song(3)],profile,state.favorites,options));
  assert.ok(!/private|secret|password|cookies|sessionReward/.test(file));
});
test("profile stays bounded after years of listening and excessively long metadata",()=>{
  const state=saved(),profile=taste(),now=Date.now()-500000;
  for(let n=0;n<1300;n++)recordListening(profile,song(n),{seconds:100,duration:100,session:n},now+n);
  state.favorites=Array.from({length:600},(_,n)=>song(n+2000));state.recent=Array.from({length:90},(_,n)=>song(n+3000));
  const loud='"漢😀'.repeat(1000);
  for(const track of [...state.favorites,...state.recent,...Object.values(profile.entries).map(e=>e.item)]){track.title=loud;track.subtitle=loud;track.artists=Array(10).fill(loud);}
  const file=exportMusicProfile(state,profile),restored=importMusicProfile(file);
  assert.equal(Object.keys(restored.taste.entries).length,1000);
  assert.equal(restored.saved.favorites.length,600);assert.equal(restored.saved.recent.length,80);
  assert.ok(Buffer.byteLength(file)<PROFILE_LIMIT);
  assert.ok(!restored.taste.entries[song(1).id]);
});
test("invalid, unrelated, unsupported and oversized imports do not become profiles",()=>{
  const good=JSON.parse(exportMusicProfile(saved(),taste()));
  for(const value of [null,{},[],{...good,format:"deviload-settings"},{...good,version:99},{...good,saved:{favorites:[{}],recent:[]}},
    {...good,taste:{...good.taste,entries:{broken:{item:song(1),score:"9"}}}},
    {...good,saved:{...good.saved,recent:Array(81).fill(song(1))}}])assert.throws(()=>importMusicProfile(JSON.stringify(value)));
  assert.throws(()=>importMusicProfile("{bad"));assert.throws(()=>importMusicProfile("x".repeat(PROFILE_LIMIT+1)));
});
test("single-write import remains intact when storage is full and persists across reload",()=>{
  const memory=new Map(),storage={getItem:key=>memory.get(key),setItem:(key,value)=>memory.set(key,value)};
  saveMusicProfile(storage,saved(),taste());const before=memory.get(PROFILE_KEY);
  assert.equal(readMusicProfile(storage).saved.favorites[0].id,song(1).id);
  const failing={getItem:storage.getItem,setItem:()=>{throw Error("Quota exceeded");}};
  assert.throws(()=>saveMusicProfile(failing,{...saved(),favorites:[]},taste()));
  assert.equal(memory.get(PROFILE_KEY),before);
});
test("existing local preferences migrate without losing likes or learned scores",()=>{
  const profile=taste();recordListening(profile,song(2),{seconds:40,duration:100,session:7});
  const memory=new Map([["deviload-music-v1",JSON.stringify(saved())],["deviload-music-taste-v1",JSON.stringify(profile)]]);
  const storage={getItem:key=>memory.get(key),setItem:(key,value)=>memory.set(key,value)};
  const old=readMusicProfile(storage);saveMusicProfile(storage,old.saved,old.taste);
  assert.equal(readMusicProfile(storage).taste.entries[song(2).id].score,1);
  assert.equal(readMusicProfile(storage).saved.favorites.length,1);
});

test("playlists retain names and song order in bounded backups and old profiles still import",()=>{
  const state={...saved(),showRegional:false,playlists:[{id:"night",name:"Night drive",items:[song(4),song(3)]}]};
  const profile=JSON.parse(exportMusicProfile(state,taste()));assert.equal(profile.version,2);
  assert.deepEqual(importMusicProfile(JSON.stringify(profile)).saved.playlists,state.playlists);
  assert.equal(importMusicProfile(JSON.stringify(profile)).saved.showRegional,false);
  profile.version=1;delete profile.saved.playlists;assert.deepEqual(importMusicProfile(JSON.stringify(profile)).saved.playlists,[]);
});
test("playlist imports reject duplicate identities and excess entries without truncating a collection",()=>{
  const profile=JSON.parse(exportMusicProfile(saved(),taste()));
  const list={id:"a",name:"A",items:[song(1)]};
  for(const playlists of [[list,list],[{...list,name:" "}],Array.from({length:31},(_,n)=>({...list,id:String(n)})),[{...list,items:Array.from({length:501},(_,n)=>song(n))}]]){
    assert.throws(()=>importMusicProfile(JSON.stringify({...profile,saved:{...profile.saved,playlists}})));
  }
});
test("saved artists and albums migrate with the profile without paths or expiring audio URLs",()=>{
  const state=saved();state.collections=[{id:"UCabcdefghijk",kind:"artist",title:"Artist",image:"https://i.ytimg.com/a.jpg",path:"C:/secret",url:"https://signed-audio/secret"},{id:"MPREabcdefghijk",kind:"album",title:"Album"}];
  const file=exportMusicProfile(state,taste()),restored=importMusicProfile(file);assert.equal(restored.saved.collections.length,2);assert.equal(restored.saved.collections[0].kind,"artist");assert.ok(!file.includes("secret"));
  const raw=JSON.parse(file);raw.saved.collections[0].id="../../secret";assert.throws(()=>importMusicProfile(JSON.stringify(raw)));
});

test("thousands of likes survive save and import, and a full profile fails without evicting favorites",()=>{
 const state=saved();state.favorites=Array.from({length:5000},(_,n)=>song(n));
 const file=exportMusicProfile(state,taste()),restored=importMusicProfile(file);
 assert.equal(restored.saved.favorites.length,5000);assert.equal(restored.saved.favorites.at(-1).id,song(4999).id);
 const memory=new Map(),storage={getItem:key=>memory.get(key),setItem:(key,value)=>memory.set(key,value)};
 saveMusicProfile(storage,state,taste());const before=memory.get(PROFILE_KEY);
 const tooLarge={...state,favorites:Array.from({length:30000},(_,n)=>song(n))};
 assert.throws(()=>saveMusicProfile(storage,tooLarge,taste()),/too large/);assert.equal(memory.get(PROFILE_KEY),before);
});

test("playlist description, pin and raster cover survive export, import and local restart",()=>{
  const cover="data:image/png;base64,iVBORw0KGgo=",state={...saved(),playlists:[{id:"night",name:"Night",description:"Late night favourites",pinned:true,cover,items:[song(1),song(2)]}]};
  const restored=importMusicProfile(exportMusicProfile(state,taste()));
  assert.deepEqual(restored.saved.playlists,state.playlists);
  const memory=new Map(),storage={getItem:key=>memory.get(key),setItem:(key,value)=>memory.set(key,value)};
  saveMusicProfile(storage,state,taste());
  assert.deepEqual(readMusicProfile(storage).saved.playlists,state.playlists);
});

test("playlist metadata is bounded and unsafe cover sources do not enter the profile",()=>{
  const state={...saved(),playlists:[{id:"night",name:"Night",description:"\u0000  "+"漢".repeat(500),pinned:"true",cover:"data:image/svg+xml;base64,PHN2Zz4=",items:[song(1)]}]};
  const restored=importMusicProfile(exportMusicProfile(state,taste())).saved.playlists[0];
  assert.ok(Buffer.byteLength(restored.description)<=600);
  assert.ok(!restored.description.includes("\u0000"));
  assert.equal(restored.pinned,undefined);assert.equal(restored.cover,undefined);
  const raw=JSON.parse(exportMusicProfile(state,taste()));raw.saved.playlists[0].id="../bad";
  assert.throws(()=>importMusicProfile(JSON.stringify(raw)),/Invalid music profile/);
});

test("playlist transfer persists as one complete update and quota failure retains both lists",()=>{
  const state={...saved(),playlists:[{id:"source",name:"Source",items:[song(1),song(2)]},{id:"target",name:"Target",items:[song(2),song(3)]}]};
  const memory=new Map(),storage={getItem:key=>memory.get(key),setItem:(key,value)=>memory.set(key,value)};
  saveMusicProfile(storage,state,taste());const before=memory.get(PROFILE_KEY);
  const changed={...state,playlists:transferPlaylistTracks(state.playlists,"source","target",[song(1).id,song(2).id],true)};
  assert.throws(()=>saveMusicProfile({...storage,setItem:()=>{throw Error("Quota exceeded");}},changed,taste()),/Quota exceeded/);
  assert.equal(memory.get(PROFILE_KEY),before);
  assert.deepEqual(readMusicProfile(storage).saved.playlists,state.playlists);
  saveMusicProfile(storage,changed,taste());
  assert.deepEqual(readMusicProfile(storage).saved.playlists,changed.playlists);
  assert.equal(changed.playlists[0].items.length,0);assert.equal(changed.playlists[1].items.length,3);
});
