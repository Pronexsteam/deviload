import test from "node:test";
import assert from "node:assert/strict";
import {createMusicClip} from "../src/music-clip.js";

const memory=()=>{const map=new Map();return {getItem:key=>map.has(key)?map.get(key):null,setItem:(key,value)=>map.set(key,String(value)),removeItem:key=>map.delete(key)};};
const settle=()=>new Promise(resolve=>setTimeout(resolve,0));

// The clip only touches window and document listeners while it is created.
globalThis.addEventListener??=()=>{};globalThis.document??={addEventListener(){},hidden:false};

test("a music video found in one window is reused by the other without searching again", async () => {
  const storage=memory(),calls=[];
  const invoke=async(command,args)=>{calls.push([command,args]);if(command==="music_catalog")return {sections:[{items:[{id:"AbCdEfGhIjK",kind:"song",title:"Believer (Official Music Video)",artists:["Imagine Dragons"],duration:"3:37"}]}]};return {url:"http://127.0.0.1/clip"};};
  const song={id:"song-1",title:"Believer",artists:["Imagine Dragons"],duration:216};
  createMusicClip({invoke,language:()=>"en",storage}).prepare(song);
  await settle();await settle();
  const searches=()=>calls.filter(([command])=>command==="music_catalog").length;
  assert.equal(searches(),1);
  createMusicClip({invoke,language:()=>"en",storage}).prepare(song);
  await settle();await settle();
  assert.equal(searches(),1);
  assert.deepEqual(calls.filter(([command])=>command==="music_clip_stream").map(([,args])=>args.id),["AbCdEfGhIjK","AbCdEfGhIjK"]);
});
