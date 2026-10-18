import test from "node:test";
import assert from "node:assert/strict";
import {downloadMusic} from "../src/music-download.js";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {resolveRecordingSource} from "../src/music-recordings.js";

const item={kind:"song",id:"5NV6Rdv1a3I",title:"Get Lucky",artists:["Daft Punk"]};
const settings={folder:"/downloads",cookiesMode:"file",cookies:"/cookies.txt",signedInPath:"/account.txt",
  sponsorblock:false,archive:true,rateMbps:0,folderRule:"manual",nameRule:"title",parallel:2,autoRetry:true};
test("music downloads preflight then enqueue one complete MP3 without a draft clip or schedule",async()=>{
  const calls=[];const invoke=async(name,args)=>{calls.push({name,args});return name==="preflight_download"?{ready:true}:1;};
  assert.equal(await downloadMusic(invoke,item,{...settings,text:"another link",playlist:true,clipStart:10,scheduledAt:123}),1);
  assert.deepEqual(calls.map(c=>c.name),["preflight_download","enqueue"]);
  const request=calls[1].args;
  assert.equal(request.text,"https://www.youtube.com/watch?v=5NV6Rdv1a3I");
  assert.equal(request.options.quality,"mp3");assert.equal(request.options.playlist,false);
  assert.equal(request.options.clipStart,null);assert.equal(request.scheduledAt,null);assert.equal(request.repeatDaily,false);
  assert.equal(request.options.cookies,"/cookies.txt");assert.equal(request.options.folder,"/downloads");
  assert.equal(request.preserveOptions,true);
});

test("repeated clicks enqueue once and report failures without changing playback",async()=>{
  const source=readFileSync(new URL("../src/devil-music.js",import.meta.url),"utf8");
  const code=source.slice(source.indexOf("  async function downloadTrack("),source.indexOf("  function syncDock()"));
  let finish,calls=0;const notices=[],chosen={...item,id:"abcdefghijk",title:"Get Lucky (Live)"},before=JSON.stringify(item);
  const ctx={saved:{sourceBindings:[{trackId:item.id,track:item,source:chosen}]},resolveRecordingSource,downloadsPending:new Set(),syncDock(){},t:s=>s,errorText:String,status:s=>notices.push(s),presentation:{notify(){}},
    onDownload:selected=>{assert.equal(selected,chosen);calls++;return new Promise(resolve=>{finish=resolve;});}};
  const download=runInNewContext(`(()=>{${code};return downloadTrack;})()`,ctx);
  const first=download(item);await download(item);assert.equal(calls,1);finish(1);await first;
  assert.equal(ctx.downloadsPending.size,0);assert.match(notices.at(-1),/MP3 added/);
  ctx.onDownload=()=>Promise.reject(Error("Disk full"));await download(item);
  assert.match(notices.at(-1),/Disk full$/);assert.equal(ctx.downloadsPending.size,0);assert.equal(JSON.stringify(item),before);
});
test("preflight blockers and backend errors do not silently add a download",async()=>{
  let calls=0;await assert.rejects(downloadMusic(async()=>{calls++;return {ready:false,blockers:["Folder is not writable"]};},item,settings),/Folder is not writable/);
  assert.equal(calls,1);
  await assert.rejects(downloadMusic(async()=>{throw Error("Disk unavailable");},item,settings),/Disk unavailable/);
  await assert.rejects(downloadMusic(undefined,item,settings),/installed Deviload/);
});
test("only valid songs download and browser sessions never inherit another cookie source",async()=>{
  for(const value of [{kind:"album",id:item.id},{kind:"song",id:"bad&url"}])await assert.rejects(downloadMusic(()=>assert.fail("must not invoke"),value,settings),/Invalid music/);
  const calls=[];await downloadMusic(async(name,args)=>{calls.push(args);return name==="preflight_download"?{ready:true}:0;},item,{...settings,cookiesMode:"firefox"});
  assert.equal(calls[1].options.cookies,"");assert.equal(calls[1].options.cookiesBrowser,"firefox");assert.equal(calls[1].options.cookiesAccount,false);
});
