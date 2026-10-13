import test from "node:test";
import assert from "node:assert/strict";
import {createMusicDecks} from "../src/music-decks.js";
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
