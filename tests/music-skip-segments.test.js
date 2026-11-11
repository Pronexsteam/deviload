import test from "node:test";
import assert from "node:assert/strict";
import {segmentsFor,segmentJump,createSegmentSkip} from "../src/music-skip-segments.js";

const data={duration:212.9,segments:[{start:0,end:14,category:"music_offtopic"},{start:200,end:212.5,category:"music_offtopic"}]};
test("marks for a different cut of the video are never applied",()=>{
  assert.equal(segmentsFor(data,213).length,2);assert.equal(segmentsFor(data,180).length,0);
  assert.equal(segmentsFor(data,NaN).length,0);assert.equal(segmentsFor({segments:[{start:5,end:5.5}]},100).length,0);
  assert.equal(segmentsFor({duration:0,segments:data.segments},300).length,2,"unknown marked length still applies");
});
test("each part is skipped once, an outro ends the song and seeking back plays it",()=>{
  const list=segmentsFor(data,213),skipped=new Set();
  assert.equal(segmentJump(list,.2,213,skipped),14);assert.equal(segmentJump(list,3,213,skipped),null,"seeking back into a skipped intro plays it");
  assert.equal(segmentJump(list,100,213,skipped),null);assert.equal(segmentJump(list,200.1,213,skipped),213);
  assert.equal(segmentJump(list,13.8,213,new Set()),null,"the last half second is not worth a jump");
});
test("a guest, a disabled setting or a non-YouTube id never skips or asks the service",async()=>{
  const calls=[];let enabled=true,allowed=true;
  const skip=createSegmentSkip({invoke:async(command,args)=>{calls.push(args.id);return data;},enabled:()=>enabled,allowed:()=>allowed});
  skip.load("local:abc");skip.load("../../etc/pa");assert.deepEqual(calls,[]);
  skip.load("dQw4w9WgXcQ");await new Promise(r=>setImmediate(r));
  const audio={paused:false,seeking:false,duration:213,currentTime:1};
  allowed=false;skip.check(audio);assert.equal(audio.currentTime,1);
  allowed=true;enabled=false;skip.check(audio);assert.equal(audio.currentTime,1);
  enabled=true;skip.check(audio);assert.equal(audio.currentTime,14);
  skip.load("dQw4w9WgXcQ");assert.deepEqual(calls,["dQw4w9WgXcQ"],"answers are cached");
  enabled=false;skip.load("zzzzzzzzzzz");assert.equal(calls.length,1);
});
test("a late answer for a previous song is not applied to the next one",async()=>{
  let release;const skip=createSegmentSkip({invoke:()=>new Promise(r=>release=r),enabled:()=>true});
  skip.load("aaaaaaaaaaa");skip.load("local:song");release(data);await new Promise(r=>setImmediate(r));
  const audio={paused:false,seeking:false,duration:213,currentTime:1};skip.check(audio);assert.equal(audio.currentTime,1);
});
