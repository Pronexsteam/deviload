import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {tracks,remember,nextIndex} from "../src/music-state.js";
import {readTaste,recommend,tasteSeeds} from "../src/music-taste.js";

const source=readFileSync(new URL("../src/devil-music.js",import.meta.url),"utf8");
const code=source.slice(source.indexOf("  function plannedNext()"),source.indexOf("  function selectView("));
const song=n=>({id:String(n).padStart(11,"0"),title:`Song ${n}`,subtitle:"Artist",artists:[`Artist ${n}`],kind:"song"});
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function player(invoke,items=[song(1)]){
  const events={},timers=new Map();let serial=0;
  const field=()=>({textContent:"",disabled:false,value:"",replaceChildren(){}});
  const audio={currentTime:0,duration:180,paused:true,ended:false,readyState:4,seeking:false,src:"",playError:null,hang:false,
    addEventListener:(name,callback)=>{events[name]=callback;},
    async play(){if(this.playError)throw this.playError;if(this.hang)return new Promise(()=>{});this.paused=false;this.ended=false;events.play?.();events.playing?.();},
    pause(){if(!this.paused){this.paused=true;events.pause?.();}},
    removeAttribute(){this.src="";},load(){this.currentTime=0;this.ended=false;}};
  Object.defineProperty(audio,"src",{get(){return this.address||"";},set(value){this.address=value;if(value)queueMicrotask(()=>events.loadedmetadata?.());}});
  const ctx={audio,queue:items,index:-1,current:null,resolvedTrack:null,autoplay:true,radioPending:false,streamLoading:false,playRequest:0,
    nextPlan:null,preloadPending:false,preloadAttempts:new Set(),radioAhead:null,time:String,
    resolution:Promise.resolve(),radioCache:new Map(),repeat:false,shuffle:false,session:0,checkpoint:0,historyAdded:false,recoveryUsed:false,pendingSeek:0,retryPosition:0,bufferingTimer:null,
    saved:{favorites:[],recent:[]},taste:readTaste(),clock:{seconds:0,reset(){this.seconds=0;},sample() {return this.seconds;}},
    title:field(),artist:field(),artwork:field(),seek:field(),elapsed:field(),duration:field(),previous:{click(){}},
    invoke,tracks,remember,nextIndex,recommend,tasteSeeds,cover:()=>null,language:()=>"en",t:s=>s,errorText:String,
    captureListening(){},persist(){},syncDock(){},renderQueue(){},status(message){ctx.message=message;},
    document:{querySelectorAll:()=>[],addEventListener(){}},navigator:{},performance,DOMException,
    setTimeout(fn){const id=++serial;timers.set(id,fn);return id;},clearTimeout(id){timers.delete(id);}};
  const actions=runInNewContext(`(()=>{${code}\nreturn {playAt,playItems,togglePlay,advance};})()`,ctx);
  return {ctx,...actions,emit:name=>events[name]?.(),expire(){const pending=[...timers.values()];timers.clear();pending.forEach(fn=>fn());}};
}
test("rapid track changes discard stale resolutions and never start the canceled selection",async()=>{
  const first=deferred(),calls=[];
  const p=player(async(_,args)=>{calls.push(args.id);return calls.length===1?first.promise:{url:args.id};},[song(1),song(2),song(3)]);
  const a=p.playAt(0);await settle();const b=p.playAt(1),c=p.playAt(2);
  first.resolve({url:"old"});await Promise.all([a,b,c]);
  assert.deepEqual(calls,[song(1).id,song(3).id]);assert.equal(p.ctx.audio.src,song(3).id);assert.equal(p.ctx.streamLoading,false);
});
test("failed resume gets a fresh source on retry and retains the listening position",async()=>{
  const calls=[];const p=player(async(_,args)=>{calls.push(args);return {url:"audio"};});
  await p.playAt(0);p.ctx.audio.currentTime=42;p.ctx.audio.pause();p.ctx.audio.playError=Error("expired URL");
  await p.togglePlay();assert.equal(p.ctx.resolvedTrack,null);assert.equal(p.ctx.streamLoading,false);
  p.ctx.audio.playError=null;await p.togglePlay();
  assert.equal(calls.at(-1).refresh,true);assert.equal(p.ctx.audio.currentTime,42);assert.equal(p.ctx.audio.paused,false);
});
test("natural end extends the queue once with related music, while disabled autoplay stops",async()=>{
  const calls=[];const p=player(async(command,args)=>{calls.push(command);return command==="music_stream"?{url:args.id}:{sections:[{items:[song(1),song(2),song(3)]}]};});
  await p.playAt(0);p.ctx.autoplay=false;await p.advance(false);assert.deepEqual(calls,["music_stream"]);
  p.ctx.autoplay=true;await p.advance(false);await settle();
  assert.equal(p.ctx.queue.length,3);assert.notEqual(p.ctx.current.id,song(1).id);assert.equal(p.ctx.radioPending,false);assert.equal(p.ctx.audio.paused,false);
});
test("old radio completion cannot clear a newer radio request or replace its queue",async()=>{
  const pending=new Map();const p=player(async(command,args)=>{if(command==="music_stream")return {url:args.id};const d=deferred();pending.set(args.value,d);return d.promise;});
  await p.playAt(0);const old=p.advance(false);await settle();
  p.playItems([song(2)],song(2).id);await settle();const next=p.advance(false);await settle();
  pending.get(song(1).id).resolve({sections:[{items:[song(9)]}]});await old;
  assert.equal(p.ctx.radioPending,true);assert.equal(p.ctx.queue.length,1);
  pending.get(song(2).id).resolve({sections:[{items:[song(3)]}]});await next;await settle();
  assert.equal(p.ctx.current.id,song(3).id);assert.equal(p.ctx.radioPending,false);
});
test("mid-track errors recover once at the same position instead of retrying forever",async()=>{
  const calls=[];const p=player(async(_,args)=>{calls.push(args);return {url:"audio"};});
  await p.playAt(0);p.ctx.clock.seconds=15;p.ctx.audio.currentTime=35;p.emit("error");await settle();
  assert.equal(calls.length,2);assert.equal(calls[1].refresh,true);assert.equal(p.ctx.audio.currentTime,35);
  p.emit("error");await settle();assert.equal(calls.length,2);assert.equal(p.ctx.resolvedTrack,null);
});
test("stalled audio startup and resume leave an enabled retry state after the deadline",async()=>{
  const p=player(async()=>({url:"audio"}));p.ctx.audio.hang=true;
  const start=p.playAt(0);await settle();p.expire();await start;
  assert.equal(p.ctx.streamLoading,false);assert.equal(p.ctx.resolvedTrack,null);assert.match(p.ctx.message,/did not start in time/);
  p.ctx.audio.hang=false;await p.togglePlay();p.ctx.audio.currentTime=50;p.ctx.audio.pause();p.ctx.audio.hang=true;
  const resume=p.togglePlay();await settle();p.expire();await resume;
  assert.equal(p.ctx.retryPosition,50);assert.equal(p.ctx.streamLoading,false);
});
test("a rate-limited source stops instead of requesting the rest of the queue",async()=>{
  let calls=0;const p=player(async()=>{calls++;throw Error("YouTube is temporarily limiting playback. Try again later.");},[song(1),song(2)]);
  await p.playAt(0);assert.equal(calls,1);assert.equal(p.ctx.streamLoading,false);assert.equal(p.ctx.audio.paused,true);
});

