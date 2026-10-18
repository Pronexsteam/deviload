import test from "node:test";
import assert from "node:assert/strict";
import {rankMusicRecommendations} from "../src/music-recommendation-engine.js";
import {readTaste,recommendWithReasons,recordListening} from "../src/music-taste.js";
import {createRecommendationSession} from "../src/music-recommendation-session.js";

const song=(n,artist=`Artist ${n}`)=>({id:String(n).padStart(11,"0"),kind:"song",title:`Song ${n}`,artists:[artist],duration:180});
const now=1800000000000,day=86400000;
const state=()=>({favorites:[],recent:[],playlists:[],collections:[],interestMixes:[],sourceBindings:[]});
const options={now,random:()=>.5,limit:10};

test("unbound global recommendations remain equivalent to the existing ranker",()=>{
  const saved=state(),taste=readTaste(),items=[song(1),song(2),song(3)];saved.favorites=[items[1]];
  assert.deepEqual(rankMusicRecommendations(items,saved,taste,options),recommendWithReasons(items,taste,saved.favorites,options));
});

test("confirmed source aliases share likes, exclusions and qualified cooldown in the combined engine",()=>{
  const saved=state(),taste=readTaste(),a=song(1,"Wanted"),b=song(2,"Wanted"),other=song(3);
  saved.favorites=[a];saved.sourceBindings=[{trackId:a.id,track:a,source:b}];
  const rows=rankMusicRecommendations([b,a,other],saved,taste,options);
  assert.equal(rows.filter(row=>[a.id,b.id].includes(row.item.id)).length,1);assert.equal(rows[0].item.id,a.id);assert.equal(rows[0].reason.code,"liked");
  taste.hiddenSongs=[b.id];assert.deepEqual(rankMusicRecommendations([a,b,other],saved,taste,options).map(row=>row.item.id),[other.id]);
  taste.hiddenSongs=[];recordListening(taste,a,{seconds:150,duration:180},now-1000);
  assert.deepEqual(rankMusicRecommendations([a,b,other],saved,taste,options).map(row=>row.item.id),[other.id]);
});

test("interest scope and recording correction compose without bringing in unrelated global favorites",()=>{
  const saved=state(),taste=readTaste(),anchor=song(1,"Jazz"),physical=song(2,"Jazz"),jazz=song(3,"Jazz"),phonk=song(4,"Phonk");
  saved.playlists=[{id:"work",name:"Work",items:[anchor]}];saved.interestMixes=[{id:"focus",name:"Focus",playlistIds:["work"]}];
  saved.sourceBindings=[{trackId:anchor.id,track:anchor,source:physical}];saved.favorites=[phonk];
  recordListening(taste,anchor,{seconds:150,duration:180},now-3*day);
  const before=JSON.stringify({saved,taste}),manual=[phonk,anchor];
  const rows=rankMusicRecommendations([physical,jazz,phonk],saved,taste,{...options,interestId:"focus",queue:manual,exclude:[physical.id]});
  assert.equal(rows[0].item.id,jazz.id);assert.ok(!rows.some(row=>row.item.id===anchor.id));
  assert.equal(JSON.stringify({saved,taste}),before);assert.deepEqual(manual,[phonk,anchor]);
});

test("temporary eligibility is applied after alias canonicalization and scores cannot double-count uploads",()=>{
  const saved=state(),taste=readTaste(),a=song(1),b=song(2),other=song(3);
  saved.sourceBindings=[{trackId:a.id,track:a,source:b}];
  const rows=rankMusicRecommendations([b,other],saved,taste,{...options,candidateScores:new Map([[a.id,3],[b.id,3]]),eligible:items=>items.filter(item=>item.id!==a.id)});
  assert.deepEqual(rows.map(row=>row.item.id),[other.id]);
});

test("temporary skips on a physical source suppress its logical candidate until the session gate expires",()=>{
  const saved=state(),taste=readTaste(),a=song(1),b=song(2),other=song(3),session=createRecommendationSession();
  saved.sourceBindings=[{trackId:a.id,track:a,source:b}];
  session.recordSkip(b,{seconds:5,duration:180,session:1,intent:"next"},now);
  session.recordSkip(b,{seconds:5,duration:180,session:2,intent:"next"},now);
  const rank=clock=>rankMusicRecommendations([a,b,other],saved,taste,{...options,now:clock,eligible:items=>session.allowed(items,clock)}).map(row=>row.item.id);
  assert.deepEqual(rank(now),[other.id]);
  assert.ok(rank(now+20*60000).includes(a.id));
  session.recordSkip(b,{seconds:5,duration:180,session:3,intent:"next"},now+21*60000);
  session.recordSkip(b,{seconds:5,duration:180,session:4,intent:"next"},now+21*60000);
  assert.deepEqual(rank(now+21*60000),[other.id]);
  session.recordListen(b,{seconds:40,duration:180});assert.ok(rank(now+21*60000).includes(a.id));
});

test("a physical source failure applies across confirmed chains and recovers without affecting unbound tracks",()=>{
  const saved=state(),taste=readTaste(),a=song(1),b=song(2),c=song(3),other=song(4),session=createRecommendationSession();
  saved.sourceBindings=[{trackId:a.id,track:a,source:b},{trackId:b.id,track:b,source:c}];
  const rank=clock=>rankMusicRecommendations([a,c,other],saved,taste,{...options,now:clock,eligible:items=>session.allowed(items,clock)}).map(row=>row.item.id);
  session.fail(c.id,now);assert.deepEqual(rank(now),[other.id]);
  session.recover(c.id);assert.ok(rank(now).includes(a.id));
  session.fail(b.id,now);assert.deepEqual(rank(now),[other.id]);assert.ok(rank(now+90000).includes(a.id));
});

test("alias eligibility is bounded and still checks aliases beyond the first candidate batch",()=>{
  const saved=state(),taste=readTaste(),a=song(1),b=song(9001),session=createRecommendationSession(),batches=[];
  saved.sourceBindings=[{trackId:a.id,track:a,source:b}];session.fail(b.id,now);
  const candidates=Array.from({length:2000},(_,index)=>song(index+1));
  const rows=rankMusicRecommendations(candidates,saved,taste,{...options,eligible:items=>{batches.push(items.length);return session.allowed(items,now);}});
  assert.deepEqual(batches,[2000,1]);assert.ok(!rows.some(row=>row.item.id===a.id));assert.ok(rows.length>0);
});
