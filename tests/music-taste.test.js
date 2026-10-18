import test from "node:test";
import assert from "node:assert/strict";
import {readTaste,recordListening,tasteSeeds,recommend,recommendWithReasons,recommendationReason,canonicalArtistKey,tasteArtistKeys,listeningClock,hideRecommendation} from "../src/music-taste.js";
const song=(n,artist="Artist")=>({id:String(n).padStart(11,"0"),kind:"song",title:`Song ${n}`,artists:[artist]});
const now=1800000000000,random=()=>.5;

test("listening and early skips change recommendations; pause clicks do not inflate taste",()=>{
  const profile=readTaste(),a=song(1,"A"),b=song(2,"B");
  recordListening(profile,a,{seconds:190,duration:200,ended:true},now);
  recordListening(profile,b,{seconds:5,duration:200,skipped:true},now);
  assert.equal(tasteSeeds(profile,[],{now,random})[0].id,a.id);
  assert.equal(recommend([b,song(3,"B"),song(4,"A")],profile,[],{now,random})[0].id,song(4).id);
  assert.ok(!recommend([b],profile,[],{now,random}).length);
  const before=profile.entries[a.id].score;
  recordListening(profile,a,{seconds:190,duration:200},now+1000);
  assert.ok(profile.entries[a.id].score<=before);
});

test("a new taste outweighs old listening; explicit likes remain seeds",()=>{
  const profile=readTaste(),old=song(1,"Old"),fresh=song(2,"New");
  recordListening(profile,old,{seconds:190,duration:200},now-180*86400000);
  recordListening(profile,fresh,{seconds:190,duration:200},now);
  assert.equal(tasteSeeds(profile,[],{now,random})[0].id,fresh.id);
  assert.equal(tasteSeeds(profile,[old],{now,random})[0].id,old.id);
});

test("recommendations diversify artists, reserve discovery and exclude the current queue",()=>{
  const profile=readTaste(),liked=song(1,"A"),items=Array.from({length:12},(_,n)=>song(n+1,n<6?"A":`B${n}`));
  recordListening(profile,liked,{seconds:190,duration:200},now);
  const result=recommend(items,profile,[liked],{now,random,limit:8,exclude:[song(12).id]});
  assert.ok(result.filter(item=>item.artists[0]==="A").length<=2);
  assert.ok(result.some(item=>item.artists[0]!=="A"));
  assert.ok(!result.some(item=>item.id===song(12).id));
  assert.equal(new Set(result.map(item=>item.id)).size,result.length);
});

test("listening clock counts audible time, not seeks or paused time",()=>{
  const clock=listeningClock();clock.sample(0,0,true);clock.sample(1,1000,true);clock.sample(90,2000,true);
  clock.sample(90,3000,false);clock.sample(90,30000,true);clock.sample(91,31000,true);
  assert.equal(clock.seconds,2);clock.reset();assert.equal(clock.seconds,0);
});

test("empty and damaged storage are safe and profiles remain bounded",()=>{
  assert.equal(Object.keys(readTaste({getItem:()=>"broken"}).entries).length,0);
  const profile=readTaste();
  for(let i=0;i<1100;i++)recordListening(profile,song(i),{seconds:40,duration:200},now+i);
  assert.equal(Object.keys(profile.entries).length,1000);
  assert.ok(!recordListening(profile,song(9999),{seconds:0,duration:200,skipped:true},now));
});

test("explicit exclusions survive restart and override likes without blocking manual catalog access",()=>{
  const profile=readTaste(),a=song(1,"A"),b=song(2,"B");
  hideRecommendation(profile,a);hideRecommendation(profile,b,true);profile.mode="discovery";
  const restored=readTaste({getItem:()=>JSON.stringify(profile)});
  assert.equal(restored.mode,"discovery");
  assert.deepEqual(recommend([a,b,song(3,"B"),song(4,"C")],restored,[a,b],{now,random}).map(item=>item.id),[song(4).id]);
  assert.deepEqual(tasteSeeds(restored,[a,b],{now,random}),[]);
});

test("discovery mode ranks an unheard artist ahead of a familiar track",()=>{
  const profile=readTaste(),a=song(1,"A"),b=song(2,"B");
  recordListening(profile,a,{seconds:190,duration:200},now-3*86400000);
  profile.mode="familiar";assert.equal(recommend([a,b],profile,[],{now,random})[0].id,a.id);
  profile.mode="discovery";assert.equal(recommend([a,b],profile,[],{now,random})[0].id,b.id);
});
test("followed artists influence discovery without overriding explicit dislikes",()=>{
  const profile=readTaste(),a=song(1,"A"),b=song(2,"B");
  assert.equal(recommend([a,b],profile,[],{now,random,followedArtists:["B"]})[0].id,b.id);
  hideRecommendation(profile,b,true);assert.deepEqual(recommend([a,b],profile,[],{now,random,followedArtists:["B"]}).map(item=>item.id),[a.id]);
});

