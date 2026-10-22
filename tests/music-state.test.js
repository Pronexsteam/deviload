import test from "node:test";
import assert from "node:assert/strict";
import {tracks, remember, nextIndex, readMusicState,reorderTrack,insertNext,restoreRemoved,playbackQueue} from "../src/music-state.js";

const a={kind:"song",id:"abcdefghijk",title:"A"},b={kind:"song",id:"lmnopqrstuv",title:"B"};
test("music queue excludes albums, invalid IDs and duplicate tracks",()=>{
  assert.deepEqual(tracks([a,{kind:"album",id:"MPREtest"},null,{kind:"song",id:"bad"},b,a]),[a,b]);
});
test("recent listening moves repeated tracks to the front and stays bounded",()=>{
  assert.deepEqual(remember([a,b],b),[b,a]);
  assert.deepEqual(remember([a,b],b,1),[b]);
});
test("queue ends, repeats and shuffles without immediately repeating a track",()=>{
  assert.equal(nextIndex([],0,false,false),-1);
  assert.equal(nextIndex([a,b],0,false,false),1);
  assert.equal(nextIndex([a,b],1,false,false),-1);
  assert.equal(nextIndex([a,b],1,true,false),0);
  assert.equal(nextIndex([a,b],0,false,true,()=>0),1);
  assert.equal(nextIndex([a,b],1,false,true,()=>.999),0);
  assert.equal(nextIndex([a],0,false,true),-1);
});
test("music storage recovers from malformed or inaccessible data",()=>{
  for(const storage of [undefined,{getItem(){throw Error("unavailable");}},{getItem:()=>"null"},{getItem:()=>"{"}])
    assert.deepEqual(readMusicState(storage),{favorites:[],recent:[],volume:.7});
  assert.deepEqual(readMusicState({getItem:()=>JSON.stringify({favorites:[a,a],recent:123,volume:5})}),{favorites:[a],recent:[],volume:1});
});

test("queue edits preserve track identity, avoid duplicates and undo without discarding later additions",()=>{
  const c={kind:"song",id:"12345678901",title:"C"},d={kind:"song",id:"12345678902",title:"D"};
  const moved=reorderTrack([a,b,c],a.id,2);
  assert.deepEqual(moved,[b,c,a]);assert.equal(moved.findIndex(item=>item.id===b.id),0);
  assert.deepEqual(insertNext([a,b,c],a.id,c),[a,c,b]);
  assert.deepEqual(insertNext([a,b],a.id,a),[a,b]);
  assert.deepEqual(restoreRemoved([a,c,d],b,1),[a,b,c,d]);
  assert.deepEqual(restoreRemoved([a,b],b,0),[a,b]);
});

test("saved likes and listening history survive reading a new player session",()=>{
  const state={favorites:[a],recent:[b,a],volume:.35};
  assert.deepEqual(readMusicState({getItem:()=>JSON.stringify(state)}),state);
});

test("a bounded playback window includes the selected song from a large library without changing its order",()=>{
  const items=Array.from({length:500},(_,n)=>({kind:"song",id:String(n).padStart(11,"0"),title:`Song ${n}`})),before=structuredClone(items);
  assert.deepEqual(playbackQueue(items,items[20].id),items.slice(0,200));
  const middle=playbackQueue([items[0],...items],items[250].id);
  assert.deepEqual(middle,items.slice(250,450));assert.equal(middle[0].id,items[250].id);
  const tail=playbackQueue(items,items[499].id);
  assert.deepEqual(tail,items.slice(300));assert.equal(tail.at(-1).id,items[499].id);
  assert.deepEqual(playbackQueue(items,"missing"),items.slice(0,200));assert.deepEqual(items,before);
});
