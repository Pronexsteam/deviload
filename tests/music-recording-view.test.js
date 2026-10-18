import test from "node:test";
import assert from "node:assert/strict";
import {createRecordingView} from "../src/music-recording-view.js";
import {recommend,readTaste} from "../src/music-taste.js";

const id=n=>String(n).padStart(11,"0");
const song=(n,extra={})=>({id:id(n),kind:"song",title:`Song ${n}`,artists:[`Artist ${n}`],...extra});
const now=Date.now(),day=86400000;
const state=extra=>({favorites:[],recent:[],playlists:[],collections:[],volume:.7,...extra});
const entry=(item,extra={})=>({item,score:2,at:now,lastPlayed:now,plays:1,...extra});
function freeze(value){if(value&&typeof value==="object"){Object.freeze(value);for(const nested of Object.values(value))freeze(nested);}return value;}

test("physical candidates retain the liked logical identity and its qualified cooldown",()=>{
  const a=song(1),b=song(2),queue=[b],saved=freeze(state({favorites:[a],recent:[a],sourceBindings:[{trackId:a.id,source:b}]}));
  const taste=readTaste();taste.entries[a.id]=entry(a);freeze(taste);freeze(queue);
  const before=JSON.stringify({saved,taste,queue}),view=createRecordingView(saved,taste,{queue,now});
  assert.deepEqual(view.items([b,a,b]).map(item=>item.id),[a.id]);
  assert.equal(view.items([b])[0].title,a.title);assert.deepEqual(view.ids([b.id,a.id,b.id]),[a.id]);
  assert.equal(view.saved.favorites[0].id,a.id);assert.equal(view.taste.entries[a.id].lastPlayed,now);
  assert.deepEqual(recommend(view.items([b]),view.taste,view.saved.favorites,{now,random:()=>.5}),[]);
  assert.equal(view.source(view.items([b])[0]).id,b.id);
  assert.equal(JSON.stringify({saved,taste,queue}),before);
});

test("alias history decays once, retains a rejection and does not multiply plays or scores",()=>{
  const a=song(1),b=song(2),taste=readTaste();
  taste.entries[a.id]=entry(a,{score:8,at:now-day,lastPlayed:now-2*day,plays:5});
  taste.entries[b.id]=entry(b,{score:-4,at:now-30*day,lastPlayed:now-day,plays:10});
  const view=createRecordingView(state({favorites:[a],sourceBindings:[{trackId:a.id,source:b}]}),taste,{now});
  const rows=Object.values(view.taste.entries);assert.equal(rows.length,1);
  assert.equal(rows[0].score,-2);assert.equal(rows[0].plays,10);assert.equal(rows[0].at,now);assert.equal(rows[0].lastPlayed,now-day);
  const positive=structuredClone(taste);positive.entries[b.id].score=4;
  const positiveView=createRecordingView(state({sourceBindings:[{trackId:a.id,source:b,track:a}]}),positive,{now});
  assert.equal(positiveView.taste.entries[a.id].score,8*Math.exp(-Math.LN2/30));
  assert.equal(positiveView.taste.entries[a.id].plays,10);
});

test("an alias hidden ID suppresses its family and a blocked physical artist only affects recommendation view",()=>{
  const a=song(1),b=song(2,{artists:["Blocked Source"]}),saved=state({favorites:[a],sourceBindings:[{trackId:a.id,source:b}]});
  const taste=readTaste();taste.entries[a.id]=entry(a,{lastPlayed:now-day});taste.hiddenSongs=[b.id];
  const hidden=createRecordingView(saved,taste,{now});
  assert.deepEqual(hidden.taste.hiddenSongs,[a.id]);
  assert.deepEqual(recommend(hidden.items([b]),hidden.taste,hidden.saved.favorites,{now,random:()=>.5}),[]);
  taste.hiddenSongs=[];taste.blockedArtists=["blocked source"];
  const blocked=createRecordingView(saved,taste,{now});
  assert.deepEqual(blocked.items([a,b]),[]);assert.deepEqual(blocked.saved.favorites,[]);
  assert.ok(blocked.taste.hiddenSongs.includes(a.id));
  assert.equal(blocked.source(a).id,b.id);assert.equal(saved.favorites[0],a);
  assert.deepEqual(taste.hiddenSongs,[]); // No synthetic exclusion is persisted.
});

