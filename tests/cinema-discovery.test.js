import test from "node:test";
import assert from "node:assert/strict";
import {cinemaInput,createVideoSearch,videoCards} from "../src/cinema-discovery.js";
const tick=()=>new Promise(resolve=>setTimeout(resolve,10));
const entry=(id,title=id)=>({id,title,channel:"Fixture channel",duration:90});
test("Cinema dispatches natural queries and links without searching arbitrary URLs",()=>{
  for(const text of ["space documentary","NASA: space documentary"])assert.equal(cinemaInput(text).kind,"text");
  for(const text of ["https://example.com/a","file:///C:/video.mp4","javascript:alert(1)"])assert.equal(cinemaInput(text).kind,"url");
  assert.deepEqual(cinemaInput("www.youtube.com/watch?v=abcdefghijk"),{kind:"url",value:"https://www.youtube.com/watch?v=abcdefghijk"});
  assert.equal(cinemaInput(" ").kind,"empty");
});
test("metadata cards are bounded, deduplicated and exclude current/unavailable videos",()=>{
  const rows=[entry("abcdefghijk"),entry("abcdefghijk"),entry("differentID"),{...entry("unavailable"),unavailable:true},entry("invalid")];
  assert.deepEqual(videoCards(rows,"differentID").map(x=>x.id),["abcdefghijk"]);
  assert.equal(videoCards(Array.from({length:40},(_,i)=>entry(String(i).padStart(11,"0")))).length,20);
});
test("search waits for cancellation and discards late results, cached hits make no request",async()=>{
  const calls=[],cancels=[],requests=[];
  const search=createVideoSearch((name,args)=>{calls.push(name);return new Promise(resolve=>(name==="cinema_cancel_search"?cancels:requests).push({resolve,args}));},"home",{delay:0});
  const a=search.search("A");await tick();assert.deepEqual(calls,["cinema_cancel_search"]);
  cancels.shift().resolve();await tick();assert.equal(requests[0].args.query,"A");
  const b=search.search("B");assert.equal(await a,null);await tick();cancels.shift().resolve();await tick();
  requests[1].resolve([entry("bbbbbbbbbbb")]);assert.equal((await b)[0].id,"bbbbbbbbbbb");requests[0].resolve([entry("aaaaaaaaaaa")]);await tick();
  const hit=await search.search("B");assert.equal(hit[0].id,"bbbbbbbbbbb");assert.equal(requests.length,2);
  await tick();cancels.shift().resolve();
});
test("debounced edits issue one metadata request; cache expires and evicts old queries",async()=>{
  let now=0;const calls=[];const search=createVideoSearch(async(name,args)=>{if(name==="cinema_search"){calls.push(args.query);return [entry("abcdefghijk")];}},"topic",{delay:15,now:()=>now});
  const a=search.search("A"),b=search.search("B"),c=search.search("C");assert.equal(await a,null);assert.equal(await b,null);await c;assert.deepEqual(calls,["C"]);
  await search.search("C");assert.equal(calls.length,1);now=600001;await search.search("C",{immediate:true});assert.equal(calls.length,2);
  for(let i=0;i<13;i++)await search.search(String(i),{immediate:true});await search.search("C",{immediate:true});assert.equal(calls.at(-1),"C");
});
