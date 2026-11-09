import test from "node:test";
import assert from "node:assert/strict";
import {createWeeklyStats,WEEKLY_STORAGE_KEY} from "../src/music-weekly.js";

const storage=initial=>{let value=initial;return {getItem:()=>value,setItem:(key,next)=>{assert.equal(key,WEEKLY_STORAGE_KEY);value=next;}};};
const song=(n=1,artist="Artist")=>({id:String(n).padStart(11,"0"),artists:[artist]});
const date=(day,hour=12,minute=0,second=0)=>new Date(2026,9,day,hour,minute,second).getTime();

test("weekly listening counts real deltas, repeat sessions and unique songs separately",()=>{
  const saved=storage(),stats=createWeeklyStats(saved,{now:()=>date(14)});
  stats.record({item:song(),seconds:30.25,qualified:true});
  stats.record({item:song(),seconds:29.75});
  stats.record({item:song(),seconds:45,qualified:true});
  stats.record({item:song(2,"Other"),seconds:15});
  assert.deepEqual(stats.summary(),{totalSeconds:120,totalMinutes:2,totalQualifiedPlays:2,uniqueTracks:2,uniqueTracksCapped:false,topArtist:"Artist",topArtistSeconds:105});
  assert.deepEqual(createWeeklyStats(saved,{now:()=>date(14)}).summary(),stats.summary());
});

test('daily chart retains empty dates and splits genuine listening across midnight',()=>{
 const stats=createWeeklyStats(storage(),{now:()=>date(14,0,0,10)});
 stats.record({item:song(),seconds:20});
 const days=stats.daily();assert.equal(days.length,7);
 assert.deepEqual(days.slice(-2),[{date:'2026-10-13',seconds:10},{date:'2026-10-14',seconds:10}]);
 assert(days.slice(0,5).every(day=>day.seconds===0));
 assert.equal(days.reduce((sum,day)=>sum+day.seconds,0),stats.summary().totalSeconds);
});

test("midnight splits seconds by local calendar day and prunes the seventh previous day",()=>{
  let now=date(8,0,0,10);const saved=storage(),stats=createWeeklyStats(saved,{now:()=>now});
  stats.record({item:song(),seconds:20,qualified:true});
  assert.equal(stats.summary().totalSeconds,20);
  now=date(14);assert.equal(stats.summary().totalSeconds,10);
  assert.equal(stats.summary().totalQualifiedPlays,1);
  now=date(15);assert.equal(stats.summary().totalSeconds,0);assert.equal(stats.summary().uniqueTracks,0);
  assert.equal(stats.summary().topArtist,null);
});

test("untrusted future, malformed, excessive and negative statistics are ignored",()=>{
  const current="2026-10-14",future="2099-01-01";
  const saved=storage(JSON.stringify({version:1,days:[[future,[100,3]],[current,[-1,1]]],tracks:[[song().id,future],["__proto__",current]],artists:[["Bad",[[current,-1],[future,10]]]]}));
  const stats=createWeeklyStats(saved,{now:()=>date(14)});
  assert.equal(stats.summary().totalSeconds,0);assert.equal(stats.summary().uniqueTracks,0);assert.equal(stats.summary().topArtist,null);
  for(const seconds of [-1,NaN,Infinity,90001,"20"])assert.equal(stats.record({item:song(),seconds}),false);
  assert.equal(stats.record({item:{id:"bad"},seconds:10}),false);
  const oversized=createWeeklyStats(storage(" ".repeat(102401)),{now:()=>date(14)});assert.equal(oversized.summary().totalSeconds,0);
});

test("storage stays bounded with many songs and Unicode artists without losing listened time",()=>{
  const saved=storage(),stats=createWeeklyStats(saved,{now:()=>date(14)});
  for(let n=0;n<1200;n++)stats.record({item:song(n,`${n} ${"🎸漢".repeat(30)}`),seconds:1,qualified:true});
  const raw=JSON.parse(saved.getItem());
  assert.ok(raw.artists.length<=200);assert.ok(raw.tracks.length<=1000);assert.ok(raw.days.length<=7);
  assert.ok(new TextEncoder().encode(saved.getItem()).length<=102400);
  assert.equal(stats.summary().totalSeconds,1200);assert.equal(stats.summary().totalQualifiedPlays,1200);assert.equal(stats.summary().uniqueTracksCapped,true);
});

test("full or denied storage does not interrupt listening statistics",()=>{
  const stats=createWeeklyStats({getItem(){throw Error("denied");},setItem(){throw Error("full");}},{now:()=>date(14)});
  assert.equal(stats.record({item:song(),seconds:30,qualified:true}),true);
  assert.equal(stats.summary().totalSeconds,30);
});

test("repeated spellings of the same artist are counted once per delta",()=>{
  const stats=createWeeklyStats(storage(),{now:()=>date(14)});
  stats.record({item:{...song(),artists:["Artist","artist"," Artist "]},seconds:10});
  assert.equal(stats.summary().topArtistSeconds,10);
});

test("the most listened songs and artists of the week are ranked by time and survive a restart", () => {
  const saved=storage(),stats=createWeeklyStats(saved,{now:()=>date(14)});
  stats.record({item:{id:"aaaaaaaaaaa",title:"First  song",artists:["Band A","Guest"]},seconds:300,qualified:true});
  stats.record({item:{id:"bbbbbbbbbbb",title:"Second",artists:["Band B"]},seconds:120,qualified:true});
  stats.record({item:{id:"aaaaaaaaaaa",title:"First  song",artists:["Band A"]},seconds:60});
  assert.deepEqual(stats.songs(5).map(song=>[song.id,song.title,song.artist,Math.round(song.seconds)]),[["aaaaaaaaaaa","First song","Band A",360],["bbbbbbbbbbb","Second","Band B",120]]);
  assert.deepEqual(stats.artists(2).map(artist=>artist.name),["Band A","Guest"]);
  const again=createWeeklyStats(saved,{now:()=>date(14)});
  assert.deepEqual(again.songs(1).map(song=>song.id),["aaaaaaaaaaa"]);
  assert.equal(createWeeklyStats(saved,{now:()=>date(30)}).songs().length,0,"songs older than a week are forgotten");
});
