import test from "node:test";
import assert from "node:assert/strict";

globalThis.document={documentElement:{}};
globalThis.window={__TAURI__:{core:{invoke(){}}}};
const {createMusicPresence}=await import("../src/music-presence.js");
const settle=()=>new Promise(resolve=>setImmediate(resolve));

function setup(invoke=async()=>true,enabled=true){
  const input={addEventListener(_,fn){this.change=fn;}},notice={};
  document.getElementById=id=>id.endsWith("notice")?notice:input;
  const state={playing:true,privateSession:false,title:"Song",artist:"Artist",image:"https://i.ytimg.com/vi/abcdefghijk/default.jpg",position:42,duration:180};
  const calls=[];
  const presence=createMusicPresence({invoke:(command,args)=>{calls.push(args.presence);return invoke(command,args);},storage:{getItem:()=>String(enabled),setItem(){}},getPlayback:()=>state});
  return {presence,state,calls,input,notice};
}

test("Discord receives no song metadata while paused, disabled or private",async()=>{
  const p=setup();await p.presence.sync();assert.equal(p.calls.at(-1).title,"Song");
  p.state.playing=false;await p.presence.sync();assert.equal(p.calls.at(-1).playing,false);
  assert.equal(p.calls.at(-1).title,"");assert.equal(p.calls.at(-1).position,0);
  p.state.playing=true;p.state.privateSession=true;await p.presence.sync();
  assert.equal(p.calls.at(-1).title,"");assert.equal(p.calls.at(-1).image,"");
  p.state.privateSession=false;p.input.checked=false;p.input.change();await settle();
  assert.equal(p.calls.at(-1).enabled,false);assert.equal(p.calls.at(-1).artist,"");
});

test("a private session entered during an in-flight Discord update sends a clear next",async()=>{
  let complete;const p=setup(()=>p.calls.length===1?new Promise(resolve=>complete=resolve):Promise.resolve(true));
  const initial=p.presence.sync();p.state.privateSession=true;await p.presence.sync(true);
  assert.equal(p.calls.length,1);complete(true);await initial;await settle();
  assert.equal(p.calls.length,2);assert.equal(p.calls[1].playing,false);assert.equal(p.calls[1].title,"");
});

test("unchanged Discord updates are throttled but track changes and seeks are delivered",async()=>{
  const p=setup();await p.presence.sync();await p.presence.sync();assert.equal(p.calls.length,1);
  p.state.title="Another song";await p.presence.sync();assert.equal(p.calls.length,2);
  p.state.position=100;await p.presence.sync(true);assert.equal(p.calls.at(-1).position,100);
});
