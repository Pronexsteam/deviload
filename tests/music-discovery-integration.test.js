import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {createMusicDiscovery} from "../src/music-discovery.js";
import {createRecommendationSession} from "../src/music-recommendation-session.js";
import {createRecordingView} from "../src/music-recording-view.js";
import {resolveRecordingSource} from "../src/music-recordings.js";
import {rankMusicRecommendations} from "../src/music-recommendation-engine.js";
import {interestProfile,interestSeeds,interestSources} from "../src/music-interest-mixes.js";
import {readTaste,tasteSeeds,canonicalArtistKey} from "../src/music-taste.js";
import {tracks} from "../src/music-state.js";
import {saveMusicProfile,readMusicProfile} from "../src/music-profile.js";

const source=readFileSync(new URL("../src/devil-music.js",import.meta.url),"utf8");
const between=(from,to)=>source.slice(source.indexOf(from),source.indexOf(to));
const code=between("  function resetPublicDiscovery(","  function visibleRecommendation(")+
  between("  async function radio(seed)","  async function advance(")+
  between("  function renderInterestPool(","  function showLocal(");
const song=(n,artist=`Artist ${n}`)=>({id:String(n).padStart(11,"0"),kind:"song",title:`Song ${n}`,artists:[artist],duration:180,image:""});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const response=items=>({recordings:items.map((item,index)=>({mbid:`00000000-0000-0000-0000-${String(index+1).padStart(12,"0")}`,title:item.title,artists:item.artists,duration:item.duration}))});

function music({discovery=async()=>response([song(11)]),extra=[song(11)],radioItems=[song(2)]}={}){
  const calls=[],renders=[],controls=new Map(),ctx={
    saved:{favorites:[song(1)],recent:[],collections:[],playlists:[],sourceBindings:[],interestMixes:[],publicDiscovery:true,showRegional:false},
    taste:readTaste(),queue:[],current:null,privateSession:false,navigator:{onLine:true},publicGeneration:0,sourceRevision:0,
    request:1,personalization:0,recommendationRevision:0,playRequest:1,contextRevision:0,
    view:"home",lastQuery:{kind:"home"},followedCursor:0,playbackContext:[],playbackSourceContext:{kind:"manual"},
    recommendationSession:createRecommendationSession(),recommendationReasons:new Map(),radioCache:new Map(),discoveryCandidates:[],sections:[],
    interestViewId:null,interestPool:null,interestRotations:new Map(),activeMood:"",browseItem:null,continuation:null,morePending:false,listFilter:"",listSort:"original",loading:false,loaded:true,
    audio:{paused:false},intent:{enter(){}},captureListening(){},rememberNavigation(){},skeleton(){},status(){},selectView:value=>{ctx.view=value;},
    $:id=>{if(!controls.has(id))controls.set(id,{disabled:false,textContent:""});return controls.get(id);},
    render(){renders.push(JSON.parse(JSON.stringify(ctx.sections)));},language:()=>"en",t:value=>value,
    resolveRecordingSource,createRecordingView,rankMusicRecommendations,interestProfile,interestSeeds,interestSources,tracks,tasteSeeds,canonicalArtistKey
  };
  ctx.invoke=async(command,args)=>{
    calls.push({command,args:JSON.parse(JSON.stringify(args))});
    if(command==="music_discovery")return discovery(args);
    if(command==="music_catalog"&&args.kind==="radio")return {sections:[{items:radioItems}]};
    if(command==="music_catalog"&&args.kind==="search")return {sections:[{items:extra}]};
    if(command==="music_catalog"&&args.kind==="browse")return {sections:[]};
    throw Error(`Unexpected command ${command}`);
  };
  ctx.publicDiscovery=createMusicDiscovery({invoke:ctx.invoke});
  const actions=runInNewContext(`(()=>{${code};return {personalize,showInterestMix,radioCandidates,rankRadioPool,resetPublicDiscovery,discoveryAllowed};})()`,ctx);
  return {ctx,calls,renders,...actions,publicCalls:()=>calls.filter(row=>row.command==="music_discovery"),searchCalls:()=>calls.filter(row=>row.command==="music_catalog"&&row.args.kind==="search")};
}

