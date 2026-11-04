import test from "node:test";
import assert from "node:assert/strict";
import {readMusicSession,saveMusicSession,createPlaybackOrder} from "../src/music-session.js";
import {playbackQueue} from "../src/music-state.js";
import {createRecordingSourceResolver} from "../src/music-recordings.js";
const song=n=>({id:String(n).padStart(11,"0"),kind:"song",title:`Song ${n}`});
const queue=[song(1),song(2),song(3),song(4)];

test("large queue snapshots and shuffle previews index each profile binding once per replacement",()=>{
  const items=Array.from({length:2000},(_,n)=>song(n));
  const sources=Array.from({length:200},(_,n)=>({trackId:items[n].id,source:song(3000+n)}));
  let reads=0;
  const observe=rows=>new Proxy(rows,{get(target,key,receiver){
    if(typeof key==="string"&&/^\d+$/.test(key))reads++;
    return Reflect.get(target,key,receiver);
  }});
  let bindings=observe(sources);
  const resolve=createRecordingSourceResolver();
  const order=createPlaybackOrder(()=>.1,item=>resolve(item,bindings).id);
  order.visit(items[0].id,items);
  assert.deepEqual(order.snapshot(items).seen,[sources[0].source.id]);
  order.preview(items,0,false,true);
  order.snapshot(items);
  assert.equal(reads,sources.length);
  const replacement={trackId:items[0].id,source:song(6000)};
  bindings=observe([replacement]);
  order.visit(items[0].id,items);
  assert.deepEqual(order.snapshot(items).seen,[replacement.source.id]);
  assert.equal(resolve(items[1],bindings),items[1]);
  assert.equal(reads,sources.length+1);
});

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

test("restart snapshot preserves the full large queue and its current track",()=>{
 let raw;const storage={setItem:(_,value)=>raw=value,getItem:()=>raw};
 const items=Array.from({length:1420},(_,n)=>song(n));
 saveMusicSession(storage,{queue:items,id:items[1200].id,position:40,shuffle:true});
 const restored=readMusicSession(storage);assert.equal(restored.queue.length,1420);assert.equal(restored.id,items[1200].id);assert.equal(restored.position,40);
});

test('explicit Play next overrides shuffle even for a previously heard song, without resetting its cycle',()=>{
 const order=createPlaybackOrder(()=>.99);order.visit(queue[0].id,queue);order.visit(queue[1].id,queue);
 order.enqueue(queue[0].id);assert.equal(order.next(queue,1,false,true),0);assert.equal(order.preview(queue,1,false,true)[0].id,queue[0].id);
 order.visit(queue[0].id,queue);const next=order.next(queue,0,false,true);assert.ok(next===2||next===3);
 order.visit(queue[next].id,queue);const last=order.next(queue,next,false,true);assert.ok(last!==next&&last>=2);
 order.visit(queue[last].id,queue);assert.equal(order.next(queue,last,false,true),-1);
});

test('Previous and Next retrace playback before resuming a manually arranged shuffle queue',()=>{
 const order=createPlaybackOrder(()=>0);order.visit(queue[0].id,queue);order.plan(queue.slice(1).map(item=>item.id));
 order.visit(queue[1].id,queue);assert.equal(order.previous(queue),queue[0].id);order.visit(queue[0].id,queue);
 assert.equal(order.next(queue,0,false,true),1);assert.equal(order.preview(queue,0,false,true)[0].id,queue[1].id);
 order.enqueue(queue[3].id);assert.equal(order.next(queue,0,false,true),3,'a fresh explicit command can override forward history');
});
test('mini preview and snapshots preserve the unshown tail of the main queue',()=>{
 const items=Array.from({length:1420},(_,n)=>song(n));let seed=3;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
 const order=createPlaybackOrder(random);order.visit(items[0].id,items);const full=order.preview(items,0,false,true,1420).map(item=>item.id);
 for(let n=0;n<5;n++)order.preview(items,0,false,true,32);
 const state=order.snapshot(items);assert.deepEqual(order.preview(items,0,false,true,1420).map(item=>item.id),full);
 const restored=createPlaybackOrder(()=>0);restored.restore(state,items,items[0].id);assert.deepEqual(restored.preview(items,0,false,true,1420).map(item=>item.id),full);
});

