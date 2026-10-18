import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {readTaste,recordListening} from '../src/music-taste.js';
import {remember} from '../src/music-state.js';
import {createWeeklyStats} from '../src/music-weekly.js';
import {createRecommendationSession} from '../src/music-recommendation-session.js';
import {rememberInterestTrack} from '../src/music-interest-mixes.js';

const source=readFileSync(new URL('../src/devil-music.js',import.meta.url),'utf8');
const capture=source.slice(source.indexOf('  function captureListening('),source.indexOf('  function plannedNext('));
const toggle=source.slice(source.indexOf('  $("music-private-session").addEventListener('),source.indexOf('  function renderWeekly('));
const persistence=source.slice(source.indexOf('  function persistSession('),source.indexOf('  async function playbackSource('));
const subtitle=source.slice(source.indexOf('function displaySubtitle('),source.indexOf('const time ='));
const playing=source.split('\n').find(line=>line.includes('listen("playing",'));
const boundary=source.split('\n').find(line=>line.includes('function listeningBoundary('));
const song=n=>({id:String(n).padStart(11,'0'),title:`Track ${n}`,subtitle:'Artist',artists:['Artist'],kind:'song'});

function player(){
  const memory=new Map(),storage={getItem:key=>memory.get(key),setItem:(key,value)=>memory.set(key,value)},handlers={},events={},control={checked:false,addEventListener:(name,fn)=>handlers[name]=fn};
  const ctx={current:song(1),privateSession:false,discordPresence:{sync(){}},statsSession:null,statsSeconds:0,statsCounted:false,session:1,checkpoint:0,historyAdded:false,
    audio:{duration:200,currentTime:0,paused:false,readyState:4,volume:.7,muted:false,seeking:false},clock:{seconds:0,reset(){this.seconds=0;},sample(){}},taste:readTaste(),saved:{favorites:[],recent:[],collections:[],playlists:[],sourceBindings:[],interestMixes:[]},playbackContext:[],playbackOrigin:'manual',playbackSourceContext:{kind:'restored'},diagnostics:{record(){}},
    weekly:createWeeklyStats(storage,{now:()=>1800000000000}),recommendationSession:createRecommendationSession(),recommendationRevision:0,recordListening,remember,rememberInterestTrack,profileWrites:0,sessionWrites:0,
    persist(){ctx.profileWrites++;},saveMusicProfile(_storage,profile){ctx.profileWrites++;ctx.lastProfile=profile;},saveMusicSession(){ctx.sessionWrites++;},storage,sessionTransition:false,queue:[song(1)],resolvedTrack:song(1).id,retryPosition:0,knownDuration:200,repeat:'off',shuffle:false,autoplay:true,sessionSavedAt:0,
    status(){},view:'favorites',homeCache:null,clearRecommendationContext(){ctx.recommendationSession.reset();ctx.playbackContext=[];ctx.playbackSourceContext={kind:'manual'};ctx.playbackOrigin='manual';},
    t:value=>value,$:()=>control,listen:(name,fn)=>events[name]=fn,clearTimeout(){},bufferingTimer:null,artist:{},syncDock(){},performance:{now:()=>0}};
  const actions=runInNewContext(`(()=>{${subtitle}\n${capture}\n${persistence}\n${toggle}\n${boundary}\n${playing}\nreturn {captureListening,persistSession};})()`,ctx);
  return {ctx,...actions,toggle(value){control.checked=value;handlers.change();},playing(){events.playing();},listen(seconds){ctx.clock.seconds=seconds;actions.captureListening();}};
}

test('repeated pause/checkpoint captures record only new seconds and one qualified play',()=>{
  const p=player();p.listen(30);p.listen(30);p.listen(45);p.listen(60);p.captureListening();
  assert.equal(p.ctx.weekly.summary().totalSeconds,60);
  assert.equal(p.ctx.weekly.summary().totalQualifiedPlays,1);
  assert.equal(p.ctx.taste.entries[song(1).id].plays,1);
  p.ctx.current=song(2);p.ctx.session++;p.ctx.clock.reset();p.listen(30);
  assert.equal(p.ctx.weekly.summary().totalSeconds,90);
  assert.equal(p.ctx.weekly.summary().totalQualifiedPlays,2);
});

test('enabling private listening mid-track saves only the preceding public portion',()=>{
  const p=player();p.ctx.clock.seconds=15;p.toggle(true);
  const taste=JSON.stringify(p.ctx.taste),recent=JSON.stringify(p.ctx.saved.recent),writes=p.ctx.profileWrites;
  p.listen(180);p.captureListening(true);p.playing();p.persistSession();
  assert.equal(p.ctx.weekly.summary().totalSeconds,15);
  assert.equal(p.ctx.weekly.summary().totalQualifiedPlays,0);
  assert.equal(JSON.stringify(p.ctx.taste),taste);
  assert.equal(p.ctx.profileWrites,writes);assert.equal(p.ctx.sessionWrites,0);
  assert.equal(JSON.stringify(p.ctx.saved.recent),recent);
  p.toggle(false);p.listen(20);
  assert.equal(p.ctx.weekly.summary().totalSeconds,35);
  p.persistSession();assert.equal(p.ctx.sessionWrites,1);
});