test("snapshots and real candidate metadata backfill unknown logical tracks without inventing labels",()=>{
  const a=song(1),b=song(2),taste=readTaste();
  const snapshot=createRecordingView(state({sourceBindings:[{trackId:a.id,source:b,track:a}]}),taste,{now});
  assert.deepEqual(snapshot.items([b]),[a]);
  const fallback=createRecordingView(state({sourceBindings:[{trackId:a.id,source:b}]}),taste,{now});
  assert.deepEqual(fallback.ids([b.id]),[a.id]);
  assert.deepEqual(fallback.items([b]),[{...b,id:a.id}]);
  assert.equal(fallback.source(fallback.items([b])[0]).id,b.id);
  assert.deepEqual(fallback.items([b,a]),[a]);
});

test("identical titles or versions never establish an alias without a confirmed binding",()=>{
  const a=song(1),b=song(2,{title:a.title,artists:a.artists}),view=createRecordingView(state({favorites:[a]}),readTaste(),{now});
  assert.deepEqual(view.items([a,b]).map(item=>item.id),[a.id,b.id]);
  assert.deepEqual(view.ids([a.id,b.id]),[a.id,b.id]);assert.equal(view.source(b),b);
});

test("confirmed chains and cycles project one family while physical playback stays one hop",()=>{
  const a=song(1),b=song(2),c=song(3),taste=readTaste();
  taste.entries[c.id]=entry(c,{lastPlayed:now-day});
  const view=createRecordingView(state({favorites:[a],sourceBindings:[{trackId:a.id,source:b},{trackId:b.id,source:c},{trackId:c.id,source:a}]}),taste,{now});
  assert.deepEqual(view.ids([c.id,b.id,a.id]),[a.id]);assert.deepEqual(view.items([c,b,a]).map(item=>item.id),[a.id]);
  assert.equal(view.taste.entries[a.id].plays,1);assert.equal(view.source(a).id,b.id);assert.equal(view.source(b).id,c.id);
});

test("projected saved metadata preserves interest configuration and never mutates frozen library inputs",()=>{
  const a=song(1),b=song(2),interestMixes=[{id:"mix-one",name:"Night",playlistIds:["one"],includeLikes:true,learnedIds:[b.id,a.id]}];
  const saved=freeze(state({favorites:[a,b],recent:[b,a],playlists:[{id:"one",name:"List",description:"Keep",pinned:true,items:[b,a]}],interestMixes,sourceBindings:[{trackId:a.id,source:b}]}));
  const view=createRecordingView(saved,freeze(readTaste()),{now});
  assert.equal(view.saved.favorites.length,1);assert.equal(view.saved.recent.length,1);assert.equal(view.saved.playlists[0].items.length,1);
  assert.deepEqual(view.saved.interestMixes,[{...interestMixes[0],learnedIds:[a.id]}]);assert.notEqual(view.saved.interestMixes,interestMixes);
  assert.deepEqual(saved.interestMixes[0].learnedIds,[b.id,a.id]);
  assert.equal(view.saved.playlists[0].description,"Keep");assert.equal(view.saved.playlists[0].pinned,true);
  view.saved.favorites[0].artists.push("Other");assert.deepEqual(saved.favorites[0].artists,["Artist 1"]);
});

test("invalid timestamps, duplicate bindings and bounded candidate work cannot fabricate evidence",()=>{
  const a=song(1),b=song(2),c=song(3),taste=readTaste();
  taste.entries[a.id]=entry(a,{score:Infinity,at:Infinity,lastPlayed:Infinity,plays:NaN});
  const view=createRecordingView(state({sourceBindings:[{trackId:a.id,source:b},{trackId:a.id,source:c},null,{trackId:"bad",source:c}]}),taste,{now});
  assert.equal(view.source(a).id,b.id);assert.equal(view.taste.entries[a.id].score,0);assert.equal(view.taste.entries[a.id].plays,0);assert.equal(view.taste.entries[a.id].lastPlayed,0);
  assert.deepEqual(view.ids([null,{},"bad",a.id,b.id]),[a.id]);assert.deepEqual(view.items([null,{id:a.id,kind:"song",title:""}]),[]);
  assert.equal(view.items(Array.from({length:2500},(_,i)=>song(i+100))).length,2000);
  const bindings=Array.from({length:201},(_,i)=>({trackId:id(i+1000),source:song(i+3000)}));
  const bounded=createRecordingView(state({sourceBindings:bindings}),readTaste(),{now});
  assert.deepEqual(bounded.ids([id(1200),id(3200)]),[id(1200),id(3200)]);
});

