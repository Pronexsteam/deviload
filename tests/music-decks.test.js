import test from "node:test";
import assert from "node:assert/strict";
import {createMusicDecks} from "../src/music-decks.js";
import {gainFromVolumePosition} from "../src/music-volume.js";
function audio(){const events={};return {src:"",readyState:4,paused:true,volume:.7,error:null,addEventListener(name,fn){events[name]=fn;},emit(name){events[name]?.();},pause(){this.paused=true;this.emit("pause");},load(){},removeAttribute(){this.src="";}};}
test("prepared decoder is reused and stale inactive events cannot advance playback",()=>{
  let now=100;const decks=createMusicDecks({makeAudio:audio,now:()=>now}),first=decks.current;let ends=0;
  decks.listen("ended",()=>ends++);decks.warm("two","http://audio/two");assert.equal(decks.ready("other"),false);
  const second=decks.take("two",.4);assert.notEqual(first,second);assert.equal(second.src,"http://audio/two");assert.equal(second.volume,.4);
  first.emit("ended");assert.equal(ends,0);second.emit("ended");assert.equal(ends,1);
  decks.warm("three","http://audio/three");now+=240001;assert.equal(decks.take("three",.5),null);
});
test("failed, incomplete and replaced preloads are never promoted",()=>{
  const decks=createMusicDecks({makeAudio:audio});decks.warm("one","one");const standby=decks.nodes.find(node=>node!==decks.current);
  standby.readyState=2;assert.equal(decks.take("one",1),null);standby.readyState=4;standby.error={code:2};assert.equal(decks.take("one",1),null);
  standby.error=null;decks.warm("two","two");assert.equal(decks.ready("one"),false);decks.clear();assert.equal(decks.ready("two"),false);
});

test("perceptual volume, mute and unmute apply to prepared decks and a running overlap",()=>{
  let now=0,tick,cancelled=0;
  const decks=createMusicDecks({makeAudio:audio,now:()=>now,schedule:fn=>{tick=fn;return 1;},cancel:()=>cancelled++});
  const first=decks.current;first.paused=false;decks.setVolume(.7);decks.warm("next","next");
  const half=Math.SQRT1_2,close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-9,actual+" != "+expected);
  const next=decks.take("next",.7,4);assert.equal(next.volume,0);now=2000;tick();close(first.volume,.7*half);close(next.volume,.7*half);
  const quiet=gainFromVolumePosition(.1);decks.setVolume(quiet);close(next.volume,quiet*half);close(first.volume,quiet*half);assert.equal(cancelled,0);
  decks.setVolume(0);tick();assert.equal(next.volume,0);assert.equal(first.volume,0);
  decks.setVolume(quiet);close(next.volume,quiet*half);close(first.volume,quiet*half);
  now=4000;tick();assert.equal(first.paused,true);assert.equal(cancelled,1);assert.equal(next.volume,quiet);
  decks.warm("later","later");decks.setVolume(.25);assert.ok(decks.nodes.every(node=>node.volume===.25));
});

test("completed transitions release the old decoder and abandon unused preloads",()=>{
 const decks=createMusicDecks({makeAudio:audio}),old=decks.current;old.src='old';decks.warm('two','two');
 const active=decks.take('two',.7);assert.equal(old.src,'');assert.equal(active.src,'two');
 decks.warm('unused','unused');decks.clear();assert.equal(old.src,'');assert.equal(active.src,'two');
});

test('repeated preparation keeps an already buffering decoder and its expiration',()=>{
 let now=0;const decks=createMusicDecks({makeAudio:audio,now:()=>now});
 const standby=decks.warm('two','two');let loads=0;standby.load=()=>loads++;
 now=120000;assert.equal(decks.warm('two','two'),standby);assert.equal(loads,0);
 now=240001;assert.equal(decks.ready('two'),false);
 decks.warm('two','two');assert.equal(loads,1);assert.equal(decks.ready('two'),true);
 decks.warm('two','replacement');assert.equal(loads,2);assert.equal(standby.src,'replacement');
});

test("an album join switches decoders without a fade and the sleep dim scales every deck",()=>{
  let tick=null;const decks=createMusicDecks({makeAudio:audio,schedule:fn=>{tick=fn;return 1;}}),old=decks.current;old.paused=false;old.src="old";
  decks.setVolume(.6);decks.warm("next","next");const next=decks.take("next",.6,.01);
  assert.equal(tick,null);assert.equal(old.src,"");assert.equal(next.volume,.6);
  decks.setDim(.5);assert.equal(next.volume,.3);decks.setDim(1);assert.equal(next.volume,.6);
});