test("a sustained outage stops automatic recovery and manual retry resumes the same track",async()=>{
  const calls=[];let offline=false;
  const p=player(async(_,args)=>{calls.push(args);if(offline)throw Error("Network unavailable");return {url:"audio"};},[song(1),song(2)]);
  await p.playAt(0);p.ctx.audio.currentTime=55;p.ctx.clock.seconds=40;offline=true;
  p.emit("error");await settle();
  assert.equal(calls.length,2);assert.equal(p.ctx.audio.paused,true);assert.equal(p.ctx.streamLoading,false);
  assert.equal(p.ctx.retryPosition,55);assert.equal(p.ctx.current.id,song(1).id);
  await settle();assert.equal(calls.length,2);
  offline=false;await p.togglePlay();
  assert.equal(calls.length,3);assert.equal(p.ctx.audio.currentTime,55);assert.equal(p.ctx.audio.paused,false);
  assert.equal(p.ctx.current.id,song(1).id);
});

test("preload waits for the final window, warms only the next song and reuses the source",async()=>{
  const calls=[],cache=new Map();let resolutions=0;
  const p=player(async(_,args)=>{calls.push(args.id);if(!cache.has(args.id)){resolutions++;cache.set(args.id,{url:args.id});}return cache.get(args.id);},[song(1),song(2),song(3)]);
  await p.playAt(0);p.ctx.audio.currentTime=134;p.emit("timeupdate");await settle();assert.equal(calls.length,1);
  p.ctx.audio.currentTime=135;p.emit("timeupdate");await settle();
  assert.deepEqual(calls,[song(1).id,song(2).id]);assert.equal(p.ctx.audio.src,song(1).id);assert.equal(p.ctx.audio.paused,false);
  for(let i=0;i<10;i++)p.emit("timeupdate");await settle();assert.equal(calls.length,2);
  await p.advance();await settle();assert.equal(p.ctx.audio.src,song(2).id);assert.equal(resolutions,2);
});

