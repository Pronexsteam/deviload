import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
const lyricCode=readFileSync(new URL("../src/music-lyrics.js",import.meta.url),"utf8");
const parseLyrics=runInNewContext(`(()=>{${lyricCode.slice(lyricCode.indexOf('export function parseLyrics'),lyricCode.indexOf('export function createMusicLyrics')).replace('export ','')};return parseLyrics;})()`);
const soundCode=readFileSync(new URL("../src/music-sound.js",import.meta.url),"utf8");
const soundSettings=runInNewContext(`(()=>{${soundCode.slice(soundCode.indexOf('const frequencies'),soundCode.indexOf('export function createMusicSound')).replace('export ','')};return soundSettings;})()`);
const source=readFileSync(new URL("../src/devil-music.js",import.meta.url),"utf8");
function paging(invoke){const ctx={request:1,continuation:"page2",morePending:false,sections:[{title:"",items:[{id:"one"}]}],lastQuery:{kind:"search",value:"artist"},searchFilter:"songs",language:()=>"en",invoke,render(){},status(message){ctx.message=message;},errorText:String};return {ctx,load:runInNewContext(`(()=>{${source.slice(source.indexOf('  async function loadMore()'),source.indexOf('  function trackRow('))};return loadMore;})()`,ctx)};}
test("search continuation appends distinct results and retries the same page after failure",async()=>{
  let fails=true;const requests=[];const p=paging(async(_,args)=>{requests.push(args);if(fails)throw Error("offline");return {sections:[{items:[{id:"one"},{id:"two"}]}],continuation:"page3"};});
  await p.load();assert.equal(p.ctx.sections.length,1);assert.equal(p.ctx.continuation,"page2");assert.equal(p.ctx.morePending,false);
  fails=false;await p.load();assert.equal(p.ctx.sections[1].items.length,1);assert.equal(p.ctx.sections[1].items[0].id,"two");assert.equal(p.ctx.continuation,"page3");assert.equal(requests[1].filter,"songs");
});
test("a late search page cannot overwrite another view",async()=>{
  let resolve;const p=paging(()=>new Promise(r=>resolve=r)),job=p.load();p.ctx.request++;p.ctx.sections=[];p.ctx.morePending=false;
  resolve({sections:[{items:[{id:"old"}]}],continuation:null});await job;assert.equal(p.ctx.sections.length,0);
});
test("timed lyrics preserve repeated lines, sort timestamps and reject invalid metadata",()=>{
  assert.deepEqual(JSON.parse(JSON.stringify(parseLyrics('[ar:artist]\n[00:02.50][00:20.00]Repeat\n[00:01.00]First'))),[{at:1,text:"First"},{at:2.5,text:"Repeat"},{at:20,text:"Repeat"}]);
  assert.equal(parseLyrics(null).length,0);assert.equal(parseLyrics('[999999:01]bad').length,0);
});
test("untrusted sound settings cannot enable arbitrary gains or transitions",()=>{
  assert.deepEqual(JSON.parse(JSON.stringify(soundSettings({preset:"evil",soft:"true",transition:999}))),{preset:"flat",soft:false,transition:0});
});
test("an existing download takes priority over the network and a missing file falls back",async()=>{
  const calls=[],ctx={window:{__TAURI__:{core:{convertFileSrc:path=>`asset:${path}`}}},invoke:async(command,args)=>{calls.push(command);return command==="music_offline_source"?"local.mp3":{url:"remote"};}};
  const resolve=runInNewContext(`(()=>{${source.slice(source.indexOf('  async function playbackSource('),source.indexOf('  async function showOffline('))};return playbackSource;})()`,ctx);
  assert.equal((await resolve("abcdefghijk")).url,"asset:local.mp3");assert.deepEqual(calls,["music_offline_source"]);
  ctx.invoke=async command=>command==="music_offline_source"?null:{url:"remote"};assert.equal((await resolve("abcdefghijk")).url,"remote");
});
