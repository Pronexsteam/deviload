import test from "node:test";
import assert from "node:assert/strict";
import {readTaste,recordListening,tasteSeeds,recommend,listeningClock,hideRecommendation} from "../src/music-taste.js";
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
