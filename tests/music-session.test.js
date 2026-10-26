import test from "node:test";
import assert from "node:assert/strict";
import {readMusicSession,saveMusicSession,createPlaybackOrder} from "../src/music-session.js";
import {playbackQueue} from "../src/music-state.js";
const song=n=>({id:String(n).padStart(11,"0"),kind:"song",title:`Song ${n}`});
const queue=[song(1),song(2),song(3),song(4)];

test("mini queue previews reserve actual shuffle order without consuming tracks",()=>{
 const order=createPlaybackOrder(()=>.7);order.visit(queue[0].id,queue);
 const preview=order.preview(queue,0,false,true);
 assert.deepEqual(order.preview(queue,0,false,true),preview);assert.equal(preview.length,3);
 let index=0;for(const item of preview){index=order.next(queue,index,false,true);assert.equal(queue[index].id,item.id);order.visit(item.id,queue);}
 assert.equal(order.next(queue,index,false,true),-1);
});
test("reordering a mini shuffle preview changes the next choices but not played history",()=>{
 const order=createPlaybackOrder(()=>.3);order.visit(queue[0].id,queue);
 const preview=order.preview(queue,0,false,true).reverse();order.plan(preview.map(item=>item.id));
 assert.equal(queue[order.next(queue,0,false,true)].id,preview[0].id);
 order.visit(preview[0].id,queue);assert.equal(order.previous(queue),queue[0].id);
});

test("shuffle reaches the whole 1420-song library and exhausts it without repeats",()=>{
 const items=playbackQueue(Array.from({length:1420},(_,n)=>song(n)),song(0).id);
 let seed=37;const order=createPlaybackOrder(()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;});
 let index=0;const played=new Set([items[index].id]);order.visit(items[index].id,items);
 let reachedTail=false;
 for(let n=1;n<items.length;n++){
  index=order.next(items,index,false,true);assert.ok(index>=0);if(n<20&&index>=200)reachedTail=true;
  assert.ok(!played.has(items[index].id));played.add(items[index].id);order.visit(items[index].id,items);
 }
 assert.ok(reachedTail);assert.equal(played.size,1420);assert.equal(order.next(items,index,false,true),-1);
});

test("bounded restart snapshot preserves a playing song beyond the first 200 entries",()=>{
 let raw;const storage={setItem:(_,value)=>raw=value,getItem:()=>raw};
 const items=Array.from({length:1420},(_,n)=>song(n));
 saveMusicSession(storage,{queue:items,id:items[1200].id,position:40,shuffle:true});
 const restored=readMusicSession(storage);assert.equal(restored.queue.length,200);assert.equal(restored.id,items[1200].id);assert.equal(restored.position,40);
});
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

test("shuffle peeks keep their choice even with changing random draws and queue UI refreshes",()=>{
  let calls=0;const order=createPlaybackOrder(()=>++calls%2?.05:.95);order.visit(queue[0].id,queue);
  const next=order.next(queue,0,false,true);
  for(let n=0;n<20;n++)assert.equal(order.next([...queue],0,false,true),next);
  assert.equal(calls,1);
});

test("shuffle skips aliases of the playing recording and visits all distinct sources before repeating",()=>{
  const items=[...queue,{...song(5),source:queue[0].id}],key=item=>item.source||item.id;
  const order=createPlaybackOrder(()=>.99,key);order.visit(items[0].id,items);let index=0;const played=new Set([key(items[0])]);
  for(let n=0;n<3;n++){index=order.next(items,index,false,true);assert.ok(index>=0);assert.ok(!played.has(key(items[index])));played.add(key(items[index]));order.visit(items[index].id,items);}
  assert.equal(order.next(items,index,false,true),-1);
  for(let n=0;n<30;n++){const next=order.next(items,index,true,true);assert.notEqual(key(items[next]),key(items[index]));order.visit(items[next].id,items);index=next;}
});

test("resetting shuffle at a playing source also excludes its aliases",()=>{
  const items=[song(1),{...song(2),source:song(1).id},song(3)];
  const order=createPlaybackOrder(()=>0,item=>item.source||item.id);order.reset(items[0].id);
  assert.equal(order.next(items,0,false,true),2);
});

test("large mini previews, repeated peeks and backward navigation preserve a complete shuffle cycle",()=>{
 const items=Array.from({length:1420},(_,n)=>song(n));let seed=91;
 const order=createPlaybackOrder(()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;});
 let index=0;order.visit(items[0].id,items);const played=new Set([items[0].id]);
 for(let n=1;n<items.length;n++){
  const preview=order.preview(items,index,false,true,32),next=order.next(items,index,false,true);
  assert.equal(preview[0].id,items[next].id);assert.equal(order.next(items,index,false,true),next);
  index=next;assert.ok(!played.has(items[index].id));played.add(items[index].id);order.visit(items[index].id,items);
  if(n%100===0){const id=order.previous(items);order.visit(id,items);const forward=order.next(items,items.findIndex(item=>item.id===id),false,true);assert.equal(forward,index);order.visit(items[index].id,items);}
 }
 assert.equal(played.size,1420);assert.equal(order.next(items,index,false,true),-1);
 const next=order.next(items,index,true,true);assert.notEqual(next,index);
});
