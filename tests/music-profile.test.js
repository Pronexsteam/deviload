import test from "node:test";
import assert from "node:assert/strict";
import {exportMusicProfile,importMusicProfile,readMusicProfile,saveMusicProfile,PROFILE_KEY,PROFILE_LIMIT} from "../src/music-profile.js";
import {readTaste,recordListening,recommend} from "../src/music-taste.js";
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
  assert.equal(restored.saved.favorites.length,500);assert.equal(restored.saved.recent.length,80);
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
