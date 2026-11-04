import {isLocalMusicId} from '../src/music-track-id.js';
import {localPlaybackSource,getExactLocalCopy,setExactLocalCopy,exactLocalPlaybackSource} from '../src/music-local-model.js';
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {tracks,remember,nextIndex,playbackQueue} from "../src/music-state.js";
import {readTaste,recordListening,recommend,tasteSeeds,listeningClock,tasteArtistKeys,canonicalArtistKey} from "../src/music-taste.js";
import {mergeRecommendationPools} from "../src/music-recommendation-view.js";
import {createRecommendationSession} from "../src/music-recommendation-session.js";
import {rankMusicRecommendations,recommendationFamiliarity} from "../src/music-recommendation-engine.js";
import {createRecordingView} from "../src/music-recording-view.js";
import {resolveRecordingSource,setRecordingSource,removeRecordingSource,recordingFamilyIds,recordingMatch,singleCatalogMatch} from "../src/music-recordings.js";
import {rememberInterestTrack,interestProfile,interestSources,interestSeeds} from "../src/music-interest-mixes.js";
import {sanitizeMusicTrack,saveMusicProfile} from "../src/music-profile.js";
import {musicGain} from "../src/music-volume.js";
import {createPlaybackOrder} from "../src/music-session.js";
import {playbackCandidates as eligiblePlaybackCandidates} from "../src/music-playback-candidates.js";
import {createMusicDiagnostics,playbackFailure} from "../src/music-diagnostics.js";
import {bufferedSeconds,canPrepareAudio} from "../src/music-playback-health.js";
import ru from "../src/locales/ru.js";
import es from "../src/locales/es.js";

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
  const field=()=>({textContent:"",disabled:false,value:"",replaceChildren(){},setAttribute(){}});
  const audio={playbackRate:1,currentTime:0,duration:180,paused:true,ended:false,readyState:4,seeking:false,volume:.7,muted:false,src:"",playError:null,hang:false,
    addEventListener:(name,callback)=>{events[name]=callback;},
    async play(){if(this.playError)throw this.playError;if(this.hang)return new Promise(()=>{});this.paused=false;this.ended=false;events.play?.();events.playing?.();},
    pause(){if(!this.paused){this.paused=true;events.pause?.();}},
    removeAttribute(){this.src="";},load(){this.currentTime=0;this.ended=false;}};
  Object.defineProperty(audio,"src",{get(){return this.address||"";},set(value){this.address=value;if(value)queueMicrotask(()=>events.loadedmetadata?.());}});
  Object.defineProperty(audio,"currentSrc",{get(){return this.selectedUrl??this.src;},set(value){this.selectedUrl=value;}});
  audio.buffered={length:1,start:()=>0,end:()=>audio.duration};
  const ctx={isLocalMusicId,localPlaybackSource,getExactLocalCopy,setExactLocalCopy,exactLocalPlaybackSource,recordingMatch,singleCatalogMatch,findLocalRecording:async()=>null,recoveryLocal:null,recoveryCatalog:null,pendingLocalCancel:null,alternateTried:false,localItems:[],eligiblePlaybackCandidates,musicRoom:null,audio,queue:items,index:-1,current:null,resolvedTrack:null,resolvedOffline:false,autoplay:true,radioPending:false,streamLoading:false,playRequest:0,
    needsRefresh:false,privateSession:false,resumeSnapshot:null,discordPresence:{sync(){}},diagnostics:createMusicDiagnostics(),playbackFailure,
    listen:audio.addEventListener,decks:{take:()=>null,stopTail(){},warm(){},clear(){ctx.deckClears=(ctx.deckClears||0)+1;},setVolume(){},ready:()=>false,owns:node=>node===audio},sound:{resume(){},setSource(node,offline){ctx.lastSoundSource={node,offline};},transition:0},lyrics:{update(){}},window:{},
    bufferedSeconds,canPrepareAudio,nextPlan:null,preloadPending:false,preloadAttempts:new Map(),preloadWindow:[],radioAhead:null,time:String,recordingRoutingRevision:-1,recordingBoundIds:new Set(),recordingFamilies:new Map(),
    order:createPlaybackOrder(),knownDuration:0,endSource:null,sessionTransition:false,sessionSavedAt:Date.now(),intent:{leave(){}},radioCache:new Map(),repeat:"off",shuffle:false,session:0,checkpoint:0,historyAdded:false,recoveryUsed:false,pendingSeek:0,retryPosition:0,bufferingTimer:null,
    saved:{favorites:[],recent:[],collections:[],playlists:[],sourceBindings:[],interestMixes:[]},playbackContext:[],playbackOrigin:"manual",contextRevision:0,sourceRevision:0,interestPool:null,interestViewId:null,interestRotations:new Map(),personalization:0,recommendationRevision:0,playbackSourceContext:{kind:"restored"},recommendationSession:createRecommendationSession(),automaticQueueIds:new Set(),impressionTimers:new Map(),refreshRecommendationImpressions(){},clearRecommendationObservations(){},discoveryCandidates:[],recommendationReasons:new Map(),
    view:"home",lastQuery:{kind:"home"},activeMood:"",playlistId:null,browseItem:null,getPlaylist:()=>null,
    taste:readTaste(),clock:{seconds:0,reset(){this.seconds=0;},sample() {return this.seconds;}},
    changeSource:{hidden:true},nextHomeCandidates:[],title:field(),artist:field(),artwork:field(),updateDockArt(){},seek:field(),isRangeDragging:()=>false,elapsed:field(),duration:field(),previous:{click(){}},
    invoke:(command,args)=>{if(command==="music_cancel_stream"){ctx.cancellations=(ctx.cancellations||0)+1;ctx.lastCancellation=args;return Promise.resolve();}return invoke(command,args);},tracks,remember,nextIndex,recommend,recordListening,tasteSeeds,tasteArtistKeys,canonicalArtistKey,mergeRecommendationPools,rankMusicRecommendations,recommendationFamiliarity,createRecordingView,resolveRecordingSource,setRecordingSource,removeRecordingSource,recordingFamilyIds,sanitizeMusicTrack,saveMusicProfile,rememberInterestTrack,interestProfile,interestSources,interestSeeds,cover:()=>null,displaySubtitle:item=>item?.artists?.join(", ")||"Unknown artist",language:()=>"en",t:s=>s,errorText:String,
    storage:{getItem:key=>memory.get(key),setItem:(key,value)=>memory.set(key,value)},playbackQueue,button(){},openRecordingPicker:options=>{ctx.picker=options;},downloadsPending:new Set(),presentation:{notify(){}},onDownload:null,homeCache:null,
    wireMusicProfile:options=>{ctx.profileActions=options;},library:{invalidateUndo(){},find(){}},musicGain,previousVolume:.7,syncVolume(){},showLocal(){},load(){},
    request:0,loading:false,loaded:false,sections:[],continuation:null,morePending:false,listFilter:"",listSort:"original",rememberNavigation(){},selectView:next=>{ctx.view=next;},skeleton(){},render(){ctx.rendered=ctx.sections;},prepareHomeSelection(){},showPlaylist(){},
    $:id=>{if(!controls.has(id))controls.set(id,field());return controls.get(id);},
    captureListening(){},persist(){},persistSession(){},syncDock(){},renderQueue(){},status(message){ctx.message=message;},
    document:{querySelectorAll:()=>[],addEventListener(){}},navigator:{},performance,DOMException,
    setTimeout(fn){const id=++serial;timers.set(id,fn);return id;},clearTimeout(id){timers.delete(id);}};
  Object.assign(ctx,{publicDiscovery:{candidates:async()=>[],clear(){}},publicGeneration:0});
  const actions=runInNewContext(`(()=>{${code}\nreturn {playAt,playItems,togglePlay,yieldToOtherMedia,resumeListening,advance,preloadNext,clearRecommendationContext,plannedNext,rankRadioPool,radioCandidates,playbackSource,invalidateRecommendations,chooseRecording,refreshCurrentRecording,restoreProfile:profileActions.restore,downloadTrack,showInterestMix,renderInterestPool};})()`,ctx);
  return {ctx,...actions,emit:(name,event)=>events[name]?.(event),expire(){const pending=[...timers.values()];timers.clear();pending.forEach(fn=>fn());}};
}
test('indexed local playback, seek recovery and autoplay never resolve an online source',async()=>{
 const local={...song(1),id:'local:'+'a'.repeat(64)},calls=[];
 const p=player(async(command,args)=>{calls.push([command,args]);if(command==='music_offline_source')return 'D:/test.flac';throw Error('Unexpected network command '+command);},[local]);
 p.ctx.window={__TAURI__:{core:{convertFileSrc:path=>'asset:'+path}}};
 await p.playAt(0,{resume:42});assert.equal(p.ctx.audio.paused,false);assert.equal(p.ctx.audio.currentTime,42);assert.equal(p.ctx.lastSoundSource.offline,true);
 p.ctx.audio.playError={code:3,message:'decode'};p.ctx.audio.pause();await p.togglePlay();await settle();
 assert(calls.every(([command])=>command==='music_offline_source'));
 assert.equal((await p.radioCandidates(local)).length,0);
});