test("a suppressed repeat stays suppressed through completion and later checkpoints",()=>{
  const profile=readTaste(),item=song(1);
  recordListening(profile,item,{seconds:190,duration:200,session:1},now);
  const first=profile.entries[item.id].score;
  recordListening(profile,item,{seconds:30,duration:200,session:2},now+60000);
  recordListening(profile,item,{seconds:190,duration:200,session:2},now+220000);
  recordListening(profile,item,{seconds:200,duration:200,session:2},now+1000000);
  assert.ok(profile.entries[item.id].score<=first);
  assert.equal(profile.entries[item.id].plays,1);
  recordListening(profile,item,{seconds:190,duration:200,session:3},now+2000000);
  assert.ok(profile.entries[item.id].score>first);
  assert.equal(profile.entries[item.id].plays,2);
});

test("short exposures preserve skip feedback but do not count as qualified plays",()=>{
  const profile=readTaste(),skipped=song(1),resumed=song(2),short=song(3);
  recordListening(profile,skipped,{seconds:3,duration:200,skipped:true,session:1},now);
  assert.equal(profile.entries[skipped.id].plays,0);
  assert.equal(profile.entries[skipped.id].score,-2.5);
  assert.equal(profile.entries[skipped.id].lastPlayed,now);
  recordListening(profile,resumed,{seconds:5,duration:200,session:2},now);
  assert.equal(profile.entries[resumed.id].plays,0);
  recordListening(profile,resumed,{seconds:30,duration:200,session:2},now+30000);
  assert.equal(profile.entries[resumed.id].plays,1);
  recordListening(profile,resumed,{seconds:190,duration:200,session:2},now+190000);
  recordListening(profile,resumed,{seconds:200,duration:200,session:2},now+1000000);
  assert.equal(profile.entries[resumed.id].plays,1);
  recordListening(profile,short,{seconds:16,duration:20,session:3},now);
  assert.equal(profile.entries[short.id].plays,1);
  assert.equal(profile.entries[short.id].score,2.5);
});

test("restart strips transient listening state and preserves repeat suppression",()=>{
  const profile=readTaste(),item=song(1);
  recordListening(profile,item,{seconds:190,duration:200,session:1},now);
  const restored=readTaste({getItem:()=>JSON.stringify(profile)});
  assert.deepEqual(Object.keys(restored.entries[item.id]).sort(),["at","item","lastPlayed","plays","score"]);
  recordListening(restored,item,{seconds:30,duration:200,session:1},now+60000);
  recordListening(restored,item,{seconds:190,duration:200,session:1},now+220000);
  assert.ok(restored.entries[item.id].score<=2.5);
  assert.equal(restored.entries[item.id].plays,1);
});

test("many likes or completed songs by one artist do not outvote the same evidence for another artist",()=>{
  const a=song(100,"A"),b=song(101,"B"),candidates=[song(201,"B"),song(200,"A")];
  const baseline=recommend(candidates,readTaste(),[a,b],{now,random});
  const many=[a,b,...Array.from({length:80},(_,i)=>song(300+i,"A"))];
  assert.deepEqual(recommend(candidates,readTaste(),many,{now,random}),baseline);
  const profile=readTaste();
  for(const item of many)recordListening(profile,item,{seconds:190,duration:200},now-3*86400000);
  assert.equal(recommend(candidates,profile,[],{now,random})[0].artists[0],"B");
  assert.equal(tasteSeeds(profile,many,{now,random,limit:2}).length,2);
});

test("artist identity normalizes Unicode, whitespace and aliases without losing collaboration exclusions",()=>{
  assert.equal(canonicalArtistKey("  ＭＡＳＳＩＶＥ\u00a0ＡＴＴＡＣＫ "),"massive attack");
  assert.equal(canonicalArtistKey("Bjo\u0308rk"),canonicalArtistKey("BJÖRK"));
  assert.equal(canonicalArtistKey(" A\u200b "),"a");
  assert.deepEqual(tasteArtistKeys({...song(1),artists:[" A ","Ａ",null,42,"B"]}),["a","b"]);
  const profile=readTaste({getItem:()=>JSON.stringify({blockedArtists:[" ＭＡＳＳＩＶＥ\u00a0ＡＴＴＡＣＫ "]})});
  const blocked={...song(1),artists:["Massive Attack","Guest"]},guest=song(2,"Guest");
  const result=recommend([blocked,song(3," MASSIVE   ATTACK "),guest],profile,[blocked],{now,random,followedArtists:["massive attack"]});
  assert.deepEqual(result,[guest]);
  assert.equal(canonicalArtistKey({toString(){throw Error("must not coerce");}}),"");
});

