import test from "node:test";
import assert from "node:assert/strict";
// The module's translations read the page language at import time.
globalThis.document??={documentElement:{lang:"en"},createElement:()=>({})};
const {scrobblePoint,createPlayTracker,scrobbleTrack,wireScrobbling}=await import("../src/music-scrobble.js");

test("a song counts after half its length or four minutes, never under 30 seconds",()=>{
  assert.equal(scrobblePoint(200),100);assert.equal(scrobblePoint(900),240);assert.equal(scrobblePoint(29),Infinity);assert.equal(scrobblePoint(NaN),Infinity);
});
const run=(tracker,key,from,to,{duration=200,step=.25,playing=true}={})=>{const events=[];for(let time=from;time<=to;time+=step){const e=tracker.step({key,time,duration,playing,now:1000+time});if(e)events.push([e,Math.round(time)]);}return events;};
test("only forward playback counts, so seeking ahead never fakes a listen",()=>{
  const tr=createPlayTracker();
  assert.deepEqual(run(tr,"a",0,10),[["start",0]]);
  tr.step({key:"a",time:150,duration:200,playing:true,now:1200});
  assert.deepEqual(run(tr,"a",150,190),[],"40 heard seconds after a jump are not half of the song");
  assert.deepEqual(run(tr,"b",0,101),[["start",0],["listen",100]]);assert.equal(tr.startedAt,1000);
  assert.deepEqual(run(tr,"b",101,150),[],"one play is sent once");
});
test("a paused song does not count and a repeated song is a new play",()=>{
  const tr=createPlayTracker();
  assert.deepEqual(run(tr,"a",0,120,{playing:false}),[]);
  assert.deepEqual(run(tr,"a",120,199),[["start",120]]);
  assert.deepEqual(run(tr,"a",0,101),[["start",0],["listen",100]]);
});
test("track details use the main artist and drop empty fields",()=>{
  assert.deepEqual(scrobbleTrack({id:"dQw4w9WgXcQ",title:"Song",artists:["Main","Guest"],album:{title:"Record"}},200.4,55),{title:"Song",artist:"Main",album:"Record",duration:200.4,at:55,id:"dQw4w9WgXcQ"});
  assert.equal(scrobbleTrack({title:"Song",artists:[]},200,1),null);
  assert.deepEqual(scrobbleTrack({id:"local:x",title:"S",artist:"A"},NaN,0),{title:"S",artist:"A",id:"local:x"});
});
function harness({account=true,privateSession=false}={}){
  const listeners=[],calls=[];
  const node={paused:false,seeking:false,duration:200,currentTime:0,addEventListener:(name,fn)=>name==="timeupdate"&&listeners.push(fn)};
  const element=()=>({children:[],dataset:{},append(...n){this.children.push(...n);},replaceChildren(...n){this.children=n;},addEventListener(){},insertBefore(n){this.children.push(n);}});
  globalThis.document={createElement:element};
  const invoke=async(command,args)=>{calls.push([command,args]);return command==="scrobble_status"?{listenbrainz:account?"me":null,lastfm:null,lastfmAvailable:false,pending:0}:null;};
  wireScrobbling({invoke,host:element(),nodes:[node],getAudio:()=>node,getTrack:()=>({id:"dQw4w9WgXcQ",title:"Song",artists:["Artist"]}),isPrivate:()=>privateSession});
  const play=async(to)=>{for(let time=0;time<=to;time+=.25){node.currentTime=time;listeners.forEach(fn=>fn());}await new Promise(r=>setImmediate(r));};
  return {calls,play};
}
test("listens go out only with a connected account and never from a private session",async()=>{
  const on=harness();await new Promise(r=>setImmediate(r));await on.play(101);
  assert.deepEqual(on.calls.map(c=>c[0]).filter(c=>c!=="scrobble_status"),["scrobble_now_playing","scrobble_listen"]);
  assert.equal(on.calls.find(c=>c[0]==="scrobble_listen")[1].track.artist,"Artist");
  const hidden=harness({privateSession:true});await new Promise(r=>setImmediate(r));await hidden.play(101);
  assert.deepEqual(hidden.calls.map(c=>c[0]),["scrobble_status"]);
  const none=harness({account:false});await new Promise(r=>setImmediate(r));await none.play(101);
  assert.deepEqual(none.calls.map(c=>c[0]),["scrobble_status"]);
});