test('For you selections and their following tracks retain recommendation provenance',async()=>{
 const p=player(async()=>({url:'audio'})),items=[song(1),song(2),song(3)];
 p.playItems(items,items[0].id,{kind:'personal'});await settle();
 assert.equal(p.ctx.playbackOrigin,'recommendation');assert.equal(p.ctx.automaticQueueIds.size,3);
 await p.advance(true);assert.equal(p.ctx.current.id,items[1].id);assert.equal(p.ctx.playbackOrigin,'recommendation');
 p.playItems(items,items[0].id,{kind:'playlist'});await settle();
 assert.equal(p.ctx.playbackOrigin,'manual');assert.equal(p.ctx.automaticQueueIds.size,0);
});

test('retrying a recommended track at zero preserves its recommendation origin',async()=>{
 const p=player(async()=>({url:'audio'}));p.ctx.audio.playError=Error('temporary');
 await p.playAt(0,{origin:'recommendation'});assert.equal(p.ctx.resolvedTrack,null);
 p.ctx.audio.playError=null;await p.togglePlay();assert.equal(p.ctx.playbackOrigin,'recommendation');assert.equal(p.ctx.audio.paused,false);
});
test('autoplay continuation never truncates a manually selected large library',async()=>{
 const items=Array.from({length:1420},(_,n)=>song(n)),extra=song(2000);
 const p=player(async(command)=>command==='music_catalog'?{sections:[{items:[extra]}]}:{url:'audio'},items);
 await p.playAt(items.length-1);await p.advance(false);await settle();
 assert.equal(p.ctx.current.id,extra.id);assert.equal(p.ctx.queue.length,1421);assert.equal(p.ctx.queue[0].id,items[0].id);
});

test("room guests cannot replace the host track and exact room playback ignores local version bindings",async()=>{
 const calls=[],p=player(async(_command,args)=>{calls.push(args.id);return{url:args.id};});p.ctx.musicRoom={isGuest:()=>true};
 p.ctx.saved.sourceBindings=[{trackId:song(1).id,source:song(2)}];
 await p.playAt(0);p.playItems([song(3)],song(3).id);assert.equal(calls.length,0);assert.equal(p.ctx.queue[0].id,song(1).id);
 await p.playAt(0,{origin:'room',autoplay:false});assert.deepEqual(calls,[song(1).id]);assert.equal(p.ctx.audio.paused,true);
 await p.togglePlay();await p.advance(true);assert.equal(p.ctx.audio.paused,true);assert.equal(calls.length,1);
});
test("source restrictions explain the failure without starting audio or scheduling retries",async()=>{
  let calls=0;const failure="Playback restricted: YouTube requires sign-in or verification. Try another track.";
  const p=player(async()=>{calls++;throw failure;});
  await p.playAt(0);p.expire();await settle();
  assert.equal(calls,1);assert.equal(p.ctx.audio.paused,true);assert.equal(p.ctx.streamLoading,false);
  assert.equal(p.ctx.artist.textContent,failure);assert.equal(p.ctx.message,failure);assert.equal(p.ctx.changeSource.hidden,false);
});

