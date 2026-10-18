import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {tracks,remember,nextIndex} from "../src/music-state.js";
import {readTaste,recordListening,recommend,tasteSeeds,listeningClock,tasteArtistKeys,canonicalArtistKey} from "../src/music-taste.js";
import {mergeRecommendationPools} from "../src/music-recommendation-view.js";
import {createRecommendationSession} from "../src/music-recommendation-session.js";
import {rankMusicRecommendations} from "../src/music-recommendation-engine.js";
import {createRecordingView} from "../src/music-recording-view.js";
import {resolveRecordingSource,setRecordingSource,removeRecordingSource,recordingFamilyIds} from "../src/music-recordings.js";
import {rememberInterestTrack,interestProfile,interestSources,interestSeeds} from "../src/music-interest-mixes.js";
import {sanitizeMusicTrack,saveMusicProfile} from "../src/music-profile.js";
import {musicGain} from "../src/music-volume.js";
import {createPlaybackOrder} from "../src/music-session.js";
import {createMusicDiagnostics,playbackFailure} from "../src/music-diagnostics.js";

const source=readFileSync(new URL("../src/devil-music.js",import.meta.url),"utf8");
const code=source.slice(source.indexOf("  function invalidateRecommendations("),source.indexOf("  function visibleRecommendation("))+
  source.slice(source.indexOf("  async function playbackSource("),source.indexOf("  async function showOffline("))+
  source.slice(source.indexOf("  function refreshCurrentRecording("),source.indexOf("  function equalizer("))+
  source.slice(source.indexOf("  function renderInterestPool("),source.indexOf("  async function personalize("))+
  source.slice(source.indexOf("  function recordingFamily("),source.indexOf("  function selectView("))+
  source.slice(source.indexOf("  wireMusicProfile("),source.indexOf("  function chooseArtists("));