test('private toggles within one playback do not count the same song twice',()=>{
  const p=player();p.listen(35);p.toggle(true);p.listen(80);p.toggle(false);p.listen(35);p.listen(35);
  assert.equal(p.ctx.weekly.summary().totalSeconds,70);
  assert.equal(p.ctx.weekly.summary().totalQualifiedPlays,1);
});

test('disabling private mode during continuous playback resumes history without a playing event',()=>{
  const p=player();p.toggle(true);p.playing();p.listen(40);
  assert.equal(p.ctx.saved.recent.length,0);
  p.toggle(false);p.listen(30);
  assert.equal(p.ctx.saved.recent[0]?.id,song(1).id);
});

test('a new song started privately can qualify after privacy is disabled',()=>{
  const p=player();p.listen(35);p.toggle(true);
  p.ctx.current=song(2);p.ctx.session++;p.ctx.clock.reset();p.listen(50);
  p.toggle(false);p.listen(35);
  assert.equal(p.ctx.weekly.summary().totalSeconds,70);
  assert.equal(p.ctx.weekly.summary().totalQualifiedPlays,2);
});

function chooseInterest(p,{origin='manual',trusted=false}={}){
  p.ctx.saved.interestMixes=[{id:'jazz',name:'Evening jazz',playlistIds:['jazz-list']}];
  p.ctx.saved.playlists=[{id:'jazz-list',name:'Jazz',items:[song(9)]}];
  p.ctx.playbackSourceContext={kind:'interest',id:'jazz'};p.ctx.playbackOrigin=origin;
  if(trusted)p.ctx.recommendationSession.setContext([p.ctx.current]);
}

test('an interest learns only qualified listening from its chosen context or automatic discoveries',()=>{
  for(const origin of ['manual','recommendation']){
    const p=player();chooseInterest(p,{origin,trusted:origin==='manual'});p.listen(5);
    assert.equal(p.ctx.saved.interestMixes[0].learnedIds,undefined);p.listen(30);
    assert.deepEqual(p.ctx.saved.interestMixes[0].learnedIds,[song(1).id],origin);
    assert.equal(p.ctx.taste.entries[song(1).id].plays,1);assert.equal(p.ctx.lastProfile.interestMixes,p.ctx.saved.interestMixes);
    p.listen(45);assert.deepEqual(p.ctx.saved.interestMixes[0].learnedIds,[song(1).id]);
  }
  const short=player();chooseInterest(short,{origin:'recommendation'});short.ctx.audio.duration=20;short.listen(16);
  assert.deepEqual(short.ctx.saved.interestMixes[0].learnedIds,[song(1).id]);
});

test('a manual queue song outside the interest playback context never trains that interest',()=>{
  const p=player();chooseInterest(p);p.ctx.recommendationSession.setContext([song(9)]);p.listen(40);
  assert.equal(p.ctx.taste.entries[song(1).id].plays,1);assert.equal(p.ctx.saved.interestMixes[0].learnedIds,undefined);
  assert.equal(p.ctx.lastProfile,undefined);assert.ok(p.ctx.profileWrites>0);
});

test('private or inaudible sessions do not train an interest and leaving privacy discards its old provenance',()=>{
  const privatePlayer=player();chooseInterest(privatePlayer,{origin:'recommendation'});privatePlayer.ctx.privateSession=true;privatePlayer.listen(90);
  assert.equal(privatePlayer.ctx.saved.interestMixes[0].learnedIds,undefined);assert.equal(privatePlayer.ctx.taste.entries[song(1).id],undefined);assert.equal(privatePlayer.ctx.profileWrites,0);
  privatePlayer.toggle(false);privatePlayer.listen(35);assert.equal(privatePlayer.ctx.saved.interestMixes[0].learnedIds,undefined);
  const inaudible=player();chooseInterest(inaudible,{origin:'recommendation'});inaudible.ctx.audio.muted=true;inaudible.listen(0);
  assert.equal(inaudible.ctx.saved.interestMixes[0].learnedIds,undefined);assert.equal(inaudible.ctx.taste.entries[song(1).id]?.plays||0,0);
});

test('qualified listening to a selected source learns the logical song and never its physical alias',()=>{
  const p=player(),logical=song(1),physical=song(101);chooseInterest(p,{origin:'recommendation'});
  p.ctx.saved.sourceBindings=[{trackId:logical.id,track:logical,source:physical}];p.listen(35);
  assert.deepEqual(p.ctx.saved.interestMixes[0].learnedIds,[logical.id]);assert.equal(p.ctx.taste.entries[logical.id].plays,1);
  assert.equal(p.ctx.taste.entries[physical.id],undefined);assert.equal(p.ctx.saved.recent[0].id,logical.id);
});

test('failed optional interest persistence retains normal listening capture without installing an unsaved learned state',()=>{
  const p=player();chooseInterest(p,{origin:'recommendation'});p.ctx.saveMusicProfile=()=>{throw Error('storage full');};p.listen(35);
  assert.equal(p.ctx.saved.interestMixes[0].learnedIds,undefined);assert.equal(p.ctx.taste.entries[song(1).id].plays,1);assert.equal(p.ctx.profileWrites,1);
  assert.equal(p.ctx.weekly.summary().totalSeconds,35);
});