test("passive short exposure is not artist preference or familiarity, while qualified listening and explicit skips are",()=>{
  const profile=readTaste(),a=song(1,"A"),related=song(2,"A"),unknown=song(3,"B");
  profile.mode="familiar";
  recordListening(profile,a,{seconds:5,duration:200},now-3600000);
  assert.equal(recommend([unknown,related],profile,[],{now,random})[0].id,unknown.id);
  assert.equal(recommendationReason(related,profile,[],{now}).code,"discovery");
  recordListening(profile,a,{seconds:40,duration:200},now);
  assert.equal(recommend([unknown,related],profile,[],{now,random})[0].id,related.id);
  assert.equal(recommendationReason(related,profile,[],{now}).code,"related_artist");
  const rejected=song(4,"C");recordListening(profile,rejected,{seconds:3,duration:200,skipped:true},now);
  assert.ok(!recommend([rejected,unknown],profile,[],{now,random}).some(item=>item.id===rejected.id));
});

test("old history fades instead of winning through its size, while explicit likes retain their meaning",()=>{
  const profile=readTaste(),fresh=song(900,"New");profile.mode="familiar";
  for(let i=0;i<100;i++)recordListening(profile,song(i,"Old"),{seconds:190,duration:200},now-365*86400000);
  recordListening(profile,fresh,{seconds:190,duration:200},now-3*86400000);
  const oldNew=song(901,"Old"),newNew=song(902,"New");
  assert.equal(recommend([oldNew,newNew],profile,[],{now,random})[0].id,newNew.id);
  assert.equal(recommendationReason(oldNew,profile,[],{now}).code,"discovery");
  assert.equal(recommendationReason(oldNew,profile,[song(1,"Old")],{now}).code,"related_artist");
});

test("discovery reserves unfamiliar artists rather than merely unheard tracks from a familiar artist",()=>{
  const profile=readTaste(),liked=song(1,"A"),unknown=song(90,"New artist"),candidates=[song(2,"A"),song(3,"A"),unknown];
  profile.mode="discovery";assert.equal(recommend(candidates,profile,[liked],{now,random})[0].id,unknown.id);
  profile.mode="familiar";assert.equal(recommend(candidates,profile,[liked],{now,random})[0].artists[0],"A");
  profile.mode="balanced";assert.ok(recommend(candidates,profile,[liked],{now,random}).some(item=>item.id===unknown.id));
});

test("cold start and collaboration reranking avoid adjacent shared artists when alternatives exist",()=>{
  const profile=readTaste(),candidates=[song(1,"A"),song(2,"A"),song(3,"A"),song(4,"B"),song(5,"B"),song(6,"C"),song(7,"C")];
  const result=recommend(candidates,profile,[],{now,random,limit:6});
  for(let i=1;i<result.length;i++)assert.ok(!tasteArtistKeys(result[i]).some(key=>tasteArtistKeys(result[i-1]).includes(key)));
  const collaboration={...song(8),artists:["A","B"]},other=song(9,"C");
  const joined=recommend([collaboration,song(10,"A"),other],profile,[collaboration],{now,random,limit:3});
  assert.equal(joined[0].id,collaboration.id);assert.equal(joined[1].id,other.id);
  const seeds=tasteSeeds(profile,[collaboration,song(11,"B"),other],{now,random,limit:3});
  const all=seeds.flatMap(tasteArtistKeys);assert.equal(new Set(all).size,all.length);
});

test("recent artist context crosses batch boundaries but a sole-artist radio still has candidates",()=>{
  const profile=readTaste(),liked=song(1,"A"),a=song(2,"A"),b=song(3,"B");
  assert.equal(recommend([a,b],profile,[liked],{now,random})[0].id,a.id);
  assert.equal(recommend([a,b],profile,[liked],{now,random,contextItems:[liked]})[0].id,b.id);
  assert.equal(recommend([a,b],profile,[liked],{now,random,recentArtists:[" A ","Ａ"]})[0].id,b.id);
  assert.deepEqual(recommend([a,song(4,"A")],profile,[liked],{now,random,contextItems:[liked],limit:2}).map(item=>item.id),[a.id,song(4).id]);
});

test("track cooldown affects recommendation generation, then expires without changing a manual queue",()=>{
  const profile=readTaste(),a=song(1,"A"),b=song(2,"B"),manual=[a,b];
  recordListening(profile,a,{seconds:190,duration:200},now);
  assert.deepEqual(recommend(manual,profile,[a],{now:now+60000,random}).map(item=>item.id),[b.id]);
  assert.ok(recommend(manual,profile,[a],{now:now+31*60000,random}).some(item=>item.id===a.id));
  assert.deepEqual(manual,[a,b]);
});