const song=n=>({id:String(n).padStart(11,"0"),title:`Song ${n}`,subtitle:"Artist",artists:[`Artist ${n}`],kind:"song"});
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function player(invoke,items=[song(1)]){
  const events={},timers=new Map(),controls=new Map(),memory=new Map();let serial=0;
  const field=()=>({textContent:"",disabled:false,value:"",replaceChildren(){}});
  const audio={currentTime:0,duration:180,paused:true,ended:false,readyState:4,seeking:false,volume:.7,muted:false,src:"",playError:null,hang:false,
    addEventListener:(name,callback)=>{events[name]=callback;},
    async play(){if(this.playError)throw this.playError;if(this.hang)return new Promise(()=>{});this.paused=false;this.ended=false;events.play?.();events.playing?.();},
    pause(){if(!this.paused){this.paused=true;events.pause?.();}},
    removeAttribute(){this.src="";},load(){this.currentTime=0;this.ended=false;}};
  Object.defineProperty(audio,"src",{get(){return this.address||"";},set(value){this.address=value;if(value)queueMicrotask(()=>events.loadedmetadata?.());}});
  const ctx={audio,queue:items,index:-1,current:null,resolvedTrack:null,autoplay:true,radioPending:false,streamLoading:false,playRequest:0,
    needsRefresh:false,privateSession:false,resumeSnapshot:null,discordPresence:{sync(){}},diagnostics:createMusicDiagnostics(),playbackFailure,
    listen:audio.addEventListener,decks:{take:()=>null,stopTail(){},warm(){},clear(){ctx.deckClears=(ctx.deckClears||0)+1;},setVolume(){},ready:()=>false,owns:node=>node===audio},sound:{resume(){},transition:0},lyrics:{update(){}},window:{},
    nextPlan:null,preloadPending:false,preloadAttempts:new Set(),radioAhead:null,time:String,recordingRoutingRevision:-1,recordingBoundIds:new Set(),recordingFamilies:new Map(),
    order:createPlaybackOrder(),knownDuration:0,sessionTransition:false,sessionSavedAt:Date.now(),intent:{leave(){}},radioCache:new Map(),repeat:"off",shuffle:false,session:0,checkpoint:0,historyAdded:false,recoveryUsed:false,pendingSeek:0,retryPosition:0,bufferingTimer:null,
    saved:{favorites:[],recent:[],collections:[],playlists:[],sourceBindings:[],interestMixes:[]},playbackContext:[],playbackOrigin:"manual",contextRevision:0,sourceRevision:0,interestPool:null,interestViewId:null,interestRotations:new Map(),personalization:0,recommendationRevision:0,playbackSourceContext:{kind:"restored"},recommendationSession:createRecommendationSession(),automaticQueueIds:new Set(),impressionTimers:new Map(),refreshRecommendationImpressions(){},clearRecommendationObservations(){},discoveryCandidates:[],recommendationReasons:new Map(),
    view:"home",lastQuery:{kind:"home"},activeMood:"",playlistId:null,browseItem:null,getPlaylist:()=>null,
    taste:readTaste(),clock:{seconds:0,reset(){this.seconds=0;},sample() {return this.seconds;}},
    title:field(),artist:field(),artwork:field(),seek:field(),elapsed:field(),duration:field(),previous:{click(){}},
    invoke:(command,args)=>{if(command==="music_cancel_stream"){ctx.cancellations=(ctx.cancellations||0)+1;return Promise.resolve();}return invoke(command,args);},tracks,remember,nextIndex,recommend,recordListening,tasteSeeds,tasteArtistKeys,canonicalArtistKey,mergeRecommendationPools,rankMusicRecommendations,createRecordingView,resolveRecordingSource,setRecordingSource,removeRecordingSource,recordingFamilyIds,sanitizeMusicTrack,saveMusicProfile,rememberInterestTrack,interestProfile,interestSources,interestSeeds,cover:()=>null,displaySubtitle:item=>item?.artists?.join(", ")||"Unknown artist",language:()=>"en",t:s=>s,errorText:String,
    storage:{getItem:key=>memory.get(key),setItem:(key,value)=>memory.set(key,value)},button(){},openRecordingPicker:options=>{ctx.picker=options;},downloadsPending:new Set(),presentation:{notify(){}},onDownload:null,homeCache:null,
    wireMusicProfile:options=>{ctx.profileActions=options;},library:{invalidateUndo(){},find(){}},musicGain,previousVolume:.7,syncVolume(){},showLocal(){},load(){},
    request:0,loading:false,loaded:false,sections:[],continuation:null,morePending:false,listFilter:"",listSort:"original",rememberNavigation(){},selectView:next=>{ctx.view=next;},skeleton(){},render(){ctx.rendered=ctx.sections;},prepareHomeSelection(){},showPlaylist(){},
    $:id=>{if(!controls.has(id))controls.set(id,field());return controls.get(id);},
    captureListening(){},persist(){},persistSession(){},syncDock(){},renderQueue(){},status(message){ctx.message=message;},
    document:{querySelectorAll:()=>[],addEventListener(){}},navigator:{},performance,DOMException,
    setTimeout(fn){const id=++serial;timers.set(id,fn);return id;},clearTimeout(id){timers.delete(id);}};
  Object.assign(ctx,{publicDiscovery:{candidates:async()=>[],clear(){}},publicGeneration:0});
  const actions=runInNewContext(`(()=>{${code}\nreturn {playAt,playItems,togglePlay,resumeListening,advance,preloadNext,clearRecommendationContext,plannedNext,rankRadioPool,radioCandidates,playbackSource,invalidateRecommendations,chooseRecording,refreshCurrentRecording,restoreProfile:profileActions.restore,downloadTrack,showInterestMix,renderInterestPool};})()`,ctx);
  return {ctx,...actions,emit:name=>events[name]?.(),expire(){const pending=[...timers.values()];timers.clear();pending.forEach(fn=>fn());}};
}
test("source restrictions explain the failure without starting audio or scheduling retries",async()=>{
  let calls=0;const failure="Playback restricted: YouTube requires sign-in or verification. Try another track.";
  const p=player(async()=>{calls++;throw failure;});
  await p.playAt(0);p.expire();await settle();
  assert.equal(calls,1);assert.equal(p.ctx.audio.paused,true);assert.equal(p.ctx.streamLoading,false);
  assert.equal(p.ctx.artist.textContent,"Unavailable from source. Try another track.");assert.equal(p.ctx.message,failure);
});

test("muted playback never teaches taste and unmuting starts a fresh listening interval",async()=>{
  const p=player(async()=>({url:"audio"}));await p.playAt(0);
  let wall=0;p.ctx.performance={now:()=>wall};p.ctx.clock=listeningClock();p.emit("playing");
  function tick(seconds){wall=seconds*1000;p.ctx.audio.currentTime=seconds;p.emit("timeupdate");}
  tick(1);assert.equal(p.ctx.clock.seconds,1);
  p.ctx.audio.volume=0;p.emit("volumechange");
  for(let at=2;at<=40;at++)tick(at);
  assert.equal(p.ctx.clock.seconds,1);
  p.ctx.audio.volume=.25;p.emit("volumechange");tick(41);
  assert.equal(p.ctx.clock.seconds,2);
  p.ctx.audio.muted=true;p.emit("volumechange");tick(42);tick(43);
  assert.equal(p.ctx.clock.seconds,2);
  p.ctx.audio.muted=false;p.emit("volumechange");tick(44);
  assert.equal(p.ctx.clock.seconds,3);
});

test("rapid track changes discard stale resolutions and never start the canceled selection",async()=>{
  const first=deferred(),calls=[];
  const p=player(async(_,args)=>{calls.push(args.id);return calls.length===1?first.promise:{url:args.id};},[song(1),song(2),song(3)]);
  const a=p.playAt(0);await settle();const b=p.playAt(1),c=p.playAt(2);
  await c;assert.equal(p.ctx.audio.src,song(3).id); // The old extraction is still unresolved.
  first.resolve({url:"old"});await Promise.all([a,b,c]);
  assert.deepEqual(calls,[song(1).id,song(3).id]);assert.equal(p.ctx.audio.src,song(3).id);assert.equal(p.ctx.streamLoading,false);
});