test("slow public discovery augments home after the existing radio renders without changing playback or queue",async()=>{
  const pending=deferred(),m=music({discovery:()=>pending.promise});
  m.ctx.current=song(90);m.ctx.queue=[song(90),song(91)];const queue=JSON.stringify(m.ctx.queue);
  await m.personalize(1,[]);
  assert.ok(m.ctx.sections.flatMap(row=>row.items).some(item=>item.id===song(2).id));
  assert.equal(m.ctx.sections.flatMap(row=>row.items).some(item=>item.id===song(11).id),false);
  pending.resolve(response([song(11)]));await settle();
  assert.ok(m.ctx.sections.flatMap(row=>row.items).some(item=>item.id===song(11).id));
  assert.equal(JSON.stringify(m.ctx.queue),queue);assert.equal(m.ctx.current.id,song(90).id);assert.equal(m.ctx.audio.paused,false);
});

test("an unavailable public provider leaves primary home and autoplay candidates usable",async()=>{
  const m=music({discovery:async()=>{throw Error("service unavailable");}});
  await m.personalize(1,[]);await settle();assert.equal(m.ctx.sections[0].items[0].id,song(2).id);
  const pool=await m.radioCandidates(song(1));await settle();assert.equal(pool.items[0].id,song(2).id);assert.deepEqual(m.ctx.queue,[]);
});

test("fresh profiles receive a public starter shelf without claiming learned preferences",async()=>{
  const m=music();m.ctx.saved.favorites=[];
  await m.personalize(1,[]);await settle();
  assert.deepEqual(m.publicCalls()[0].args,{artists:[],tags:["pop"]});
  assert.equal(m.ctx.sections[0].title,"Explore with ListenBrainz");assert.equal(m.ctx.sections[0].items[0].id,song(11).id);
  assert.equal(m.calls.filter(row=>row.args.kind==="radio").length,0);assert.deepEqual(m.ctx.taste.entries,Object.create(null));
});

test("privacy, disabled public discovery, offline and data saver prevent public API and resolution calls",async()=>{
  for(const block of [m=>{m.ctx.privateSession=true;},m=>{m.ctx.saved.publicDiscovery=false;},m=>{m.ctx.navigator.onLine=false;},m=>{m.ctx.navigator.connection={saveData:true};}]){
    const m=music();block(m);await m.personalize(1,[]);await m.radioCandidates(song(1));await settle();
    assert.equal(m.publicCalls().length,0);assert.equal(m.searchCalls().length,0);assert.ok(m.ctx.sections[0].items.some(item=>item.id===song(2).id));
  }
});

test("late public responses cannot cross privacy, opt-out, navigation, or source-choice boundaries",async()=>{
  for(const boundary of [m=>{m.ctx.privateSession=true;m.resetPublicDiscovery();},m=>{m.ctx.saved.publicDiscovery=false;m.resetPublicDiscovery();},m=>{m.ctx.request++;m.ctx.view="library";},m=>{m.ctx.sourceRevision++;}]){
    const pending=deferred(),m=music({discovery:()=>pending.promise});await m.personalize(1,[]);
    const before=JSON.stringify(m.ctx.sections),renders=m.renders.length;boundary(m);pending.resolve(response([song(11)]));await settle();
    assert.equal(m.searchCalls().length,0);assert.equal(JSON.stringify(m.ctx.sections),before);assert.equal(m.renders.length,renders);
  }
});

test("interest discovery queries only the chosen playlist's artists and leaves manual playback intact",async()=>{
  const jazz=song(4,"Jazz Quartet"),unrelated=song(5,"Phonk Unit"),pending=deferred(),m=music({discovery:()=>pending.promise});
  m.ctx.saved.favorites=[unrelated];m.ctx.saved.playlists=[{id:"work",name:"Work",items:[jazz]}];m.ctx.saved.interestMixes=[{id:"focus",name:"Focus",playlistIds:["work"]}];
  m.ctx.queue=[unrelated,song(99)];m.ctx.current=unrelated;const before=JSON.stringify(m.ctx.queue);
  await m.showInterestMix("focus");assert.deepEqual(m.publicCalls()[0].args,{artists:["Jazz Quartet"],tags:[]});
  assert.ok(m.ctx.sections[0].items.some(item=>item.id===jazz.id));pending.resolve(response([song(11)]));await settle();
  assert.equal(JSON.stringify(m.ctx.queue),before);assert.equal(m.ctx.current.id,unrelated.id);
});

test("a stale interest response cannot replace a different view",async()=>{
  const pending=deferred(),m=music({discovery:()=>pending.promise});
  m.ctx.saved.playlists=[{id:"work",name:"Work",items:[song(1)]}];m.ctx.saved.interestMixes=[{id:"focus",name:"Focus",playlistIds:["work"]}];
  await m.showInterestMix("focus");const renders=m.renders.length;m.ctx.view="library";m.ctx.request++;
  pending.resolve(response([song(11)]));await settle();assert.equal(m.renders.length,renders);assert.equal(m.searchCalls().length,0);
});

