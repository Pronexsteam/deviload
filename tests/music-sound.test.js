import test from 'node:test';
import assert from 'node:assert/strict';
import {soundSettings,equalizerHeadroom,createMusicRate,createSilenceWatch,SILENCE,presets} from '../src/music-sound-model.js';
test('old sound preferences migrate without losing preset, smoothing or transition',()=>{
  const s=soundSettings({preset:'voice',soft:true,transition:4});assert.deepEqual(s.bands,presets.voice);assert.equal(s.soft,true);assert.equal(s.transition,4);assert.equal(s.rate,1);
  assert.equal(soundSettings(null).preset,'flat');assert.equal(soundSettings({rate:Infinity}).rate,1);
});
test('named presets with identical bands retain the selected name through storage',()=>{
  const state=soundSettings({preset:'custom',bands:[1,2,3,4,5,6],custom:[{name:'First',bands:[1,2,3,4,5,6]},{name:'Second',bands:[1,2,3,4,5,6]}],selected:'Second',rate:1.5,bypass:true});
  assert.deepEqual(soundSettings(JSON.parse(JSON.stringify(state))),state);assert.equal(state.selected,'Second');
});
test('headroom is unity for flat/cuts and accounts for overlapping boosts',()=>{
  assert.equal(equalizerHeadroom(presets.flat),1);assert.equal(equalizerHeadroom([-6,-3,-1,-2,-4,-5]),1);
  const boosted=equalizerHeadroom([12,12,12,12,12,12]);assert.ok(boosted>0&&boosted<10**(-12/20));
  assert.ok(equalizerHeadroom([1,0,0,0,0,0])>.8);
});
const media=()=>{const events={};return {preservesPitch:false,playbackRate:1,defaultPlaybackRate:1,addEventListener:(name,fn)=>events[name]=fn,metadata(){this.playbackRate=this.defaultPlaybackRate;events.loadedmetadata();}};};
test('rate follows local and online sources on both decks without overriding guest drift',()=>{
  const a=media(),b=media();let value=1.5;const rates=createMusicRate([a,b],()=>value);
  rates.setSource(a,true);rates.setSource(b,false);assert.equal(a.playbackRate,1.5);assert.equal(b.playbackRate,1.5);assert.equal(a.preservesPitch,true);assert.equal(rates.reason(b),'');
  rates.setSource(b,true);b.metadata();assert.equal(b.playbackRate,1.5);
  rates.setMode('host');assert.equal(a.playbackRate,1);assert.equal(b.playbackRate,1);assert.equal(rates.reason(a),'room');
  rates.setMode('');value=2;rates.refresh();rates.setMode('guest');a.metadata();assert.equal(a.playbackRate,1);
  a.playbackRate=.975;rates.refresh();assert.equal(a.playbackRate,.975);
  rates.setMode('');assert.equal(a.playbackRate,2);rates.setSource(a,false);assert.equal(a.playbackRate,2);
});
test('unsupported pitch correction leaves playback at normal speed',()=>{
  const a=media();delete a.preservesPitch;const rates=createMusicRate([a],()=>2);rates.setSource(a,true);assert.equal(a.playbackRate,1);assert.equal(rates.reason(a),'pitch');
});
test('a silent stretch passes quickly and returns to the chosen speed, but rooms keep normal time',()=>{
  const a=media();const rates=createMusicRate([a],()=>1.25);rates.setSource(a,false);assert.equal(a.playbackRate,1.25);
  rates.hurry(a,SILENCE.rate);assert.equal(a.playbackRate,4);assert.equal(a.defaultPlaybackRate,1.25);
  rates.hurry(a,0);assert.equal(a.playbackRate,1.25);
  rates.hurry(a,4);a.metadata();assert.equal(a.playbackRate,1.25,'a new song never inherits the hurry');
  rates.hurry(a,4);rates.setMode('host');assert.equal(a.playbackRate,1);assert.equal(rates.mode,'host');
});
test('silence must last before it is skipped and any sound ends the skip at once',()=>{
  const w=createSilenceWatch({level:.002,hold:.8});
  assert.equal(w.update(0,0,true),false);assert.equal(w.update(0,.5,true),false);assert.equal(w.update(0,.8,true),true);
  assert.equal(w.update(.01,.85,true),false,'a returning voice stops the skip');assert.equal(w.update(0,.9,true),false);
  assert.equal(w.update(0,1.8,false),false,'paused or overlapping players are never skipped');assert.equal(w.update(0,2,true),false);
  assert.equal(w.update(NaN,3,true),false);assert.equal(soundSettings({skipSilence:true}).skipSilence,true);assert.equal(soundSettings({}).skipSilence,false);
});