test("continue listening resumes the card's song after another song replaces the queue",async()=>{
  const p=player(async(_,args)=>({url:args.id}),[song(1),song(2)]);
  await p.playAt(0);p.ctx.audio.currentTime=42;
  const snapshot=p.ctx.resumeSnapshot={item:song(1),queue:[song(1),song(2)],position:0};
  p.playItems([song(3)],song(3).id);await settle();
  assert.equal(snapshot.position,42);assert.equal(p.ctx.current.id,song(3).id);
  await p.resumeListening(snapshot);
  assert.equal(p.ctx.current.id,song(1).id);assert.equal(p.ctx.audio.currentTime,42);
  assert.equal(p.ctx.audio.paused,false);assert.deepEqual(Array.from(p.ctx.queue,item=>item.id),[song(1).id,song(2).id]);
});

test("continue listening never pauses an already playing song or cancels its loading",async()=>{
  const p=player(async(_,args)=>({url:args.id}));await p.playAt(0);
  const snapshot={item:song(1),queue:[song(1)],position:0};
  await p.resumeListening(snapshot);assert.equal(p.ctx.audio.paused,false);
  p.ctx.audio.currentTime=27;p.ctx.audio.pause();await p.resumeListening(snapshot);
  assert.equal(p.ctx.audio.currentTime,27);assert.equal(p.ctx.audio.paused,false);
  p.ctx.streamLoading=true;await p.resumeListening(snapshot);assert.equal(p.ctx.streamLoading,true);
});