test("timeupdate leaves seek painting to the shared frame clock, including during a drag",async()=>{
 const p=player(async()=>({url:"audio"}));await p.playAt(0);
 p.ctx.audio.duration=100;p.ctx.audio.currentTime=20;p.ctx.seek.value='750';p.ctx.isRangeDragging=()=>true;
 p.emit('timeupdate');assert.equal(p.ctx.seek.value,'750');
 p.ctx.isRangeDragging=()=>false;p.emit('timeupdate');assert.equal(p.ctx.seek.value,'750');
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
test("a shortened decoder duration cannot finish the queue or spend more than one recovery",async()=>{
  const calls=[],p=player(async(_,args)=>{calls.push(args);return {url:"stream:"+calls.length};},[song(1),song(2)]);
  await p.playAt(0);
  const a=p.ctx.audio;
  a.duration=65;a.currentTime=64.6;a.ended=true;p.emit("durationchange");p.emit("ended");await settle();
  assert.equal(calls.length,2);assert.equal(calls[1].refresh,true);assert.equal(p.ctx.current.id,song(1).id);
  assert.ok(a.currentTime>=64&&a.currentTime<=64.6);
  a.currentTime=65;a.ended=true;p.emit("ended");await settle();
  assert.equal(calls.length,2);assert.equal(p.ctx.resolvedTrack,null);assert.equal(p.ctx.retryPosition,65);
  assert.equal(p.ctx.current.id,song(1).id);assert.equal(p.ctx.changeSource.hidden,false);
});
test("an old ended notification cannot advance the new source on a reused deck",async()=>{
  const p=player(async(_,args)=>({url:args.id}),[song(1),song(2),song(3)]);
  await p.playAt(0);await p.playAt(1);
  p.emit("ended");await settle();assert.equal(p.ctx.index,1);
  const a=p.ctx.audio;a.ended=true;a.currentTime=a.duration;
  p.emit("ended",{timeStamp:p.ctx.endSource.since-1});await settle();assert.equal(p.ctx.index,1);
  a.currentSrc=song(1).id;p.emit("ended");await settle();assert.equal(p.ctx.index,1);
  a.currentSrc=song(2).id;p.emit("ended");await settle();assert.equal(p.ctx.index,2);
});
test("seeking to the genuine end advances even if the catalog gives a longer duration",async()=>{
  const p=player(async(_,args)=>({url:args.id}),[{...song(1),duration:300},song(2)]);
  p.ctx.audio.duration=80;await p.playAt(0);p.ctx.audio.currentTime=80;p.ctx.audio.ended=true;
  p.emit("ended");await settle();assert.equal(p.ctx.index,1);assert.equal(p.ctx.recoveryUsed,false);
});
test("a transport denial attached to ended never retries or silently advances",async()=>{
  const calls=[],p=player(async(_,args)=>{calls.push(args);return {url:args.id};},[song(1),song(2)]);
  await p.playAt(0);const a=p.ctx.audio;a.currentTime=a.duration;a.ended=true;a.error={code:2,message:"403 Forbidden"};
  p.emit("ended");await settle();
  assert.equal(calls.length,1);assert.equal(p.ctx.resolvedTrack,null);assert.equal(p.ctx.index,0);
  assert.match(p.ctx.message,/denied access/);
});
test("crossfade does not advance at a shortened prefix even with the next deck ready",async()=>{
  const p=player(async(_,args)=>({url:args.id}),[song(1),song(2)]);
  await p.playAt(0);p.ctx.sound.transition=4;p.ctx.decks.ready=()=>true;
  p.ctx.audio.duration=65;p.ctx.audio.currentTime=63;p.emit("durationchange");p.emit("timeupdate");await settle();
  assert.equal(p.ctx.index,0);
  p.ctx.audio.duration=180;p.ctx.audio.currentTime=178;p.emit("durationchange");p.emit("timeupdate");await settle();
  assert.equal(p.ctx.index,1);
});
test("premature EOF in a local file does not try the network",async()=>{
  const local={...song(1),id:"local:"+"a".repeat(64)},calls=[];
  const p=player(async(command)=>{calls.push(command);return "D:/local.wav";},[local,song(2)]);
  p.ctx.window={__TAURI__:{core:{convertFileSrc:path=>"asset:"+path}}};
  await p.playAt(0);p.ctx.audio.currentTime=65;p.ctx.audio.ended=true;p.emit("ended");await settle();
  assert.deepEqual(calls,["music_offline_source"]);assert.equal(p.ctx.index,0);assert.equal(p.ctx.resolvedTrack,null);
});
test("a transient resolver error at zero retries the primary path before changing the source",async()=>{
  const calls=[],p=player(async(_,args)=>{calls.push(args);if(calls.length===1)throw Error("Network unavailable");return {url:"recovered"};});
  await p.playAt(0);
  assert.deepEqual(calls.map(call=>call.refresh),[false,false]);
  assert.equal(p.ctx.audio.paused,false);
});
test("a second decoder failure resumes one equivalent catalog song at the latest position without rebinding the logical song",async()=>{
  const original={...song(1),duration:180},alternate={...original,id:song(3).id},calls=[];
  const p=player(async(cmd,args)=>{
    calls.push([cmd,args]);
    if(cmd==="music_recovery_allowed")return true;
    if(cmd==="music_catalog")return {sections:[{items:[original,alternate]}]};
    return {url:args.id+"-"+calls.length};
  },[original,song(2)]);
  p.ctx.saved.favorites=[original];
  await p.playAt(0);const a=p.ctx.audio;
  assert.deepEqual(calls.map(([c])=>c),["music_stream"]);
  a.currentTime=31;a.error={code:2};p.emit("error");await settle();
  assert.deepEqual({...calls[1][1]},{id:original.id,refresh:true,preload:false,automatic:true,originalId:original.id,recoverFromCache:true});
  a.currentTime=47.125;p.emit("error");await settle();
  assert.deepEqual(calls.map(([cmd])=>cmd),["music_stream","music_stream","music_recovery_allowed","music_catalog","music_stream"]);
  assert.equal(calls[3][1].originalId,original.id);assert.equal(calls[4][1].id,alternate.id);
  assert.equal(calls[4][1].originalId,original.id);assert.equal(calls[4][1].automatic,true);
  assert.equal(a.currentTime,47.125);assert.equal(a.paused,false);assert.equal(p.ctx.current.id,original.id);
  assert.deepEqual(p.ctx.queue.map(item=>item.id),[original.id,song(2).id]);assert.deepEqual(p.ctx.saved.sourceBindings,[]);
  assert.deepEqual(p.ctx.saved.favorites,[original]);assert.equal(p.ctx.saved.recent[0].id,original.id);
  a.currentTime=54;p.emit("error");await settle();
  assert.equal(calls.length,5);assert.equal(p.ctx.resolvedTrack,null);assert.equal(p.ctx.retryPosition,54);
});
test("a verified local file resumes while the same-ID retry is still pending and its late remote result cannot start another decoder",async()=>{
  const track={...song(1),duration:180},remote=deferred(),local=deferred(),calls=[];
  const p=player(async(cmd,args)=>{calls.push([cmd,args]);return args.automatic?remote.promise:{url:"primary"};},[track,song(2)]);
  let scans=0,starts=0;
  p.ctx.findLocalRecording=()=>{scans++;return local.promise;};
  const play=p.ctx.audio.play.bind(p.ctx.audio);p.ctx.audio.play=()=>{starts++;return play();};
  await p.playAt(0);assert.equal(scans,0);
  const a=p.ctx.audio;a.currentTime=37.125;a.error={code:2};p.emit("error");await settle();
  assert.equal(scans,1);assert.equal(calls.at(-1)[1].automatic,true);assert.equal(a.paused,true);
  local.resolve({url:"verified-file",offline:true});await settle();
  assert.equal(a.src,"verified-file");assert.equal(a.currentTime,37.125);assert.equal(a.paused,false);assert.equal(p.ctx.cancellations,1);
  remote.resolve({url:"late-remote"});await settle();
  assert.equal(a.src,"verified-file");assert.equal(starts,2);assert.equal(p.ctx.current.id,track.id);
  assert.equal(calls.filter(([cmd])=>cmd==="music_catalog").length,0);
});
test("only a progressed automatic B gets one guarded same-B retry at its real playhead",async()=>{
  const original={...song(1),duration:180},alt={...original,id:song(3).id},anchor=5.75;
  for(const mode of ["short","eight","long","gap","seek","early-end","decode","limited","guard-denied","retry-denied","stall","pause-during-guard"]){
    const calls=[],guard=deferred(),p=player(async(cmd,args)=>{
      calls.push([cmd,args]);
      if(cmd==="music_recovery_allowed")return args.originalId?(mode==="pause-during-guard"?guard.promise:mode!=="guard-denied"):true;
      if(cmd==="music_catalog")return {sections:[{items:[alt]}]};
      if(args.id===original.id)throw Error("Network unavailable");
      if(args.retryAlternate&&mode==="retry-denied")throw Error("HTTP 429");
      return {url:args.retryAlternate?"B-refreshed":"B"};
    },[original,song(2)]);
    await p.playAt(0,{resume:anchor});
    const a=p.ctx.audio;assert.equal(a.src,"B");
    p.emit("seeking");p.emit("seeked"); // The startup seek to the saved position is expected.
    const at=anchor+(mode==="short"?7.99:mode==="eight"?8:36.319);
    a.currentTime=at;a.played={length:1,start:()=>mode==="gap"?anchor+2:anchor,end:()=>at};
    if(mode==="seek"){p.emit("seeking");p.emit("seeked");}
    if(mode==="early-end"){a.ended=true;p.emit("ended");}
    else if(mode==="stall"){a.readyState=2;p.emit("waiting");p.expire();}
    else{a.error={code:mode==="decode"?3:2,message:mode==="limited"?"HTTP 429":""};p.emit("error");}
    await settle();
    const sufficient=["eight","long","guard-denied","retry-denied","stall","pause-during-guard"].includes(mode);
    assert.equal(calls.filter(([cmd,args])=>cmd==="music_recovery_allowed"&&args.id===alt.id&&args.originalId===original.id).length,sufficient?1:0,mode);
    if(mode==="pause-during-guard"){await p.togglePlay();guard.resolve(true);await settle();}
    const retry=calls.filter(([cmd,args])=>cmd==="music_stream"&&args.retryAlternate);
    const sent=sufficient&&!["guard-denied","pause-during-guard"].includes(mode);
    assert.equal(retry.length,sent?1:0,mode);
    if(sent)assert.deepEqual({...retry[0][1]},{id:alt.id,originalId:original.id,automatic:true,refresh:true,preload:false,retryAlternate:true,recoverFromCache:true});
    if(sent&&mode!=="retry-denied"){
      assert.equal(a.currentTime,at);assert.equal(a.paused,false);assert.equal(p.ctx.endSource.duration,180);
      a.currentTime=at+12;a.played={length:1,start:()=>at,end:()=>at+12};a.error={code:2};p.emit("error");await settle();
      assert.equal(calls.filter(([cmd,args])=>cmd==="music_stream"&&args.retryAlternate).length,1);assert.equal(a.paused,true);
    }
    assert.equal(p.ctx.current.id,original.id);assert.deepEqual(p.ctx.queue.map(x=>x.id),[original.id,song(2).id]);
    assert.equal(calls.filter(([cmd])=>cmd==="music_catalog").length,1);assert.deepEqual(p.ctx.saved.sourceBindings,[]);
  }
});
test("a draining existing range prewarms one local check before any fault, and no other audio or catalog is requested",async()=>{
  const track={...song(1),duration:180},calls=[],local=deferred(),retry=deferred();
  const p=player(async(cmd,args)=>{calls.push(cmd);return args.automatic?retry.promise:{url:"initial"};},[track]);
  p.ctx.autoplay=false;p.ctx.performance={now:()=>p.ctx.audio.currentTime*1000};
  let scans=0;p.ctx.findLocalRecording=()=>{scans++;return local.promise;};
  await p.playAt(0);const a=p.ctx.audio;a.buffered={length:1,start:()=>0,end:()=>13};
  for(const pos of [4,7,8,9,10]){a.currentTime=pos;p.emit("timeupdate");}
  assert.equal(scans,0);
  for(const pos of [10.75,12.5,12.75]){a.currentTime=pos;p.emit("timeupdate");}
  assert.equal(scans,1);assert.equal(a.src,"initial");assert.deepEqual(calls,["music_stream"]);
  a.error={code:2};p.emit("error");await settle();assert.equal(scans,1);
  local.resolve({url:"prewarmed",offline:true});await settle();
  assert.equal(a.currentTime,12.75);assert.equal(a.src,"prewarmed");assert.equal(a.paused,false);
  retry.resolve({url:"too-late"});await settle();assert.deepEqual(calls,["music_stream","music_stream"]);
});
test("healthy/growing buffers, startup, seek, paused, data saver and a genuine end never prewarm a local recording",async()=>{
  const track={...song(1),duration:180};
  for(const scenario of ["growing","startup","seek","paused","save-data","end","too-soon"]){
    const p=player(async()=>({url:"initial"}),[track]);let scans=0;p.ctx.findLocalRecording=async()=>{scans++;return null;};
    p.ctx.autoplay=false;p.ctx.performance={now:()=>scenario==="too-soon"?1200:p.ctx.audio.currentTime*1000};
    await p.playAt(0);const a=p.ctx.audio;let edge=scenario==="end"?180:13;a.buffered={length:1,start:()=>0,end:()=>edge};
    a.currentTime=scenario==="end"?167:7;p.emit("timeupdate");
    if(scenario==="seek")p.emit("seeking");
    if(scenario==="paused")a.pause();
    if(scenario==="save-data")p.ctx.navigator.connection={saveData:true};
    if(scenario==="growing")edge=21;
    if(scenario==="startup"){a.currentTime=1;edge=1.6;}
    else a.currentTime=scenario==="end"?179.25:12.5;
    p.emit("timeupdate");assert.equal(scans,0,scenario);
  }
});
test("low runway prepares guarded metadata once before the fault, transfers the in-flight query through retry A, and rechecks protection before B",async()=>{
  for(const lastPermission of [true,false]){
    const track={...song(1),duration:180},alt={...track,id:song(3).id},catalog=deferred(),retry=deferred(),calls=[];let permissions=0;
    const p=player(async(cmd,args)=>{
      calls.push([cmd,args]);
      if(cmd==="music_recovery_allowed")return ++permissions===1||lastPermission;
      if(cmd==="music_catalog")return catalog.promise;
      if(args.id===alt.id)return {url:"B"};
      return args.automatic?retry.promise:{url:"A"};
    },[track]);
    p.ctx.autoplay=false;p.ctx.performance={now:()=>p.ctx.audio.currentTime*1000};
    await p.playAt(0);const a=p.ctx.audio;a.buffered={length:1,start:()=>0,end:()=>20};
    for(const pos of [8,13,14.75,17.75,18]){a.currentTime=pos;p.emit("timeupdate");}
    await settle();assert.deepEqual(calls.map(([cmd])=>cmd),["music_stream","music_recovery_allowed","music_catalog"]);
    assert.equal(a.src,"A");assert.equal(a.paused,false);
    a.error={code:2};p.emit("error");await settle();assert.equal(calls.filter(([cmd])=>cmd==="music_catalog").length,1);
    catalog.resolve({sections:[{items:[alt]}]});await settle();assert.ok(!calls.some(([cmd,args])=>cmd==="music_stream"&&args.id===alt.id));
    retry.reject(Error("Network unavailable"));await settle();
    assert.equal(permissions,2);assert.equal(calls.filter(([cmd])=>cmd==="music_catalog").length,1);
    assert.equal(calls.some(([cmd,args])=>cmd==="music_stream"&&args.id===alt.id),lastPermission);
    if(lastPermission){assert.equal(a.src,"B");assert.equal(a.currentTime,18);assert.equal(a.paused,false);}
  }
});
test("runway metadata waits for permission and is discarded on recovered buffering, skip, user pause or a terminal retry",async()=>{
  for(const action of ["filled","skip","pause","terminal"]){
    const track={...song(1),duration:180},alt={...track,id:song(3).id},permission=deferred(),calls=[];
    const p=player(async(cmd,args)=>{
      calls.push([cmd,args]);
      if(cmd==="music_recovery_allowed")return permission.promise;
      if(cmd==="music_catalog")return {sections:[{items:[alt]}]};
      if(args.automatic)throw Error("HTTP 429");
      return {url:args.id};
    },[track,song(2)]);
    p.ctx.autoplay=false;p.ctx.performance={now:()=>p.ctx.audio.currentTime*1000};
    await p.playAt(0);const a=p.ctx.audio;let edge=20;a.buffered={length:1,start:()=>0,end:()=>edge};
    for(const pos of [8,14.75,17.75]){a.currentTime=pos;p.emit("timeupdate");}
    await settle();assert.equal(calls.at(-1)[0],"music_recovery_allowed");
    if(action==="filled")edge=45;else if(action==="skip")await p.playAt(1);else if(action==="pause")await p.togglePlay();
    else{a.error={code:2};p.emit("error");await settle();}
    permission.resolve(true);await settle();
    assert.ok(!calls.some(([cmd])=>cmd==="music_catalog"),action);
    assert.ok(!calls.some(([cmd,args])=>cmd==="music_stream"&&args.id===alt.id),action);
  }
});
test("guarded metadata may finish before the same-ID retry, but B opens only after a transient failure",async()=>{
  const track={...song(1),duration:180},alt={...track,id:song(3).id};
  for(const outcome of ["network","success","restricted","limited","save-data"]){
    const retry=deferred(),calls=[];
    const p=player(async(cmd,args)=>{
      calls.push([cmd,args]);
      if(cmd==="music_recovery_allowed")return true;
      if(cmd==="music_catalog")return {sections:[{items:[alt]}]};
      if(args.id===alt.id)return {url:"B"};
      return args.automatic?retry.promise:{url:"initial"};
    },[track]);
    await p.playAt(0);const a=p.ctx.audio;a.currentTime=42.25;
    if(outcome==="save-data")p.ctx.navigator.connection={saveData:true};
    a.error={code:2};p.emit("error");await settle();
    const searched=()=>calls.filter(([cmd])=>cmd==="music_catalog").length;
    const openedB=()=>calls.filter(([cmd,args])=>cmd==="music_stream"&&args.id===alt.id).length;
    assert.equal(searched(),outcome==="save-data"?0:1,outcome);
    assert.equal(openedB(),0);
    if(outcome==="success"||outcome==="save-data")retry.resolve({url:"healthy-A"});
    else retry.reject(Error(outcome==="restricted"?"HTTP 403":outcome==="limited"?"HTTP 429":"Network unavailable"));
    await settle();
    assert.equal(openedB(),outcome==="network"?1:0,outcome);
    assert.equal(searched(),outcome==="save-data"?0:1);
    if(outcome==="network"){assert.equal(a.src,"B");assert.equal(a.currentTime,42.25);}
  }
});
test("late permission cannot dispatch speculative metadata after pause, skip, a recovered retry, denial or a restriction",async()=>{
  const track={...song(1),duration:180};
  for(const action of ["pause","skip","success","deny","restricted"]){
    const permission=deferred(),retry=deferred(),calls=[];
    const p=player(async(cmd,args)=>{
      calls.push(cmd);if(cmd==="music_recovery_allowed")return permission.promise;
      if(cmd==="music_catalog")throw Error("Unexpected catalog");
      return args.automatic?retry.promise:{url:args.id};
    },[track,song(2)]);
    await p.playAt(0);p.ctx.audio.currentTime=31;p.ctx.audio.error={code:2};p.emit("error");await settle();
    assert.equal(calls.at(-1),"music_recovery_allowed");
    if(action==="pause")await p.togglePlay();else if(action==="skip")await p.playAt(1);
    else if(action==="success")retry.resolve({url:"renewed"});else if(action==="restricted")retry.reject(Error("HTTP 403"));
    await settle();permission.resolve(action!=="deny");await settle();
    assert.ok(!calls.includes("music_catalog"),action);
    if(action!=="restricted")retry.resolve({url:"late"});await settle();
  }
});
test("cache replay is requested only for an automatic same-ID network fault, never decoder faults, early EOF or manual playback",async()=>{
  for(const fault of ["network","decode","unsupported","early"]){
    const calls=[],p=player(async(cmd,args)=>{if(cmd==="music_stream")calls.push(args);return {url:"audio"+calls.length};},[song(1)]);
    await p.playAt(0);assert.equal(calls[0].recoverFromCache,undefined);
    const a=p.ctx.audio;a.currentTime=42;
    if(fault==="early"){a.ended=true;p.emit("ended");}
    else{a.error={code:{network:2,decode:3,unsupported:4}[fault]};p.emit("error");}
    await settle();assert.equal(calls.length,2,fault);assert.equal(calls[1].recoverFromCache,fault==="network"?true:undefined,fault);
  }
});
test("a successful retry starts without waiting for the local probe, and a hanging probe is bounded and reused on the next error",async()=>{
  const track={...song(1),duration:180},local=deferred(),calls=[];
  const p=player(async(cmd,args)=>{calls.push(cmd);return cmd==="music_recovery_allowed"?false:{url:args.automatic?"recovered-A":"primary"};},[track]);
  const schedule=p.ctx.setTimeout;let deadline=null,scans=0;
  p.ctx.setTimeout=(fn,ms)=>{if(ms===1500)deadline=fn;return schedule(fn,ms);};
  p.ctx.findLocalRecording=()=>{scans++;return local.promise;};
  await p.playAt(0);const a=p.ctx.audio;a.currentTime=26;a.error={code:2};p.emit("error");await settle();
  assert.equal(a.paused,false);assert.equal(a.src,"recovered-A");assert.equal(a.currentTime,26);assert.equal(scans,1);
  a.currentTime=45;p.emit("error");await settle();assert.equal(scans,1);
  deadline();await settle();
  assert.deepEqual(calls,["music_stream","music_stream","music_recovery_allowed"]);
  assert.equal(p.ctx.streamLoading,false);assert.equal(p.ctx.retryPosition,45);
  local.resolve({url:"too-late",offline:true});await settle();assert.equal(a.paused,true);assert.equal(a.src,"recovered-A");
});
test("the losing recovery cannot dispatch a new native stream after its asynchronous offline lookup returns",async()=>{
  const track={...song(1),duration:180},offline=deferred(),calls=[];let lookups=0;
  const p=player(async(cmd,args)=>{
    calls.push(cmd);
    if(cmd==="music_offline_source")return ++lookups===1?null:offline.promise;
    return {url:args.id};
  },[track]);
  p.ctx.window={__TAURI__:{core:{convertFileSrc:x=>x}}};
  p.ctx.findLocalRecording=async()=>({url:"local",offline:true});
  await p.playAt(0);p.ctx.audio.currentTime=23;p.ctx.audio.error={code:2};p.emit("error");await settle();
  assert.equal(p.ctx.audio.src,"local");offline.resolve(null);await settle();
  assert.equal(calls.filter(cmd=>cmd==="music_stream").length,1);
  assert.equal(p.ctx.audio.src,"local");assert.equal(p.ctx.audio.currentTime,23);
});
test("pause or skip during parallel local verification discards both old results",async()=>{
  for(const action of ["pause","skip"]){
    const track={...song(1),duration:180},remote=deferred(),local=deferred();
    const p=player(async(_cmd,args)=>args.automatic?remote.promise:{url:args.id},[track,song(2)]);
    p.ctx.findLocalRecording=()=>local.promise;
    await p.playAt(0);const a=p.ctx.audio;a.currentTime=21;a.error={code:2};p.emit("error");await settle();
    if(action==="pause")await p.togglePlay();else await p.playAt(1);
    local.resolve({url:"old-file",offline:true});remote.resolve({url:"old-stream"});await settle();
    assert.equal(a.src,action==="pause"?"":song(2).id);assert.equal(a.paused,action==="pause");
    assert.equal(p.ctx.current.id,action==="pause"?track.id:song(2).id);
  }
});
test("only one distinct high catalog match can recover; near versions, ambiguous answers and absence all stop",async()=>{
  const original={...song(1),duration:180},copy={...original,id:song(3).id};
  assert.equal(singleCatalogMatch(original,[original,copy,copy]).id,copy.id);
  assert.equal(singleCatalogMatch(original,[{...copy,title:copy.title+" (Official Music Video)"}]),null);
  assert.equal(singleCatalogMatch({...original,explicit:true},[{...copy,explicit:false}]),null);
  assert.equal(singleCatalogMatch({...original,albumId:"album1"},[{...copy,albumId:"album2"}]),null);
  assert.equal(singleCatalogMatch({...original,album:"edition one"},[{...copy,album:"edition two"}]),null);
  for(const items of [[],[copy,{...copy,id:song(4).id}],[{...copy,title:copy.title+" (Live)"}],[{...copy,duration:192}],[{...copy,unavailable:true}]]){
    const calls=[],p=player(async(cmd,args)=>{
      calls.push(cmd);if(cmd==="music_recovery_allowed")return true;
      if(cmd==="music_catalog")return {sections:[{items}]};
      if(args.id!==original.id)throw Error("Incorrect substitute");
      throw Error("Requested format is not available");
    },[original]);
    await p.playAt(0);
    assert.deepEqual(calls,["music_stream","music_stream","music_recovery_allowed","music_catalog"]);
    assert.equal(p.ctx.resolvedTrack,null);
  }
});
test("an equivalent whose decoder cannot reach the checkpoint does not rewind or consume more retries",async()=>{
  const original={...song(1),duration:180},alternate={...original,id:song(3).id},calls=[];
  const p=player(async(cmd,args)=>{
    if(cmd==="music_recovery_allowed")return true;
    if(cmd==="music_catalog")return {sections:[{items:[alternate]}]};
    calls.push(args.id);
    if(args.id===original.id)throw Error("Network unavailable");
    p.ctx.audio.duration=18;return {url:"short-alternate"};
  },[original]);
  await p.playAt(0,{resume:42.5});await settle();
  assert.deepEqual(calls,[original.id,original.id,alternate.id]);
  assert.equal(p.ctx.retryPosition,42.5);assert.equal(p.ctx.current.id,original.id);
  assert.equal(p.ctx.resolvedTrack,null);assert.equal(p.ctx.audio.paused,true);assert.equal(p.ctx.streamLoading,false);
});
test("provider terminal results never search online, and a negative native guard blocks search after a generic transport failure",async()=>{
  const original={...song(1),duration:180};
  for(const failure of ["HTTP 403","429 rate limited","Playback verification is pending","attestation rejected","invalid music engine response","Cancelled","Network unavailable"]){
    const calls=[],p=player(async(cmd)=>{
      calls.push(cmd);if(cmd==="music_recovery_allowed")return false;throw Error(failure);
    },[original]);let localLookups=0;p.ctx.findLocalRecording=async()=>{localLookups++;return null;};
    await p.playAt(0);
    assert.equal(localLookups,failure==="Cancelled"?0:1);
    assert.deepEqual(calls,failure==="Network unavailable"?["music_stream","music_stream","music_recovery_allowed"]:["music_stream"]);
  }
});
test("automatic approved local audio can resume at a provider denial without any catalog or alternate stream call",async()=>{
  const original={...song(1),duration:180},calls=[],p=player(async(cmd)=>{calls.push(cmd);throw Error("HTTP 403");},[original]);
  p.ctx.findLocalRecording=async item=>{assert.equal(item.id,original.id);return {url:"fixture-local",offline:true};};
  await p.playAt(0,{resume:23.5});assert.equal(p.ctx.audio.src,"fixture-local");assert.equal(p.ctx.audio.currentTime,23.5);
  assert.equal(p.ctx.resolvedOffline,true);assert.deepEqual(calls,["music_stream"]);
  p.ctx.audio.error={code:3};p.emit("error");await settle();
  assert.deepEqual(calls,["music_stream"]);assert.deepEqual(p.ctx.saved.sourceBindings,[]);
});
test("pause and a new queue selection discard a late catalog match; an explicit source or room never triggers search",async()=>{
  const original={...song(1),duration:180},alternate={...original,id:song(3).id};
  for(const action of ["pause","next","timeout","bound","room"]){
    const pending=deferred(),calls=[];
    const p=player(async(cmd,args)=>{
      calls.push([cmd,args]);
      if(cmd==="music_recovery_allowed")return true;
      if(cmd==="music_catalog")return pending.promise;
      if(args.id===song(2).id)return {url:"second"};
      throw Error("network failure");
    },[original,song(2)]);
    if(action==="bound")p.ctx.saved.sourceBindings=[{trackId:original.id,source:alternate}];
    const loading=p.playAt(0,{origin:action==="room"?"room":"manual"});await settle();
    if(action==="bound"||action==="room"){await loading;assert.ok(!calls.some(([cmd])=>cmd==="music_catalog"));continue;}
    assert.equal(calls.at(-1)[0],"music_catalog");
    if(action==="pause")await p.togglePlay();else if(action==="timeout"){p.expire();await loading;}else await p.playAt(1);
    pending.resolve({sections:[{items:[alternate]}]});await loading;
    assert.equal(calls.some(([cmd,args])=>cmd==="music_stream"&&args.id===alternate.id),false);
    assert.equal(p.ctx.streamLoading,false);assert.equal(p.ctx.audio.paused,action!=="next");
  }
});
test("a denied song at zero offers a new publication and keeps the logical song in the queue, history, and favorites",async()=>{
  const original={...song(1),id:"s_uxuGmhq1Q",title:"Gimme! Gimme! Gimme! (Sgt Slick's Melbourne Recut)",artists:["Sgt Slick"]};
  const alternate={...original,id:"kAnQgluWpkc",duration:187};
  const calls=[],p=player(async(command,args)=>{
    calls.push([args.id,args.refresh]);
    if(args.id===original.id)throw Error("Audio HTTP 403");
    return {url:"working-publication"};
  },[original,song(2)]);
  p.ctx.saved.favorites=[original];
  await p.playAt(0);
  assert.deepEqual(calls,[[original.id,false]]);
  assert.equal(p.ctx.changeSource.hidden,false);
  p.chooseRecording(original);
  assert.equal(p.ctx.picker.save(alternate),true);
  await settle();
  assert.deepEqual(calls,[[original.id,false],[alternate.id,false]]);
  assert.equal(p.ctx.audio.paused,false);
  assert.equal(p.ctx.changeSource.hidden,true);
  assert.equal(p.ctx.current.id,original.id);
  assert.deepEqual(p.ctx.queue.map(item=>item.id),[original.id,song(2).id]);
  assert.equal(p.ctx.saved.recent[0].id,original.id);
  assert.equal(p.ctx.saved.favorites[0].id,original.id);
});
test("a selected stream that fails before its first timeupdate gets one recovery at zero",async()=>{
  const calls=[],p=player(async(_,args)=>{calls.push(args);return {url:args.refresh?"recovered":"initial"};});
  await p.playAt(0);p.ctx.audio.error={code:2};p.emit("error");await settle();
  assert.deepEqual(calls.map(call=>call.refresh),[false,true]);
  assert.equal(p.ctx.audio.src,"recovered");assert.equal(p.ctx.audio.paused,false);
  p.emit("error");await settle();assert.equal(calls.length,2);
});
test("a stalled first start reopens the same song once through the fresh source",async()=>{
 const calls=[];let p;
 p=player(async(_command,args)=>{calls.push(args);if(args.refresh)p.ctx.audio.hang=false;return {url:args.refresh?"reserve":"initial"};});
 p.ctx.audio.hang=true;const start=p.playAt(0);await settle();p.expire();await start;
 assert.equal(calls.length,2);assert.equal(calls[1].refresh,true);
 assert.equal(p.ctx.audio.src,"reserve");assert.equal(p.ctx.audio.paused,false);assert.equal(p.ctx.streamLoading,false);
 assert.equal(p.ctx.current.id,song(1).id);
});

test("stalled audio startup and resume leave an enabled retry state after the deadline",async()=>{
  const p=player(async()=>({url:"audio"}));p.ctx.audio.hang=true;
  const start=p.playAt(0);await settle();p.expire();await settle();p.expire();await start;
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
  assert.equal(calls.length,4); // Foreground + at most three preparations per 30 seconds.
  p.ctx.queue=[song(1),song(2)];p.ctx.repeat="all";await p.playAt(1);p.ctx.audio.currentTime=150;p.emit("timeupdate");await settle();
  assert.equal(calls.at(-1),song(1).id);await p.advance();await settle();assert.equal(p.ctx.current.id,song(1).id);
});

test('a changed queue replaces pending preparation without a stale completion clearing the new job',async()=>{
 const pending=new Map(),warmed=[];
 const p=player(async(_,args)=>{if(!args.preload)return {url:args.id};const d=deferred();pending.set(args.id,d);return d.promise;},[song(1),song(2),song(3)]);
 p.ctx.decks.warm=(id)=>warmed.push(id);
 await p.playAt(0);p.ctx.audio.currentTime=20;p.emit('timeupdate');await settle();
 p.ctx.queue=[song(1),song(3),song(2)];p.emit('timeupdate');await settle();
 assert(pending.has(song(3).id));
 pending.get(song(2).id).resolve({url:song(2).id});await settle();
 assert.equal(p.ctx.preloadPending.id,song(3).id);assert.equal(warmed.length,0);
 pending.get(song(3).id).resolve({url:song(3).id});await settle();
 assert.deepEqual(warmed,[song(3).id]);assert.equal(p.ctx.preloadPending,false);
});

test('a weak current buffer defers preparation until it has recovered',async()=>{
 const calls=[];const p=player(async(_,args)=>{calls.push(args);return {url:args.id};},[song(1),song(2)]);
 await p.playAt(0);p.ctx.audio.currentTime=20;p.ctx.audio.buffered.end=()=>23;
 p.emit('timeupdate');await settle();assert.equal(calls.length,1);
 p.ctx.audio.buffered.end=()=>32;p.emit('timeupdate');await settle();assert.equal(calls.length,2);
});

test('repeated stall events share one recovery deadline and preserve playback position',async()=>{
 const calls=[];const p=player(async(_,args)=>{calls.push(args);return {url:args.id};});
 await p.playAt(0);p.ctx.audio.currentTime=42;p.ctx.audio.readyState=2;
 p.emit('waiting');const timer=p.ctx.bufferingTimer;p.emit('waiting');p.emit('stalled');assert.equal(p.ctx.bufferingTimer,timer);
 p.expire();await settle();assert.equal(calls.length,2);assert.equal(p.ctx.audio.currentTime,42);assert.equal(p.ctx.bufferingTimer,null);
 p.ctx.navigator.onLine=false;p.emit('waiting');p.expire();await settle();
 assert.equal(calls.length,2);assert.equal(p.ctx.retryPosition,42);assert.equal(p.ctx.audio.paused,true);
});

test('temporary source lookup failures recover once and keep the requested position',async()=>{
 const calls=[];const p=player(async(_,args)=>{calls.push(args);if(calls.length===1)throw Error('Network connection reset');return {url:'fresh'};});
 await p.playAt(0,{resume:63});assert.equal(calls.length,2);assert.equal(calls[1].refresh,true);
 assert.equal(p.ctx.audio.src,'fresh');assert.equal(p.ctx.audio.currentTime,63);assert.equal(p.ctx.audio.paused,false);
 const outage=[];const q=player(async(_,args)=>{outage.push(args);throw Error('Network unavailable');});
 await q.playAt(0,{resume:63});assert.equal(outage.length,2);assert.equal(q.ctx.retryPosition,63);assert.equal(q.ctx.streamLoading,false);
});

test('an empty mid-track buffer recovers promptly but fresh bytes or a seek keep the original source',async()=>{
  for(const state of ['empty','refilled','seek']){
    const calls=[],p=player(async(cmd,args)=>{calls.push(cmd);return {url:'track'};});
    await p.playAt(0);const a=p.ctx.audio;a.currentTime=31;a.readyState=2;
    let end=31, delay, fire;
    a.buffered.end=()=>end;
    p.ctx.setTimeout=(fn,ms)=>{delay=ms;fire=fn;return 1;};
    p.emit('waiting');assert.equal(delay,2500);p.emit('stalled');
    if(state==='refilled'){end=34;a.readyState=4;}
    if(state==='seek')a.seeking=true;
    fire();await settle();
    assert.equal(calls.filter(c=>c==='music_stream').length,state==='empty'?2:1);
    assert.equal(a.currentTime,31);
  }
});

test('source recovery never retries restrictions, verification, cancellation or offline playback',async()=>{
 for(const message of ['HTTP 403','YouTube rate limit 429','Playback verification is pending','Cancelled']){
  let calls=0;const p=player(async()=>{calls++;throw Error(message);});await p.playAt(0);assert.equal(calls,1,message);
 }
 let calls=0;const p=player(async()=>{calls++;throw Error('Network unavailable');});p.ctx.navigator.onLine=false;
 await p.playAt(0);assert.equal(calls,0);assert.equal(p.ctx.recoveryUsed,false);
});

test('a recovered decoder is not restarted by an obsolete buffering deadline',async()=>{
 const calls=[];const p=player(async(_,args)=>{calls.push(args);return {url:'audio'};});
 await p.playAt(0);p.ctx.audio.currentTime=42;p.ctx.audio.readyState=2;p.emit('waiting');
 p.ctx.audio.currentTime=46;p.ctx.audio.readyState=4;p.expire();await settle();
 assert.equal(calls.length,1);assert.equal(p.ctx.audio.paused,false);assert.equal(p.ctx.audio.currentTime,46);
 p.ctx.audio.readyState=2;p.emit('waiting');p.expire();await settle();
 assert.equal(calls.length,2);assert.equal(p.ctx.audio.currentTime,46);
});

test('transient preparation retries after a cooldown at most once per candidate',async()=>{
 let now=10000,attempts=0;const p=player(async(_,args)=>{if(args.preload){attempts++;throw Error('Network connection reset');}return {url:'audio'};},[song(1),song(2)]);
 p.ctx.Date=class extends Date{static now(){return now;}};
 await p.playAt(0);p.ctx.audio.currentTime=20;p.preloadNext();await settle();assert.equal(attempts,1);
 now+=4999;p.preloadNext();await settle();assert.equal(attempts,1);
 now++;p.preloadNext();await settle();assert.equal(attempts,2);
 now+=60000;for(let i=0;i<20;i++)p.preloadNext();await settle();assert.equal(attempts,2);
 assert.equal(p.ctx.audio.paused,false);assert.equal(p.ctx.message,'');
});

test('pausing during preparation does not prevent warming after resume',async()=>{
 const pending=deferred();let attempts=0,warmed=0;
 const p=player(async(_,args)=>{if(args.preload){attempts++;return attempts===1?pending.promise:{url:'next'};}return {url:'audio'};},[song(1),song(2)]);
 p.ctx.decks.warm=()=>{warmed++;};await p.playAt(0);p.ctx.audio.currentTime=20;p.preloadNext();await settle();
 p.ctx.audio.pause();pending.resolve({url:'next'});await settle();assert.equal(warmed,0);
 await p.ctx.audio.play();p.preloadNext();await settle();assert.equal(warmed,1);assert.equal(attempts,2);
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
    Object.assign(p.ctx,{librarySidebar:null,statsSession:null,statsSeconds:0,statsCounted:false,weekly:{record(){}}});
    p.ctx.captureListening=runInNewContext(`(()=>{${captureCode};return captureListening;})()`,p.ctx);
    p.ctx.playbackOrigin=automatic?"recommendation":"manual";p.ctx.clock.seconds=5;
    await p.advance(true);await settle();
    assert.equal(p.ctx.taste.entries[song(1).id].score,0);assert.equal(p.ctx.taste.entries[song(1).id].plays,0);
    assert.equal(p.ctx.recommendationSession.options().itemAdjustments.has(song(1).id),automatic);
    assert.equal(p.ctx.recommendationSession.options().sessionFeedback.length,Number(automatic));
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
  p.ctx.recommendationSession.recordListen(item,{seconds:40,duration:180,session:1,familiar:false});
  p.ctx.recommendationSession.fail(song(2).id);p.ctx.playbackContext=[item];p.ctx.playbackOrigin="recommendation";p.ctx.playbackSourceContext={kind:"playlist",id:"private"};
  p.ctx.discoveryCandidates=[item];p.ctx.recommendationReasons.set(item.id,{code:"discovery"});p.ctx.privateSession=false;p.clearRecommendationContext();
  assert.equal(p.ctx.recommendationSession.contextItems().length,0);assert.equal(p.ctx.recommendationSession.options().itemAdjustments.size,0);
  assert.equal(p.ctx.recommendationSession.options().sessionFeedback.length,0);
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

test("refresh and a saved recording choice still prefer a valid downloaded source while connected",async()=>{
  const logical=song(1),physical=song(101),calls=[],p=player(async(command,args)=>{calls.push({command,...args});if(command==="music_offline_source")return `D:/Music/${args.id}.mp3`;throw Error("a valid local source must not start a stream");});
  p.ctx.window.__TAURI__={core:{convertFileSrc:path=>`asset:${path}`}};p.ctx.navigator.onLine=true;
  await p.playAt(0,{refresh:true});
  assert.equal(p.ctx.audio.src,`asset:D:/Music/${logical.id}.mp3`);
  p.chooseRecording(logical);assert.equal(p.ctx.picker.save(physical),true);await settle();
  assert.equal(p.ctx.audio.src,`asset:D:/Music/${physical.id}.mp3`);assert.equal(p.ctx.audio.paused,false);
  assert.deepEqual(calls.map(call=>[call.command,call.id]),[["music_offline_source",logical.id],["music_offline_source",physical.id]]);
});

test("only an actual local decoder error bypasses offline lookup during mid-track recovery",async()=>{
  for(const code of [2,3,4]){
    const calls=[],p=player(async(command,args)=>{calls.push({command,...args});return command==="music_offline_source"?"D:/Music/local.mp3":{url:"stream:recovered"};});
    p.ctx.window.__TAURI__={core:{convertFileSrc:path=>`asset:${path}`}};p.ctx.navigator.onLine=true;
    await p.playAt(0);p.ctx.clock.seconds=40;p.ctx.audio.currentTime=55;p.ctx.audio.error={code};
    p.emit("error");await settle();
    assert.deepEqual(calls.map(call=>call.command),code===2?["music_offline_source","music_offline_source"]:["music_offline_source","music_stream"]);
    assert.equal(p.ctx.audio.currentTime,55);assert.equal(p.ctx.audio.paused,false);
  }
});

test("selecting a song after the first 200 library entries plays that exact song",async()=>{
  const items=Array.from({length:500},(_,n)=>song(n)),p=player(async(_,args)=>({url:args.id})),before=structuredClone(items);
  p.playItems(items,items[250].id);await settle();
  assert.equal(p.ctx.current.id,items[250].id);assert.equal(p.ctx.audio.src,items[250].id);
  assert.equal(p.ctx.queue.length,500);assert.deepEqual(Array.from(p.ctx.queue,item=>item.id),items.map(item=>item.id));
  assert.deepEqual(items,before);
});

test("a failed offline lookup falls back online only when connected and retains the final network failure",async()=>{
  for(const online of [true,false]){
    const calls=[],p=player(async command=>{calls.push(command);if(command==="music_offline_source")throw Error("Local lookup failed");throw Error("Network unavailable");});
    p.ctx.window.__TAURI__={core:{convertFileSrc:path=>`asset:${path}`}};p.ctx.navigator.onLine=online;
    await p.playAt(0);
    assert.deepEqual(calls,online?["music_offline_source","music_stream","music_offline_source","music_stream"]:["music_offline_source"]);
    assert.equal(p.ctx.audio.paused,true);assert.equal(p.ctx.current.id,song(1).id);
    if(online)assert.equal(p.ctx.message,"Music could not connect. Check your connection and proxy settings, then retry.");
  }
});

test("offline failure keeps its network category before Russian or Spanish UI translation",async()=>{
  const source="Music could not connect. Check your connection and proxy settings, then retry.";
  for(const translated of [ru[source],es[source]]){
    let requests=0;const p=player(async()=>{requests++;throw Error("offline must not make a network request");});
    p.ctx.navigator.onLine=false;p.ctx.t=text=>text===source?translated:text;
    await p.playAt(0);
    assert.equal(requests,0);assert.equal(p.ctx.message,translated);assert.equal(p.ctx.artist.title,translated);
    assert.equal(p.ctx.diagnostics.snapshot().at(-1).code,"network");
    assert.equal(p.ctx.current.id,song(1).id);assert.equal(p.ctx.audio.paused,true);assert.equal(p.ctx.streamLoading,false);
  }
});

test("a damaged local decoder gets one fresh online attempt at the same position",async()=>{
  const calls=[],p=player(async(command,args)=>{calls.push({command,...args});return command==="music_offline_source"?"D:/Music/damaged.mp3":{url:"stream:working"};});
  p.ctx.window.__TAURI__={core:{convertFileSrc:path=>`asset:${path}`}};p.ctx.navigator.onLine=true;
  const original=p.ctx.audio.play;
  p.ctx.audio.play=async function(){if(this.src.startsWith("asset:"))throw Error("MEDIA_ERR_DECODE");return original.call(this);};
  await p.playAt(0,{resume:42});
  assert.deepEqual(calls.map(call=>call.command),["music_offline_source","music_stream"]);
  assert.equal(calls[1].refresh,true);assert.equal(p.ctx.audio.src,"stream:working");assert.equal(p.ctx.audio.currentTime,42);
  assert.equal(p.ctx.audio.paused,false);assert.equal(p.ctx.streamLoading,false);assert.equal(p.ctx.message,"");
});

test("a damaged local file while offline never triggers an online stream and keeps a retryable decoder error",async()=>{
  const calls=[],p=player(async command=>{calls.push(command);return "D:/Music/damaged.mp3";});
  p.ctx.window.__TAURI__={core:{convertFileSrc:path=>`asset:${path}`}};p.ctx.navigator.onLine=false;
  p.ctx.audio.play=async()=>{throw Error("MEDIA_ERR_DECODE");};
  await p.playAt(0,{resume:42});
  assert.deepEqual(calls,["music_offline_source"]);assert.equal(p.ctx.retryPosition,42);assert.equal(p.ctx.audio.paused,true);
  assert.equal(p.ctx.streamLoading,false);assert.equal(p.ctx.message,"This audio could not be decoded. Try another track or download it as MP3.");
});

test("a failed online fallback stops after one attempt and exposes its actual network error",async()=>{
  const calls=[],p=player(async command=>{calls.push(command);if(command==="music_offline_source")return "D:/Music/damaged.mp3";throw Error("Network unavailable");});
  p.ctx.window.__TAURI__={core:{convertFileSrc:path=>`asset:${path}`}};p.ctx.navigator.onLine=true;
  p.ctx.audio.play=async()=>{throw Error("MEDIA_ERR_DECODE");};
  await p.playAt(0,{resume:42});await settle();
  assert.deepEqual(calls,["music_offline_source","music_stream"]);
  assert.equal(p.ctx.retryPosition,42);assert.equal(p.ctx.audio.paused,true);assert.equal(p.ctx.streamLoading,false);
  assert.equal(p.ctx.message,"Music could not connect. Check your connection and proxy settings, then retry.");
});

test("saving a new source discards an older speculative decoder and prepares the new choice without rewriting the manual queue",async()=>{
  const queued=[song(1),song(2)],oldSource=song(102),newSource=song(202),pending=deferred(),calls=[],warmed=[];
  const p=player(async(command,args)=>{calls.push({command,...args});return args.id===oldSource.id?pending.promise:{url:args.id};},queued);
  p.ctx.saved.sourceBindings=[{trackId:queued[1].id,track:queued[1],source:oldSource}];p.ctx.decks.warm=(id,url)=>warmed.push({id,url});
  await p.playAt(0);p.ctx.audio.currentTime=150;p.emit("timeupdate");await settle();
  const before=p.ctx.deckClears||0;
  p.chooseRecording(queued[1]);assert.equal(p.ctx.picker.save(newSource),true);assert.equal(p.ctx.sourceRevision,1);assert.equal(p.ctx.deckClears,before+1);
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

test("choosing an online recording with matching credits, version and duration resumes the same queue item",async()=>{
  const item={...song(1),duration:180},alternate={...item,id:song(99).id};
  const p=player(async(_,args)=>({url:args.id}),[item,song(2)]);
  await p.playAt(0);
  p.ctx.audio.duration=47; // The decoder saw only the opening fragment.
  p.ctx.retryPosition=42.25;p.ctx.needsRefresh=true;p.ctx.resolvedTrack=null;
  p.ctx.audio.pause();p.ctx.audio.removeAttribute("src");p.ctx.audio.load();
  p.chooseRecording(item);
  assert.equal(p.ctx.picker.item.duration,180);
  assert.equal(p.ctx.picker.save(alternate),true);await settle();
  assert.equal(p.ctx.audio.src,alternate.id);assert.equal(p.ctx.audio.currentTime,42.25);
  assert.equal(p.ctx.audio.paused,false);assert.equal(p.ctx.current.id,item.id);assert.equal(p.ctx.queue.length,2);
  p.chooseRecording(item);
  p.ctx.endSource.duration=260;
  p.ctx.recoveryUsed=true;
  assert.equal(p.ctx.picker.save({...alternate,id:song(98).id,title:item.title+" (Slowed)"}),true);await settle();
  assert.equal(p.ctx.audio.currentTime,0);
  assert.notEqual(p.ctx.endSource.duration,260);
  assert.equal(p.ctx.recoveryUsed,false);
});

test("confirming an exact local copy in the picker resumes the failed song without contacting the catalog",async()=>{
  const song1={...song(1),duration:180},calls=[];
  const p=player(async(command,args)=>{
    calls.push([command,args]);
    if(command==="music_local_exact")return "D:/test/owned.flac";
    if(command==="music_offline_source")return null;
    if(command==="music_stream")throw Error("Playback restricted: YouTube denied access to the audio.");
    throw Error("Unexpected command "+command);
  },[song1,song(2)]);
  p.ctx.window={__TAURI__:{core:{convertFileSrc:path=>"asset:"+path}}};
  await p.playAt(0,{resume:43});calls.length=0;
  p.chooseRecording(song1);
  const copy={...song1,id:"local:"+"b".repeat(64),contentHash:"a".repeat(64)};
  assert.equal(await p.ctx.picker.local.save(copy),true);await settle();
  assert.equal(p.ctx.audio.src,"asset:D:/test/owned.flac");assert.equal(p.ctx.audio.currentTime,43);
  assert.equal(p.ctx.audio.paused,false);assert.equal(p.ctx.current.id,song1.id);assert.equal(p.ctx.queue.length,2);
  assert.deepEqual(calls.map(([command])=>command),["music_local_exact","music_local_exact"]);
  assert.equal(p.ctx.picker.local.choice().hash,copy.contentHash);
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

 test('preparing a paused source is not reported as playing, and a real pause preserves its buffer',async()=>{
 const p=player(async()=>({url:'fixture'}));
 await p.playAt(0,{autoplay:false});
 assert.equal(p.ctx.audio.paused,true);
 assert(!p.ctx.diagnostics.snapshot().some(event=>event.stage==='playing'));
 await p.togglePlay();
 assert(p.ctx.diagnostics.snapshot().some(event=>event.stage==='playing'&&event.code==='success'));
 await p.togglePlay();assert.equal(p.ctx.audio.paused,true);
 assert.equal(p.ctx.lastCancellation.preserve,true);
 });

test('Cinema handoff releases music and resume resolves a fresh source at the saved position',async()=>{
 let count=0;const p=player(async()=>({url:'source-'+(++count)}));
 await p.playAt(0);p.ctx.audio.currentTime=42;
 p.yieldToOtherMedia();assert.equal(p.ctx.audio.paused,true);
 assert.equal(p.ctx.resolvedTrack,null);assert.equal(p.ctx.retryPosition,42);
 assert.equal(p.ctx.lastCancellation.preserve,false);
 await p.togglePlay();assert.equal(count,2);assert.equal(p.ctx.audio.src,'source-2');
 assert.equal(p.ctx.audio.currentTime,42);assert.equal(p.ctx.audio.paused,false);
});