test("preload does not run while paused, seeking, buffering, offline, or just starting",async()=>{
  let calls=0;const p=player(async(_,args)=>{calls++;return {url:args.id};},[song(1),song(2)]);
  await p.playAt(0);p.ctx.audio.currentTime=150;
  for(const [key,value,restore]of [["paused",true,false],["seeking",true,false],["readyState",3,4]]){
    p.ctx.audio[key]=value;p.emit("timeupdate");await settle();p.ctx.audio[key]=restore;
  }
  p.ctx.navigator.onLine=false;p.emit("timeupdate");await settle();p.ctx.navigator.onLine=true;
  p.ctx.audio.duration=30;p.ctx.audio.currentTime=1;p.emit("timeupdate");await settle();assert.equal(calls,1);
});

test("shuffle advances to the prepared song and queue edits invalidate the old choice",async()=>{
  const calls=[];const p=player(async(_,args)=>{calls.push(args.id);return {url:args.id};},[song(1),song(2),song(3)]);
  p.ctx.shuffle=true;await p.playAt(0);p.ctx.audio.currentTime=150;p.emit("timeupdate");await settle();
  const warmed=calls.at(-1);await p.advance();await settle();assert.equal(p.ctx.current.id,warmed);
  p.ctx.shuffle=false;await p.playAt(0);p.ctx.audio.currentTime=150;p.emit("timeupdate");await settle();
  p.ctx.queue=[song(1),song(3),song(2)];p.emit("timeupdate");await settle();
  await p.advance();await settle();assert.equal(p.ctx.current.id,song(3).id);
});

test("a failed preload stays silent, never loops, and does not skip an unavailable song",async()=>{
  const calls=[];const p=player(async(_,args)=>{calls.push(args.id);if(args.id===song(2).id)throw Error("YouTube is temporarily limiting playback. Try again later.");return {url:args.id};},[song(1),song(2),song(3)]);
  await p.playAt(0);p.ctx.audio.currentTime=150;p.emit("timeupdate");await settle();
  assert.equal(p.ctx.audio.paused,false);assert.equal(p.ctx.message,"");assert.equal(p.ctx.resolvedTrack,song(1).id);
  for(let i=0;i<10;i++)p.emit("timeupdate");await settle();assert.equal(calls.length,2);
  await p.advance();await settle();assert.equal(p.ctx.current.id,song(2).id);assert.equal(p.ctx.audio.paused,true);
  assert.ok(!calls.includes(song(3).id));
});

test("a pending preload never replaces a newer manual selection",async()=>{
  const pending=deferred(),calls=[];
  const p=player(async(_,args)=>{calls.push(args.id);return args.id===song(2).id?pending.promise:{url:args.id};},[song(1),song(2),song(3)]);
  await p.playAt(0);p.ctx.audio.currentTime=150;p.emit("timeupdate");await settle();
  const selected=p.playAt(2);await selected;
  assert.equal(p.ctx.audio.src,song(3).id); // Do not wait for the stale background job.
  pending.resolve({url:song(2).id});await settle();
  assert.equal(p.ctx.audio.src,song(3).id);assert.equal(p.ctx.current.id,song(3).id);assert.equal(p.ctx.preloadPending,false);
});

test("the end of a queue prepares related music before playback ends without appending early",async()=>{
  const calls=[];const p=player(async(command,args)=>{
    calls.push({command,args});return command==="music_stream"?{url:args.id}:{sections:[{items:[song(1),song(2),song(3)]}]};
  });
  await p.playAt(0);p.ctx.audio.currentTime=150;p.emit("timeupdate");await settle();await settle();
  assert.equal(p.ctx.queue.length,1);assert.equal(p.ctx.current.id,song(1).id);
  const prepared=calls.find(call=>call.args.preload);assert.ok(prepared);
  await p.advance();await settle();assert.equal(p.ctx.current.id,prepared.args.id);
  assert.equal(calls.filter(call=>call.command==="music_catalog").length,1);
});

test("disabling autoplay ignores prepared radio and does not extend the queue",async()=>{
  const p=player(async(command,args)=>command==="music_stream"?{url:args.id}:{sections:[{items:[song(2)]}]});
  await p.playAt(0);p.ctx.audio.currentTime=150;p.emit("timeupdate");await settle();
  p.ctx.autoplay=false;await p.advance();assert.equal(p.ctx.queue.length,1);assert.equal(p.ctx.current.id,song(1).id);
});

test("queue churn has a bounded preload budget and repeat wraps to the first song",async()=>{
  const calls=[];const p=player(async(_,args)=>{calls.push(args.id);return {url:args.id};},[song(1),song(2)]);
  await p.playAt(0);p.ctx.audio.currentTime=150;
  for(let i=2;i<=8;i++){p.ctx.queue=[song(1),song(i)];p.emit("timeupdate");await settle();}
  assert.equal(calls.length,3);
  p.ctx.queue=[song(1),song(2)];p.ctx.repeat=true;await p.playAt(1);p.ctx.audio.currentTime=150;p.emit("timeupdate");await settle();
  assert.equal(calls.at(-1),song(1).id);await p.advance();await settle();assert.equal(p.ctx.current.id,song(1).id);
});