test("a prepared decoder activates its backend continuation without reloading its source",async()=>{
  let calls=0;const p=player(async()=>{calls++;return {url:"already-buffered"};});
  p.ctx.audio.address="already-buffered";p.ctx.decks.take=()=>p.ctx.audio;
  p.ctx.audio.load=()=>{throw Error("prepared audio must not reload");};
  await p.playAt(0,{resume:42});
  assert.equal(calls,1);assert.equal(p.ctx.audio.src,"already-buffered");
  assert.equal(p.ctx.audio.currentTime,42);assert.equal(p.ctx.pendingSeek,0);assert.equal(p.ctx.audio.paused,false);
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
test("autoplay passes actual recent playback across batches, even after the queue is replaced",async()=>{
  const p=player(async(command,args)=>command==="music_stream"?{url:args.id}:{sections:[{items:[song(4)]}]});
  await p.playAt(0);p.playItems([song(2)],song(2).id);await settle();
  let context;p.ctx.rankMusicRecommendations=(items,saved,taste,options)=>{context=options.contextItems;return rankMusicRecommendations(items,saved,taste,options);};
  await p.advance();await settle();
  assert.deepEqual(Array.from(context,item=>item.id),[song(2).id,song(1).id]);
  assert.equal(p.ctx.current.id,song(4).id);
});
test("natural completion and manual navigation after a short portion are not explicit dislikes",async()=>{
  for(const manual of [false,true]){
    const p=player(async(_,args)=>({url:args.id}),[song(1),song(2)]);await p.playAt(0);
    p.ctx.captureListening=(skipped,intent)=>recordListening(p.ctx.taste,p.ctx.current,{seconds:p.ctx.clock.seconds,duration:p.ctx.audio.duration,session:p.ctx.session,skipped,intent},1800000000000);
    p.ctx.clock.seconds=5;p.ctx.audio.currentTime=180;p.ctx.audio.ended=true;
    await p.advance(manual);await settle();
    assert.equal(p.ctx.taste.entries[song(1).id].score,0);
    assert.equal(p.ctx.taste.entries[song(1).id].plays,0);
    assert.equal(p.ctx.current.id,song(2).id);
  }
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

test("preload prepares after two seconds for early Next clicks and reuses the source",async()=>{
  const calls=[],cache=new Map();let resolutions=0;
  const p=player(async(_,args)=>{calls.push(args.id);if(!cache.has(args.id)){resolutions++;cache.set(args.id,{url:args.id});}return cache.get(args.id);},[song(1),song(2),song(3)]);
  await p.playAt(0);p.ctx.audio.currentTime=1;p.emit("timeupdate");await settle();assert.equal(calls.length,1);
  p.ctx.audio.currentTime=2;p.emit("timeupdate");await settle();
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
  p.ctx.navigator.connection={saveData:true};p.emit("timeupdate");await settle();p.ctx.navigator.connection.saveData=false;
  p.ctx.audio.duration=30;p.ctx.audio.currentTime=1;p.emit("timeupdate");await settle();assert.equal(calls,1);
});

test("long songs wait until the prepared source will still be fresh at their end",async()=>{
  let calls=0;const p=player(async(_,args)=>{calls++;return {url:args.id};},[song(1),song(2)]);
  await p.playAt(0);p.ctx.audio.duration=900;p.ctx.audio.currentTime=659;p.emit("timeupdate");await settle();assert.equal(calls,1);
  p.ctx.audio.currentTime=660;p.emit("timeupdate");await settle();assert.equal(calls,2);
});

test("cancel loading stops backend work and a late response cannot start audio",async()=>{
  const pending=deferred();const p=player(()=>pending.promise);
  const started=p.playAt(0);await settle();await p.togglePlay();
  assert.equal(p.ctx.cancellations,1);assert.equal(p.ctx.streamLoading,false);
  pending.resolve({url:"cancelled"});await started;
  assert.equal(p.ctx.audio.src,"");assert.equal(p.ctx.audio.paused,true);
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
  assert.equal(calls.length,2);
  p.ctx.queue=[song(1),song(2)];p.ctx.repeat="all";await p.playAt(1);p.ctx.audio.currentTime=150;p.emit("timeupdate");await settle();
  assert.equal(calls.at(-1),song(1).id);await p.advance();await settle();assert.equal(p.ctx.current.id,song(1).id);
});

test("repeat one repeats on natural completion but a manual skip advances",async()=>{
  const p=player(async(_,args)=>({url:args.id}),[song(1),song(2)]);
  p.ctx.repeat="one";await p.playAt(0);await p.advance(false);await settle();assert.equal(p.ctx.current.id,song(1).id);
  await p.advance(true);await settle();assert.equal(p.ctx.current.id,song(2).id);
});

test("autoplay uses the selected listening context and preserves raw station provenance within two requests",async()=>{
  const queries=[],jazzA={...song(1),artists:["Jazz A"]},jazzB={...song(2),artists:["Jazz B"]},global={...song(9),artists:["Phonk"]};
  const p=player(async(command,args)=>{if(command==="music_stream")return {url:args.id};queries.push(args.value);return {sections:[{items:[song(3),song(4)]}]};});
  p.ctx.saved.favorites=[global];p.playItems([jazzA,jazzB,global],jazzB.id,{kind:"playlist",id:"jazz-list",label:"Evening jazz"},[jazzA,jazzB]);await settle();
  const raw=await p.radioCandidates(p.ctx.current);
  assert.deepEqual(queries,[jazzB.id,jazzA.id]);assert.ok(!queries.includes(global.id));
  assert.equal(raw.pools.length,2);assert.ok(raw.pools.every(pool=>pool.contextual&&pool.source.kind==="playlist"&&pool.source.id==="jazz-list"));
  assert.deepEqual(Array.from(p.ctx.queue,item=>item.id),[jazzA.id,jazzB.id,global.id]);
});

test("a prepared raw radio pool is reranked with latest mode, favorites and exclusions on consumption",async()=>{
  for(const change of ["mode","favorite","hidden"]){
    const a={...song(2),artists:["Familiar"]},b={...song(3),artists:["New"]},liked={...song(9),artists:["Familiar"]},calls=[];
    const p=player(async(command,args)=>{calls.push({command,...args});return command==="music_stream"?{url:args.id}:{sections:[{items:[a,b]}]};});
    p.ctx.saved.favorites=[liked];p.ctx.taste.mode="familiar";await p.playAt(0);p.ctx.audio.currentTime=150;p.emit("timeupdate");await settle();await settle();
    assert.equal(calls.find(call=>call.preload)?.id,a.id);assert.equal(p.ctx.queue.length,1);const fetched=calls.filter(call=>call.command==="music_catalog").length;assert.ok(fetched<=2);
    if(change==="mode")p.ctx.taste.mode="discovery";
    else if(change==="favorite")p.ctx.saved.favorites=[b];
    else p.ctx.taste.hiddenSongs=[a.id];
    await p.advance(false);await settle();
    assert.equal(p.ctx.current.id,b.id,change);assert.equal(calls.filter(call=>call.command==="music_catalog").length,fetched);
  }
});

test("private context reset rejects an old radio error without clearing a newer request",async()=>{
  const old=deferred(),fresh=deferred();let catalogs=0;
  const p=player(async(command,args)=>command==="music_stream"?{url:args.id}:(++catalogs===1?old.promise:fresh.promise));
  await p.playAt(0);const first=p.advance(false);await settle();
  const queueBefore=Array.from(p.ctx.queue,item=>item.id);p.ctx.privateSession=true;p.clearRecommendationContext();
  assert.deepEqual(Array.from(p.ctx.recommendationSession.contextItems()),[]);assert.equal(p.ctx.radioPending,false);
  assert.deepEqual(Array.from(p.ctx.queue,item=>item.id),queueBefore);
  const second=p.advance(false);await settle();old.reject(Error("stale radio failure"));await first;
  assert.equal(p.ctx.radioPending,true);assert.notEqual(p.ctx.message,"stale radio failure");
  fresh.resolve({sections:[{items:[song(2)]}]});await second;await settle();
  assert.equal(p.ctx.current.id,song(2).id);assert.equal(p.ctx.radioPending,false);
});

test("manual navigation is neutral while recommendation Next creates only temporary exact-track fatigue",async()=>{
  const captureCode=source.slice(source.indexOf("  function captureListening("),source.indexOf("  function plannedNext("));
  for(const automatic of [false,true]){
    const p=player(async(_,args)=>({url:args.id}),[song(1),song(2)]);await p.playAt(0);
    Object.assign(p.ctx,{statsSession:null,statsSeconds:0,statsCounted:false,weekly:{record(){}}});
    p.ctx.captureListening=runInNewContext(`(()=>{${captureCode};return captureListening;})()`,p.ctx);
    p.ctx.playbackOrigin=automatic?"recommendation":"manual";p.ctx.clock.seconds=5;
    await p.advance(true);await settle();
    assert.equal(p.ctx.taste.entries[song(1).id].score,0);assert.equal(p.ctx.taste.entries[song(1).id].plays,0);
    assert.equal(p.ctx.recommendationSession.options().itemAdjustments.has(song(1).id),automatic);
  }
});

test("automatic queue eligibility applies new blocks without changing manually selected entries",async()=>{
  const p=player(async(_,args)=>({url:args.id}),[song(1),song(2),song(3)]);await p.playAt(0);
  p.ctx.automaticQueueIds.add(song(2).id);p.ctx.taste.hiddenSongs=[song(2).id,song(3).id];
  const before=Array.from(p.ctx.queue,item=>item.id);assert.equal(p.plannedNext(),2);
  await p.advance(false);await settle();assert.equal(p.ctx.current.id,song(3).id);
  assert.deepEqual(Array.from(p.ctx.queue,item=>item.id),before);
});

test("private boundary clears temporary context, fatigue and old playback provenance",()=>{
  const p=player(async()=>({url:"audio"}));const item=song(1);
  p.ctx.recommendationSession.setContext([item]);p.ctx.recommendationSession.markShown([item]);
  p.ctx.recommendationSession.fail(song(2).id);p.ctx.playbackContext=[item];p.ctx.playbackOrigin="recommendation";p.ctx.playbackSourceContext={kind:"playlist",id:"private"};
  p.ctx.discoveryCandidates=[item];p.ctx.recommendationReasons.set(item.id,{code:"discovery"});p.ctx.privateSession=false;p.clearRecommendationContext();
  assert.equal(p.ctx.recommendationSession.contextItems().length,0);assert.equal(p.ctx.recommendationSession.options().itemAdjustments.size,0);
  assert.equal(p.ctx.recommendationSession.allowed([song(2)]).length,1);assert.equal(p.ctx.playbackContext.length,0);
  assert.equal(p.ctx.playbackOrigin,"manual");assert.equal(p.ctx.playbackSourceContext.id,undefined);
  assert.equal(p.ctx.discoveryCandidates.length,0);assert.equal(p.ctx.recommendationReasons.size,0);
});

test("an empty or excluded prepared pool is not fully reranked on every media timeupdate",async()=>{
  const p=player(async(command,args)=>command==="music_stream"?{url:args.id}:{sections:[{items:[song(2)]}]});
  p.ctx.taste.hiddenSongs=[song(2).id];let rankings=0;p.ctx.rankMusicRecommendations=(...args)=>{rankings++;return rankMusicRecommendations(...args);};
  await p.playAt(0);p.ctx.audio.currentTime=150;p.emit("timeupdate");await settle();await settle();const before=rankings;
  assert.ok(before>0);for(let i=0;i<30;i++)p.emit("timeupdate");await settle();assert.equal(rankings,before);
  p.ctx.taste.hiddenSongs=[];await p.advance(false);await settle();assert.equal(p.ctx.current.id,song(2).id);
});

test("a chosen recording routes streaming, speculative loading and downloads through its source while the queue keeps logical songs",async()=>{
  for(const installed of [false,true]){
    const logical=[song(1),song(2)],sources=[song(101),song(102)],calls=[],warmed=[],downloaded=[];
    const p=player(async(command,args)=>{calls.push({command,...args});return command==="music_offline_source"?null:{url:`stream:${args.id}`};},logical);
    if(installed)p.ctx.window.__TAURI__={core:{convertFileSrc:path=>`file:${path}`}};
    p.ctx.saved.sourceBindings=logical.map((track,index)=>({trackId:track.id,track,source:sources[index]}));p.ctx.saved.favorites=[logical[0]];
    p.ctx.decks.warm=(id,url)=>warmed.push({id,url});p.ctx.onDownload=item=>{downloaded.push(item);return 1;};
    await p.playAt(0);p.ctx.audio.currentTime=150;p.emit("timeupdate");await settle();await settle();
    await p.downloadTrack(logical[0]);
    assert.deepEqual(calls.filter(call=>call.command==="music_stream").map(call=>[call.id,call.preload]),[[sources[0].id,false],[sources[1].id,true]],String(installed));
    assert.deepEqual(calls.filter(call=>call.command==="music_offline_source").map(call=>call.id),installed?sources.map(item=>item.id):[]);
    assert.deepEqual(warmed,[{id:logical[1].id,url:`stream:${sources[1].id}`}]);assert.equal(downloaded[0].id,sources[0].id);
    assert.equal(p.ctx.current.id,logical[0].id);assert.equal(p.ctx.current.title,logical[0].title);assert.equal(p.ctx.resolvedTrack,logical[0].id);
    assert.deepEqual(p.ctx.queue.map(item=>item.id),logical.map(item=>item.id));assert.equal(p.ctx.saved.favorites[0].id,logical[0].id);
  }
});

test("an offline source choice opens the selected local recording without resolving an online stream",async()=>{
  const logical=song(1),physical=song(101),calls=[],p=player(async(command,args)=>{calls.push({command,...args});if(command==="music_offline_source")return "D:/Music/selected.mp3";throw Error("offline playback must not request a stream");});
  p.ctx.window.__TAURI__={core:{convertFileSrc:path=>`asset:${path}`}};p.ctx.saved.sourceBindings=[{trackId:logical.id,track:logical,source:physical}];
  await p.playAt(0);
  assert.deepEqual(calls.map(call=>[call.command,call.id]),[["music_offline_source",physical.id]]);
  assert.equal(p.ctx.audio.src,"asset:D:/Music/selected.mp3");assert.equal(p.ctx.audio.paused,false);assert.equal(p.ctx.current.id,logical.id);
});

test("saving a new source discards an older speculative decoder and prepares the new choice without rewriting the manual queue",async()=>{
  const queued=[song(1),song(2)],oldSource=song(102),newSource=song(202),pending=deferred(),calls=[],warmed=[];
  const p=player(async(command,args)=>{calls.push({command,...args});return args.id===oldSource.id?pending.promise:{url:args.id};},queued);
  p.ctx.saved.sourceBindings=[{trackId:queued[1].id,track:queued[1],source:oldSource}];p.ctx.decks.warm=(id,url)=>warmed.push({id,url});
  await p.playAt(0);p.ctx.audio.currentTime=150;p.emit("timeupdate");await settle();
  p.chooseRecording(queued[1]);assert.equal(p.ctx.picker.save(newSource),true);assert.equal(p.ctx.sourceRevision,1);assert.equal(p.ctx.deckClears,1);
  pending.resolve({url:"stale-decoder"});await settle();await settle();assert.deepEqual(warmed,[]);
  p.emit("timeupdate");await settle();await settle();
  assert.deepEqual(warmed,[{id:queued[1].id,url:newSource.id}]);
  assert.deepEqual(calls.filter(call=>call.preload).map(call=>call.id),[oldSource.id,newSource.id]);
  assert.deepEqual(p.ctx.queue.map(item=>item.id),queued.map(item=>item.id));assert.equal(p.ctx.current.id,queued[0].id);
  assert.equal(p.ctx.saved.sourceBindings[0].track.id,queued[1].id);
});

test("changing the currently loading recording rejects the old source response and keeps its logical identity",async()=>{
  const logical=song(1),oldSource=song(101),newSource=song(201),pending=deferred(),calls=[];
  const p=player(async(command,args)=>{calls.push({command,...args});return args.id===oldSource.id?pending.promise:{url:args.id};});
  p.ctx.saved.sourceBindings=[{trackId:logical.id,track:logical,source:oldSource}];
  const first=p.playAt(0);await settle();p.chooseRecording(logical);assert.equal(p.ctx.picker.save(newSource),true);await settle();
  assert.equal(p.ctx.audio.src,newSource.id);pending.resolve({url:"stale-source"});await first;
  assert.equal(p.ctx.audio.src,newSource.id);assert.equal(p.ctx.current.id,logical.id);assert.equal(p.ctx.resolvedTrack,logical.id);
  assert.deepEqual(p.ctx.queue.map(item=>item.id),[logical.id]);assert.equal(p.ctx.cancellations,1);
});

test("the source picker never treats a chosen slowed recording's longer duration as original metadata",async()=>{
  const logical={...song(1),duration:200},slowed={...song(101),title:"Song 1 (Slowed)",duration:260},replacement={...song(201),duration:205};
  const p=player(async(_,args)=>({url:args.id}),[logical]);p.ctx.saved.sourceBindings=[{trackId:logical.id,track:logical,source:slowed}];
  await p.playAt(0);p.ctx.audio.duration=260;p.chooseRecording(logical);
  assert.equal(p.ctx.picker.item.duration,200);assert.equal(p.ctx.picker.save(replacement),true);await settle();
  assert.equal(p.ctx.saved.sourceBindings[0].track.duration,200);assert.equal(p.ctx.saved.sourceBindings[0].source.duration,205);assert.equal(logical.duration,200);
});

test("restoring a different source while extraction is pending rejects the old result without changing the manual queue",async()=>{
  const logical=song(1),oldSource=song(101),newSource=song(201),pending=deferred(),calls=[];
  const p=player(async(_,args)=>{calls.push(args.id);return args.id===oldSource.id?pending.promise:{url:args.id};},[logical,song(2)]);
  p.ctx.saved.sourceBindings=[{trackId:logical.id,track:logical,source:oldSource}];const first=p.playAt(0);await settle();
  p.restoreProfile({saved:{...p.ctx.saved,sourceBindings:[{trackId:logical.id,track:logical,source:newSource}]},taste:readTaste()});await settle();
  assert.equal(p.ctx.audio.src,newSource.id);assert.equal(p.ctx.audio.paused,false);pending.resolve({url:"stale-before-restore"});await first;
  assert.equal(p.ctx.audio.src,newSource.id);assert.equal(p.ctx.current.id,logical.id);assert.equal(p.ctx.resolvedTrack,logical.id);
  assert.deepEqual(p.ctx.queue.map(item=>item.id),[logical.id,song(2).id]);assert.deepEqual(calls,[oldSource.id,newSource.id]);
});

test("a restored source change invalidates paused audio without starting playback until the user presses Play",async()=>{
  const logical=song(1),oldSource=song(101),newSource=song(201),calls=[],p=player(async(_,args)=>{calls.push(args.id);return {url:args.id};});
  p.ctx.saved.sourceBindings=[{trackId:logical.id,track:logical,source:oldSource}];await p.playAt(0);p.ctx.audio.currentTime=75;p.ctx.audio.pause();
  p.restoreProfile({saved:{...p.ctx.saved,sourceBindings:[{trackId:logical.id,track:logical,source:newSource}]},taste:readTaste()});await settle();
  assert.deepEqual(calls,[oldSource.id]);assert.equal(p.ctx.audio.paused,true);assert.equal(p.ctx.audio.src,"");assert.equal(p.ctx.resolvedTrack,null);assert.equal(p.ctx.retryPosition,0);
  await p.togglePlay();assert.deepEqual(calls,[oldSource.id,newSource.id]);assert.equal(p.ctx.audio.src,newSource.id);assert.equal(p.ctx.audio.paused,false);assert.equal(p.ctx.current.id,logical.id);
});

test("automatic source aliases obey hidden, failed or repeatedly skipped recordings while explicit entries stay under manual control",async()=>{
  for(const restriction of ["hidden","failed","skipped"]){
    const p=player(async(_,args)=>({url:args.id}),[song(1),song(2),song(3)]),physical=song(102);
    p.ctx.saved.sourceBindings=[{trackId:song(2).id,track:song(2),source:physical}];await p.playAt(0);p.ctx.automaticQueueIds.add(song(2).id);
    if(restriction==="hidden")p.ctx.taste.hiddenSongs=[physical.id];
    else if(restriction==="failed")p.ctx.recommendationSession.fail(physical.id);
    else for(const session of [1,2])p.ctx.recommendationSession.recordSkip(physical,{seconds:5,duration:180,session,intent:"next"});
    const before=JSON.stringify(p.ctx.queue);assert.equal(p.plannedNext(),2,restriction);
    p.ctx.automaticQueueIds.delete(song(2).id);assert.equal(p.plannedNext(),1,restriction);assert.equal(JSON.stringify(p.ctx.queue),before);
  }
});

test("interest retrieval uses only selected playlist seeds within three stations and leaves a playing manual queue unchanged",async()=>{
  const jazz=[song(11),song(12),song(13),song(14)].map((item,index)=>({...item,artists:[`Jazz ${index}`]})),outside={...song(90),artists:["Phonk"]},calls=[];
  const p=player(async(command,args)=>{calls.push({command,...args});return command==="music_stream"?{url:args.id}:{sections:[{items:[{...song(100+Number(args.value)),artists:[`Related ${args.value}`]}]}]};},[outside,song(91)]);
  p.ctx.saved.favorites=[outside];p.ctx.saved.playlists=[{id:"jazz-list",name:"Jazz",items:jazz},{id:"outside",name:"Other",items:[outside]}];p.ctx.saved.interestMixes=[{id:"jazz",name:"Evening jazz",playlistIds:["jazz-list"]}];
  await p.playAt(0);const before=JSON.stringify(p.ctx.queue),playing=p.ctx.audio.src;await p.showInterestMix("jazz");
  const stations=calls.filter(call=>call.command==="music_catalog");assert.equal(stations.length,3);assert.ok(stations.every(call=>jazz.some(item=>item.id===call.value)));
  assert.equal(p.ctx.interestPool.id,"jazz");assert.ok(p.ctx.sections[0].items.length>0);assert.equal(p.ctx.playbackSourceContext.kind,"manual");
  assert.equal(JSON.stringify(p.ctx.queue),before);assert.equal(p.ctx.audio.src,playing);assert.equal(p.ctx.current.id,outside.id);
  p.playItems(p.ctx.sections[0].items,p.ctx.sections[0].items[0].id);await settle();assert.equal(p.ctx.playbackSourceContext.kind,"interest");assert.equal(p.ctx.playbackSourceContext.id,"jazz");
});

test("changing discovery direction reranks the raw pool for the currently selected interest without another catalog request",async()=>{
  const seed={...song(11),artists:["Jazz"]},familiar={...song(12),artists:["Jazz"]},novel={...song(13),artists:["Unheard"]},outside={...song(90),artists:["Phonk"]};let requests=0;
  const p=player(async()=>{requests++;return {sections:[{items:[familiar,novel,outside]}]};});
  p.ctx.saved.favorites=[outside];p.ctx.saved.playlists=[{id:"jazz-list",name:"Jazz",items:[seed]}];p.ctx.saved.interestMixes=[{id:"jazz",name:"Jazz",playlistIds:["jazz-list"]}];p.ctx.taste.mode="familiar";
  recordListening(p.ctx.taste,seed,{seconds:40,duration:200,session:1},Date.now()-60000);
  await p.showInterestMix("jazz");const raw=p.ctx.interestPool,first=p.ctx.sections[0].items.map(item=>item.id),queried=requests;
  assert.equal(first[0],familiar.id);assert.ok(!first.includes(seed.id),"the source song's qualified cooldown still applies");p.ctx.taste.mode="discovery";p.renderInterestPool();
  const fresh=p.ctx.sections[0].items.map(item=>item.id);
  assert.equal(requests,queried);assert.equal(p.ctx.interestPool,raw);assert.equal(fresh[0],novel.id);assert.ok(fresh.indexOf(novel.id)<fresh.indexOf(familiar.id));
  p.ctx.taste.hiddenSongs=[novel.id];p.renderInterestPool();assert.ok(!p.ctx.sections[0].items.some(item=>item.id===novel.id));assert.equal(requests,queried);
});

test("a slower interest request cannot replace a newer selected interest",async()=>{
  const jazz=deferred(),rock=deferred(),p=player(async(_,args)=>args.value===song(11).id?jazz.promise:rock.promise);
  p.ctx.saved.playlists=[{id:"jazz-list",name:"Jazz",items:[song(11)]},{id:"rock-list",name:"Rock",items:[song(22)]}];
  p.ctx.saved.interestMixes=[{id:"jazz",name:"Jazz",playlistIds:["jazz-list"]},{id:"rock",name:"Rock",playlistIds:["rock-list"]}];
  const old=p.showInterestMix("jazz"),fresh=p.showInterestMix("rock");rock.resolve({sections:[{items:[song(23)]}]});await fresh;
  const shown=JSON.stringify(p.ctx.sections);jazz.resolve({sections:[{items:[song(12)]}]});await old;
  assert.equal(p.ctx.interestViewId,"rock");assert.equal(p.ctx.interestPool.id,"rock");assert.equal(JSON.stringify(p.ctx.sections),shown);
});

test("resuming an interest keeps its source context separate from unrelated manually queued songs",async()=>{
  const seed={...song(11),artists:["Jazz"]},unrelated={...song(90),artists:["Phonk"]},p=player(async(_,args)=>({url:args.id}));
  p.ctx.saved.playlists=[{id:"jazz-list",name:"Jazz",items:[seed]}];p.ctx.saved.interestMixes=[{id:"jazz",name:"Jazz",playlistIds:["jazz-list"]}];
  p.playItems([seed,unrelated],seed.id,{kind:"interest",id:"jazz"},[seed]);await settle();
  p.ctx.audio.currentTime=42;
  const snapshot=p.ctx.resumeSnapshot={item:p.ctx.current,queue:[...p.ctx.queue],position:42,sourceContext:{...p.ctx.playbackSourceContext},contextItems:p.ctx.recommendationSession.contextItems()};
  p.playItems([song(99)],song(99).id);await settle();await p.resumeListening(snapshot);
  assert.equal(p.ctx.current.id,seed.id);assert.equal(p.ctx.audio.currentTime,42);assert.equal(p.ctx.playbackSourceContext.kind,"interest");assert.equal(p.ctx.playbackSourceContext.id,"jazz");
  assert.deepEqual(Array.from(p.ctx.recommendationSession.contextItems(),item=>item.id),[seed.id]);assert.deepEqual(Array.from(p.ctx.queue,item=>item.id),[seed.id,unrelated.id]);
});

test("a deleted interest or cleared privacy context cannot be resurrected by an old resume card",async()=>{
  for(const reset of ["deleted","private-boundary"]){
    const seed=song(11),p=player(async(_,args)=>({url:args.id})),snapshot=p.ctx.resumeSnapshot={item:seed,queue:[seed,song(90)],position:25,sourceContext:{kind:"interest",id:"jazz"},contextItems:[seed]};
    p.ctx.saved.interestMixes=[{id:"jazz",name:"Jazz",playlistIds:[]}];await p.playAt(0);
    if(reset==="deleted")p.ctx.saved.interestMixes=[];else{p.clearRecommendationContext();assert.equal(snapshot.sourceContext,undefined);assert.equal(snapshot.contextItems,undefined);}
    await p.resumeListening(snapshot);assert.equal(p.ctx.current.id,seed.id);assert.equal(p.ctx.playbackSourceContext.kind,"resume",reset);assert.equal(p.ctx.playbackSourceContext.id,"");
  }
});