test("an injected future clock preserves family decay and cooldown relative to that clock",()=>{
  const clock=1800000000000,a=song(1),b=song(2),taste=readTaste();
  taste.entries[a.id]=entry(a,{score:8,at:clock-30*day,lastPlayed:clock-60000});
  const view=createRecordingView(state({favorites:[a],sourceBindings:[{trackId:a.id,source:b}]}),taste,{now:clock});
  assert.equal(view.taste.entries[a.id].score,4);assert.equal(view.taste.entries[a.id].at,clock);
  assert.equal(view.taste.entries[a.id].lastPlayed,clock-60000);
  assert.deepEqual(recommend(view.items([b]),view.taste,view.saved.favorites,{now:clock,random:()=>.5}),[]);
});

test("an unbound view preserves direct ranking and global rejection, hiding, blocking and cooldown",()=>{
  const a=song(1),b=song(2),c=song(3),d=song(4),e=song(5),f=song(6),taste=readTaste();
  taste.entries[a.id]=entry(a,{score:-8,lastPlayed:now-day});
  taste.entries[d.id]=entry(d,{score:4,lastPlayed:now-60000});
  taste.entries[e.id]=entry(e,{score:4,lastPlayed:now-day});
  taste.hiddenSongs=[b.id];taste.blockedArtists=[c.artists[0]];
  const saved=freeze(state({favorites:[e],playlists:[{id:"mix",items:[e,f]}]}));freeze(taste);
  const before=JSON.stringify({saved,taste}),candidates=[a,b,c,d,e,f],view=createRecordingView(saved,taste,{now});
  const options={now,random:()=>.5,limit:10};
  const direct=recommend(candidates,taste,saved.favorites,options),projected=recommend(view.items(candidates),view.taste,view.saved.favorites,options);
  assert.deepEqual(projected,direct);assert.deepEqual(new Set(projected.map(item=>item.id)),new Set([e.id,f.id]));
  assert.equal(JSON.stringify({saved,taste}),before);assert.equal(view.source(a),a);
  assert.notEqual(view.saved,saved);assert.notEqual(view.saved.favorites,saved.favorites);
  assert.notEqual(view.saved.playlists[0],saved.playlists[0]);assert.notEqual(view.saved.playlists[0].items,saved.playlists[0].items);
  assert.notEqual(view.taste,taste);assert.notEqual(view.taste.entries,taste.entries);
});

test("the unbound fast path preserves unknown fields without cloning metadata and bounds candidates",()=>{
  const a=song(1),b=song(2,{title:a.title,artists:a.artists}),extension={payload:"x".repeat(2*1024*1024),callback:()=>true};
  const saved=freeze(state({favorites:[a],extension,interestMixes:[{id:"one",playlistIds:["list"],learnedIds:[a.id]}],sourceBindings:[{trackId:"invalid",source:b}]}));
  const taste=freeze({...readTaste(),extension}),view=createRecordingView(saved,taste,{now});
  assert.equal(view.saved.extension,extension);assert.equal(view.taste.extension,extension);
  assert.equal(view.saved.favorites[0],a);assert.equal(view.items([a])[0],a);
  assert.deepEqual(view.items([a,b,a]).map(item=>item.id),[a.id,b.id]);
  assert.deepEqual(view.ids(["invalid",a.id,b.id,a.id,null]),[a.id,b.id]);
  assert.equal(view.items(Array.from({length:2500},(_,i)=>song(i+100))).length,2000);
  view.saved.favorites.push(b);view.saved.interestMixes[0].learnedIds.push(b.id);
  assert.deepEqual(saved.favorites,[a]);assert.deepEqual(saved.interestMixes[0].learnedIds,[a.id]);
});