test("prepared autoplay pools are enriched asynchronously and consumed using current exclusions and source bindings",async()=>{
  const pending=deferred(),hidden=song(11),blocked=song(12,"Blocked"),physical=song(14,"Shared Artist"),logical=song(13,"Shared Artist");
  const m=music({discovery:()=>pending.promise,extra:[hidden,blocked,physical]});
  const pool=await m.radioCandidates(song(1));assert.deepEqual(Array.from(pool.items,item=>item.id),[song(2).id]);
  pending.resolve(response([hidden,blocked,physical]));await settle();assert.ok(pool.items.some(item=>item.id===physical.id));
  m.ctx.taste.hiddenSongs=[hidden.id];m.ctx.taste.blockedArtists=["blocked"];m.ctx.taste.mode="discovery";
  m.ctx.saved.sourceBindings=[{trackId:logical.id,track:logical,source:physical}];
  const ranked=m.rankRadioPool(pool,song(1)),ids=Array.from(ranked,item=>item.id);
  assert.ok(ids.includes(logical.id));assert.ok(!ids.includes(physical.id));assert.ok(!ids.includes(hidden.id));assert.ok(!ids.includes(blocked.id));
  assert.ok(pool.items.some(item=>item.id===hidden.id));assert.deepEqual(m.ctx.queue,[]);
});

test("late autoplay enrichment is dropped after its playback context changes",async()=>{
  const pending=deferred(),m=music({discovery:()=>pending.promise});const pool=await m.radioCandidates(song(1));
  m.ctx.contextRevision++;pending.resolve(response([song(11)]));await settle();
  assert.deepEqual(Array.from(pool.items,item=>item.id),[song(2).id]);assert.equal(m.searchCalls().length,0);
});

test("an already resolved public candidate rescues autoplay when the primary radio subsequently fails",async()=>{
  const primary=deferred(),m=music(),invoke=m.ctx.invoke;
  m.ctx.invoke=(command,args)=>command==="music_catalog"&&args.kind==="radio"?primary.promise:invoke(command,args);
  const pending=m.radioCandidates(song(1));await settle();assert.equal(m.searchCalls().length,1);
  primary.reject(Error("primary station unavailable"));const pool=await pending;
  assert.deepEqual(Array.from(pool.items,item=>item.id),[song(11).id]);assert.deepEqual(m.ctx.queue,[]);
});

test("public queries respect an explicitly chosen physical recording while preserving logical favorites",async()=>{
  const m=music(),logical=song(1),physical=song(201,"Chosen Recording Artist");
  m.ctx.saved.sourceBindings=[{trackId:logical.id,track:logical,source:physical}];
  await m.personalize(1,[]);await settle();
  assert.deepEqual(m.publicCalls()[0].args,{artists:[physical.artists[0]],tags:[]});
  assert.equal(m.calls.find(row=>row.args.kind==="radio").args.value,physical.id);
  assert.equal(m.ctx.saved.favorites[0].id,logical.id);
});

test("the actual public-discovery control commits its opt-out atomically and restores the checkbox on storage failure",()=>{
  const handler=between('  $("music-public-discovery").addEventListener(', '  $("music-discovery").addEventListener(');
  for(const fail of [false,true]){
    const m=music(),memory=new Map(),control={checked:false,addEventListener(_event,fn){this.change=fn;}};
    Object.assign(m.ctx,{view:"library",homeCache:null,radioAhead:{prepared:true},saveMusicProfile,errorText:String,resetPublicDiscovery:m.resetPublicDiscovery,
      storage:{getItem:key=>memory.get(key),setItem:(key,value)=>{if(fail)throw Error("storage full");memory.set(key,value);}},
      $:()=>control,invalidateRecommendations(){m.ctx.invalidated=true;}});
    runInNewContext(handler,m.ctx);control.change();
    if(fail){assert.equal(m.ctx.saved.publicDiscovery,true);assert.equal(control.checked,true);assert.equal(m.ctx.publicGeneration,0);assert.equal(m.ctx.invalidated,undefined);assert.ok(m.ctx.radioAhead);}
    else{assert.equal(m.ctx.saved.publicDiscovery,false);assert.equal(readMusicProfile(m.ctx.storage).saved.publicDiscovery,false);assert.equal(m.ctx.publicGeneration,1);assert.equal(m.ctx.invalidated,true);assert.equal(m.ctx.radioAhead,null);}
  }
});
