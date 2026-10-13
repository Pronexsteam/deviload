import test from "node:test";
import assert from "node:assert/strict";
import {readMusicSession,saveMusicSession,createPlaybackOrder} from "../src/music-session.js";
const song=n=>({id:String(n).padStart(11,"0"),kind:"song",title:`Song ${n}`});
const queue=[song(1),song(2),song(3),song(4)];
test("session survives a restart without storing expiring streams or requesting playback",()=>{
  let raw;const storage={setItem:(_,value)=>raw=value,getItem:()=>raw};
  saveMusicSession(storage,{queue:queue.map(item=>({...item,url:"secret stream"})),id:queue[2].id,position:72,repeat:"one",shuffle:true,autoplay:false});
  const value=readMusicSession(storage);assert.equal(value.id,queue[2].id);assert.equal(value.position,72);assert.equal(value.repeat,"one");assert.equal(value.shuffle,true);assert.equal(value.autoplay,false);assert.equal(value.queue.length,4);assert.ok(!raw.includes("secret stream"));
});
test("session restores safely after malformed storage and clamps untrusted positions",()=>{
  for(const raw of [null,"{","null",JSON.stringify({queue:[{kind:"song",id:"bad"}]})])assert.equal(readMusicSession({getItem:()=>raw}).id,null);
  const value=readMusicSession({getItem:()=>JSON.stringify({queue,id:queue[0].id,position:-50,repeat:"unexpected"})});assert.equal(value.position,0);assert.equal(value.repeat,"off");
});
test("shuffle plays every song once, then stops unless queue repeat is enabled",()=>{
  const order=createPlaybackOrder(()=>0);let index=0;order.visit(queue[0].id,queue);const played=[index];
  for(let n=0;n<3;n++){const next=order.next(queue,index,false,true);assert.equal(next,order.next(queue,index,false,true));index=next;played.push(index);order.visit(queue[index].id,queue);}
  assert.equal(new Set(played).size,4);assert.equal(order.next(queue,index,false,true),-1);
  const next=order.next(queue,index,true,true);assert.notEqual(next,index);order.visit(queue[next].id,queue);assert.notEqual(order.next(queue,next,true,true),next);
});
test("previous retraces shuffle history and next returns forward before drawing new songs",()=>{
  const order=createPlaybackOrder(()=>.9);order.visit(queue[0].id,queue);const second=order.next(queue,0,false,true);order.visit(queue[second].id,queue);
  assert.equal(order.previous(queue),queue[0].id);order.visit(queue[0].id,queue);assert.equal(order.next(queue,0,false,true),second);
  order.visit(queue[second].id,queue);assert.notEqual(order.next(queue,second,false,true),0);
});