test("reason metadata names only supported local signals and does not mutate candidates or stored preferences",()=>{
  const profile=readTaste(),liked=song(1,"Liked"),followed=song(2,"Followed"),related=song(3,"Liked"),heard=song(4,"History"),discovery=song(5,"New");
  recordListening(profile,heard,{seconds:190,duration:200},now-3*86400000);
  const items=Object.freeze([liked,followed,related,heard,discovery]);for(const item of items){Object.freeze(item.artists);Object.freeze(item);}
  const favorites=Object.freeze([liked]),before=JSON.stringify(profile),options={now,random,followedArtists:["Followed"]};
  const expected=new Map([[liked.id,"liked"],[followed.id,"followed_artist"],[related.id,"related_artist"],[heard.id,"listening_history"],[discovery.id,"discovery"]]);
  const rows=recommendWithReasons(items,profile,favorites,options);
  assert.deepEqual(recommend(items,profile,favorites,options),rows.map(row=>row.item));
  for(const row of rows){assert.equal(row.reason.code,expected.get(row.item.id));assert.ok(Object.keys(row.reason).every(key=>["code","artist"].includes(key)));assert.equal(row.item,items.find(item=>item.id===row.item.id));}
  assert.equal(JSON.stringify(profile),before);
  assert.equal(recommendationReason(related,profile,favorites,options).artist,"Liked");
});

test("malformed evidence, future timestamps and random callbacks cannot poison ranking or override real preferences",()=>{
  const profile=readTaste(),liked=song(1,"A"),future=song(2,"B"),damaged=song(3,"C");
  profile.entries[future.id]={item:future,score:8,plays:9999,at:Number.MAX_SAFE_INTEGER,lastPlayed:Number.MAX_SAFE_INTEGER};
  profile.entries[damaged.id]={item:damaged,score:NaN,plays:Infinity,at:NaN,lastPlayed:Infinity};
  profile.mode="familiar";
  assert.equal(recommend([future,damaged,liked],profile,[liked],{now,random:()=>NaN})[0].id,liked.id);
  assert.equal(recommendationReason(future,profile,[],{now}).code,"discovery");
  assert.doesNotThrow(()=>recommend([null,{id:{toString(){throw Error("no coercion");}},kind:"song",title:"bad"},{...song(4),artists:[null,{},"A".repeat(201)]},liked],profile,[liked],{now:NaN,random(){throw Error("unavailable");},followedArtists:[null,42]}));
  assert.deepEqual(recommend([liked],profile,[liked],{now,limit:0}),[]);assert.deepEqual(tasteSeeds(profile,[liked],{now,limit:0}),[]);
});

test("listening clock ignores invalid samples and the first resumed interval after silence",()=>{
  const clock=listeningClock();clock.sample(0,0,true);clock.sample(1,1000,true);clock.sample(2,2000,false);clock.sample(20,20000,false);
  clock.sample(21,21000,true);assert.equal(clock.seconds,1);clock.sample(22,22000,true);assert.equal(clock.seconds,2);
  clock.sample(NaN,23000,true);clock.sample(24,24000,true);assert.equal(clock.seconds,2);clock.sample(25,25000,true);assert.equal(clock.seconds,3);
});

test("two thousand candidates remain bounded, unique and fast with a full local history",()=>{
  const profile=readTaste();for(let i=0;i<1000;i++){const item=song(i,`Artist ${i%50}`);profile.entries[item.id]={item,score:2.5,plays:1,at:now-3*86400000,lastPlayed:now-3*86400000};}
  const candidates=Array.from({length:2000},(_,i)=>song(i+2000,`Artist ${i%100}`)),before=JSON.stringify(candidates),started=performance.now();
  const result=recommendWithReasons(candidates,profile,[],{now,random,limit:40});
  assert.equal(result.length,40);assert.equal(new Set(result.map(row=>row.item.id)).size,40);assert.equal(JSON.stringify(candidates),before);
  assert.ok(performance.now()-started<1500,"bounded local reranking should not block the player for seconds");
});

test("a passive exposure restored after restart does not suppress the first qualified listen",()=>{
  const item=song(1),profile=readTaste();
  recordListening(profile,item,{seconds:5,duration:200,session:1},now);
  const restored=readTaste({getItem:()=>JSON.stringify(profile)});
  recordListening(restored,item,{seconds:40,duration:200,session:2},now+60000);
  assert.equal(restored.entries[item.id].plays,1);assert.equal(restored.entries[item.id].score,1);
  recordListening(restored,item,{seconds:190,duration:200,session:3},now+120000);
  assert.equal(restored.entries[item.id].plays,1);
});

test("missing artist metadata cannot claim a newly discovered artist",()=>{
  const item={...song(1),artists:[]},profile=readTaste();
  assert.equal(recommendationReason(item,profile,[],{now}).code,"catalog");
  assert.equal(recommendWithReasons([item],profile,[],{now,random})[0].reason.code,"catalog");
});
