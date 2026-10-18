import test from "node:test";
import assert from "node:assert/strict";
import {createMusicDiagnostics,playbackErrorCode,playbackFailure} from "../src/music-diagnostics.js";

test("diagnostics retain bounded fixed facts without arbitrary source errors or metadata",()=>{
  let now=100000;const diagnostics=createMusicDiagnostics({now:()=>now});
  for(let i=0;i<150;i++){now+=1100;diagnostics.record("source","requested");diagnostics.error("resolve",Error("Network failed https://audio.example/?token=secret C:/Users/Sam/private.mp3 Cookie: private"));}
  const events=diagnostics.snapshot(),text=JSON.stringify(events);assert.equal(events.length,80);
  assert.ok(events.every(event=>Object.keys(event).sort().join(",")==="at,code,elapsedMs,stage"));
  assert.ok(!/secret|https|Users|Cookie|private|audio.example/.test(text));assert.equal(events.at(-1).code,"network");
  assert.equal(diagnostics.record("https://secret","failed"),false);assert.equal(diagnostics.record("source","token=secret"),false);
  events[0].code="changed";assert.notEqual(diagnostics.snapshot()[0].code,"changed");
  now+=2*60*60*1000+1;assert.deepEqual(diagnostics.snapshot(),[]);
});
test("playback issue messages classify engine, network, source and decoder failures without raw errors",()=>{
  for(const [input,code]of [["HTTP429 token=secret","limited"],["403 sign in","restricted"],["Music engine timed out","timeout"],["Could not start music engine","worker_stopped"],["Music engine is busy","busy"],["MEDIA_ERR_DECODE","decode"],["NotSupportedError","unsupported"],["DNS connection failed","network"],["Cancelled","cancelled"],["an unknown issue C:/secret","failed"]]){
    assert.equal(playbackErrorCode(input),code);assert.equal(playbackFailure(input).code,code);assert.ok(!/token=|C:\//.test(playbackFailure(input).message));
  }
});
test("duplicate stages coalesce and timings remain bounded",()=>{
  let now=10;const diagnostics=createMusicDiagnostics({now:()=>now,limit:3});
  diagnostics.record("source");assert.equal(diagnostics.record("source"),false);now+=400000;
  diagnostics.record("resolve","ready");assert.equal(diagnostics.snapshot().at(-1).elapsedMs,300000);
  now=NaN;assert.equal(diagnostics.record("start"),false);
});

test("source restrictions preserve distinct sign-in, unavailable, denied and regional guidance",()=>{
  for(const message of ["Playback restricted: YouTube requires sign-in or verification. Try another track.","Playback restricted: this track is unavailable from YouTube. Try another track.","Playback restricted: YouTube denied access to the audio. Try another track.","Playback restricted: this track is unavailable in your region. Try another track."]){assert.equal(playbackFailure(message).message,message);}
  assert.match(playbackFailure("UNPLAYABLE https://example/?token=secret").message,/unavailable from YouTube/);
  assert.match(playbackFailure("403 cookie=secret").message,/denied access/);
  assert.match(playbackFailure("LOGIN_REQUIRED token=secret").message,/sign-in/);
});
