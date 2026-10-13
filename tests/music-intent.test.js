import test from "node:test";
import assert from "node:assert/strict";
import {createMusicIntent} from "../src/music-intent.js";

function harness(prepare=async()=>{}){
  let time=0,allowed=true,serial=0;const timers=new Map(),calls=[];
  const intent=createMusicIntent({prepare:async id=>{calls.push(id);await prepare(id);},allowed:()=>allowed,now:()=>time,
    schedule:fn=>{timers.set(++serial,fn);return serial;},cancel:id=>timers.delete(id)});
  return {intent,calls,allow:value=>allowed=value,advance:ms=>time+=ms,
    async fire(){const pending=[...timers.values()];timers.clear();await Promise.all(pending.map(fn=>fn()));}};
}
test("passing over cards does not resolve audio; deliberate focus prepares only the final card",async()=>{
  const p=harness();p.intent.enter("aaaaaaaaaaa");p.intent.leave();await p.fire();assert.deepEqual(p.calls,[]);
  p.intent.enter("aaaaaaaaaaa");p.intent.enter("bbbbbbbbbbb");await p.fire();assert.deepEqual(p.calls,["bbbbbbbbbbb"]);
  p.intent.enter("bbbbbbbbbbb");await p.fire();assert.equal(p.calls.length,1);
});
test("intent respects current playback, offline/data-saver eligibility and two requests per minute",async()=>{
  const p=harness();p.intent.enter("aaaaaaaaaaa");p.allow(false);await p.fire();assert.equal(p.calls.length,0);p.allow(true);
  for(const id of ["aaaaaaaaaaa","bbbbbbbbbbb","ccccccccccc"]){p.intent.enter(id);await p.fire();}
  assert.equal(p.calls.length,2);p.advance(60000);p.intent.enter("ccccccccccc");await p.fire();assert.equal(p.calls.length,3);
});
test("failed intent is silent and not repeatedly requested; concurrent preparations are suppressed",async()=>{
  let finish;const p=harness(()=>new Promise((_,reject)=>finish=()=>reject(Error("limited"))));
  p.intent.enter("aaaaaaaaaaa");const running=p.fire();p.intent.enter("bbbbbbbbbbb");await p.fire();assert.equal(p.calls.length,1);
  finish();await running;p.intent.enter("aaaaaaaaaaa");await p.fire();assert.equal(p.calls.length,1);
});