test('large pruned shuffle plans resolve remaining priorities with bounded metadata reads',()=>{
 let reads=0;const items=Array.from({length:10000},(_,n)=>{const item=song(n),id=item.id;return {...item,get id(){reads++;return id;}};});
 const order=createPlaybackOrder(()=>.4);order.visit(items[0].id,items);order.plan(items.slice(1).map(item=>item.id));
 const remaining=[items[0],...items.slice(9000)];reads=0;
 const next=order.next(remaining,0,false,true);assert.equal(next,1);
 assert.ok(reads<10000,`Pruned priorities scanned track metadata ${reads} times`);
 const preview=order.preview(remaining,0,false,true,remaining.length);
 assert.equal(preview.length,1000);assert.equal(new Set(preview.map(item=>item.id)).size,1000);
 const state=order.snapshot(remaining),restored=createPlaybackOrder(()=>.9);restored.restore(state,remaining,remaining[0].id);
 assert.deepEqual(restored.preview(remaining,0,false,true,remaining.length),preview);
});

test('restart preserves shuffle progress, reserved next choice and explicit priority',()=>{
 const items=Array.from({length:1420},(_,n)=>song(n));const order=createPlaybackOrder(()=>.7);let index=0;
 order.visit(items[index].id,items);const heard=new Set([items[index].id]);
 for(let n=0;n<100;n++){index=order.next(items,index,false,true);order.visit(items[index].id,items);heard.add(items[index].id);}
 const preview=order.preview(items,index,false,true,32);let raw;const storage={getItem:()=>raw,setItem:(_,value)=>raw=value};
 saveMusicSession(storage,{queue:items,id:items[index].id,shuffle:true,order:order.snapshot(items)});
 const session=readMusicSession(storage),restored=createPlaybackOrder(()=>0);restored.restore(session.order,session.queue,session.id);
 assert.equal(session.queue[restored.next(session.queue,index,false,true)].id,preview[0].id);
 for(let n=heard.size;n<items.length;n++){index=restored.next(session.queue,index,false,true);assert.ok(index>=0);assert.ok(!heard.has(items[index].id));heard.add(items[index].id);restored.visit(items[index].id,session.queue);}
 assert.equal(restored.next(session.queue,index,false,true),-1);
 restored.enqueue(items[0].id);const priority=createPlaybackOrder();priority.restore(restored.snapshot(items),items,items[index].id);
 assert.equal(priority.next(items,index,false,true),0);
});
test("session survives a restart without storing expiring streams or requesting playback",()=>{
  let raw;const storage={setItem:(_,value)=>raw=value,getItem:()=>raw};
  saveMusicSession(storage,{queue:queue.map(item=>({...item,url:"secret stream"})),id:queue[2].id,position:72,repeat:"one",shuffle:true,autoplay:false});
  const value=readMusicSession(storage);assert.equal(value.id,queue[2].id);assert.equal(value.position,72);assert.equal(value.repeat,"one");assert.equal(value.shuffle,true);assert.equal(value.autoplay,false);assert.equal(value.queue.length,4);assert.ok(!raw.includes("secret stream"));
});
test('repeated snapshots observe edited metadata while failed writes preserve the previous session',()=>{
 let raw;let fail=false;const storage={getItem:()=>raw,setItem:(_,value)=>{if(fail)throw Error('Quota');raw=value;}};
 const item={...song(10),artists:['Before'],url:'secret'},queue=[item];
 saveMusicSession(storage,{queue,id:item.id});item.title='Edited';item.artists[0]='After';
 saveMusicSession(storage,{queue,id:item.id});assert.equal(readMusicSession(storage).queue[0].title,'Edited');assert.deepEqual(readMusicSession(storage).queue[0].artists,['After']);
 fail=true;item.title='Unsaved';assert.throws(()=>saveMusicSession(storage,{queue,id:item.id}),/Quota/);
 assert.equal(readMusicSession(storage).queue[0].title,'Edited');assert.ok(!raw.includes('secret'));
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
