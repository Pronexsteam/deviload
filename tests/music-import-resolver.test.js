import test from "node:test";
import assert from "node:assert/strict";
import {resolveMusicImport,resolveMusicImportLibrary,readPlaylistLink} from "../src/music-import-resolver.js";
import {parseMusicImport} from "../src/music-import-format.js";
const delay=()=>Promise.resolve(),song=(n=1)=>({kind:"song",id:String(n).padStart(11,"0"),title:"Song "+n,artists:["Artist"],subtitle:"Artist"}),entry=n=>({key:"source:"+n,title:"Song "+n,artists:["Artist"],liked:false,plays:0});
const catalog=items=>({sections:[{items}]}),link="https://music.youtube.com/playlist?list=PLabcdefghijk123";

test("large imports traverse all batches once with global progress and stable ordering",async()=>{
  const entries=Array.from({length:6001},(_,i)=>entry(i+1)),progress=[],seen=[];let calls=0;
  const rows=await resolveMusicImportLibrary(entries,{delay,invoke:async(_,args)=>{calls++;return catalog([song(Number(args.value.match(/Song (\d+)/)[1]))]);},onRow:(row,index)=>seen.push(index),onProgress:(done,total)=>progress.push([done,total])});
  assert.equal(calls,6001);assert.equal(rows.length,6001);assert.deepEqual(rows.map(r=>r.entry.key),entries.map(e=>e.key));assert.equal(new Set(seen).size,6001);
  assert.deepEqual(progress.at(-1),[6001,6001]);assert.ok(progress.every(([n])=>n>=1&&n<=6001));
});

test("large imports stop before later batches on rate limits or user cancellation",async()=>{
  const entries=Array.from({length:1200},(_,i)=>entry(i));let calls=0;
  const rows=await resolveMusicImportLibrary(entries,{delay,concurrency:1,invoke:async()=>{calls++;throw Error('429');}});
  assert.equal(calls,1);assert.equal(rows.length,500);
  const controller=new AbortController();calls=0;
  await assert.rejects(resolveMusicImportLibrary(entries,{delay,concurrency:1,signal:controller.signal,invoke:async()=>{calls++;return catalog([song(calls-1)]);},onProgress:n=>{if(n===500)controller.abort();}}),{name:'AbortError'});
  assert.equal(calls,500);
});

test("known YouTube songs need no requests; unknown IDs request radio and match only exact ID",async()=>{
  let calls=0;const rows=await resolveMusicImport([{...entry(1),videoId:song(1).id},{...entry(2),title:"",videoId:song(2).id}],{delay,concurrency:1,invoke:async(command,args)=>{calls++;assert.equal(command,"music_catalog");assert.equal(args.kind,"radio");assert.equal(args.value,song(2).id);return catalog([song(3),song(2)]);}});
  assert.equal(calls,1);assert.deepEqual(rows.map(row=>row.confidence),["exact","exact"]);assert.equal(rows[1].item.id,song(2).id);
});
test("Spotify matching with concurrency one is paced, language-aware and song-only",async()=>{
  const events=[],progress=[];let active=0;
  const rows=await resolveMusicImport([entry(1),entry(2)],{language:"ru",concurrency:1,delay:async ms=>{assert.equal(ms,150);events.push("delay");},onProgress:(done,total)=>progress.push([done,total]),invoke:async(command,args)=>{assert.equal(++active,1);assert.equal(args.kind,"search");assert.equal(args.filter,"songs");assert.equal(args.language,"ru");assert.ok(args.value.length<=120);events.push(args.value);await Promise.resolve();active--;return catalog([song(events.length===1?1:2)]);}});
  assert.deepEqual(events,["Song 1 Artist","delay","Song 2 Artist"]);assert.deepEqual(progress,[[1,2],[2,2]]);assert.ok(rows.every(row=>row.confidence==="exact"));
});
test("429 stops all subsequent requests and ordinary failures stop after three attempts",async()=>{
  let count=0;const rows=await resolveMusicImport([entry(1),entry(2),entry(3)],{delay,concurrency:1,invoke:async()=>{count++;throw Error("HTTP 429");}});
  assert.equal(count,1);assert.ok(rows.every(row=>row.confidence==="none"&&/rate-limited/.test(row.error)));
  count=0;await assert.rejects(resolveMusicImport([entry(1),entry(2),entry(3),entry(4)],{delay,concurrency:1,invoke:async()=>{count++;throw Error("offline");}}),/repeated connection errors/);assert.equal(count,3);
});
test("canceling pending lookup returns no late results or further requests",async()=>{
  const controller=new AbortController();let release,calls=0,started;const begun=new Promise(resolve=>{started=resolve;});
  const pending=resolveMusicImport([entry(1),entry(2)],{delay,concurrency:1,signal:controller.signal,invoke:()=>{calls++;started();return new Promise(resolve=>{release=resolve;});}});
  await begun;controller.abort();await assert.rejects(pending,{name:"AbortError"});release(catalog([song(1)]));await Promise.resolve();assert.equal(calls,1);
  await assert.rejects(resolveMusicImport(Array.from({length:501},(_,i)=>entry(i)),{invoke:()=>{throw Error("must not request");}}),/500/);
});
test("playlist pagination deduplicates IDs, keeps source evidence and reports repeated tokens",async()=>{
  let page=0;const result=await readPlaylistLink(link,{delay,concurrency:1,invoke:async(command,args)=>{assert.equal(args.value,"VLPLabcdefghijk123");assert.equal(args.kind,"browse");page++;return {...catalog(page===1?[song(1)]:[song(1),song(2)]),continuation:"same"};}});
  assert.equal(page,2);assert.equal(result.entries.length,2);assert.ok(result.entries.every(row=>!row.liked&&row.plays===0));assert.match(result.warnings[0],/pagination repeated/);assert.deepEqual(result.playlists[0].keys,result.entries.map(row=>row.key));
});
test("playlist links reject private shortcuts, spoofed hosts, credentials and unrelated URLs",async()=>{
  for(const url of ["http://music.youtube.com/playlist?list=PLabcdefghijk123",link.replace("music.youtube.com","music.youtube.com.evil.test"),"https://x@youtube.com/playlist?list=PLabcdefghijk123","https://youtube.com/playlist?list=LL","https://youtube.com/playlist?list=WL","https://youtube.com/playlist?list=RDinvalid","https://youtube.com/watch?v=abcdefghijk","file:///secret"]){await assert.rejects(readPlaylistLink(url,{invoke:()=>{throw Error("must not invoke");}}),/public YouTube playlist or Mix/);}
});

test("Spotify album share links use the native metadata reader",async()=>{
 const result={source:'spotify',name:'MUSIC - SORRY 4 DA WAIT',entries:[entry(1)],playlists:[],warnings:[]};
 const value=await readPlaylistLink('https://open.spotify.com/album/7sFZGbkCitoqQz7Rt3LoKg?si=share',{invoke:async(command,args)=>{assert.equal(command,'music_import_spotify_playlist');assert.match(args.link,/\/album\//);return result;}});
 assert.equal(value.name,result.name);assert.equal(value.entries.length,1);assert.equal(value.completeness,'unknown');
});

test("Mix import retains the supplied playlist and video, bounds the snapshot and skips matching",async()=>{
 let requests=0;
 const result=await readPlaylistLink('https://www.youtube.com/watch?v=kpafW1g-Arg&list=RDajBoh2XK6kU&index=2',{delay,invoke:async(command,args)=>{
   assert.equal(args.kind,'mix');assert.deepEqual(JSON.parse(args.value),{playlistId:'RDajBoh2XK6kU',videoId:'kpafW1g-Arg'});
   const offset=60*requests++;return {...catalog(Array.from({length:70},(_,i)=>song(i+offset))),continuation:'page'+requests};
 }});
 assert.equal(requests,2);assert.equal(result.entries.length,100);assert.match(result.warnings[0],/will not update automatically/);
 const rows=await resolveMusicImport(result.entries,{invoke:()=>assert.fail('known Mix songs need no matching')});assert.equal(rows.length,result.entries.length);
});

test("Mix pages stop at 100 songs and cancellation suppresses late results",async()=>{
 let page=0;
 const result=await readPlaylistLink('https://youtu.be/kpafW1g-Arg?list=RDajBoh2XK6kU',{delay,invoke:async()=>{const offset=60*page++;return {...catalog(Array.from({length:60},(_,i)=>song(i+offset))),continuation:'more'+page};}});
 assert.equal(result.entries.length,100);
 const controller=new AbortController();let finish;
 const pending=readPlaylistLink('https://youtube.com/playlist?list=RDajBoh2XK6kU',{signal:controller.signal,invoke:()=>new Promise(resolve=>finish=resolve)});
 controller.abort();await assert.rejects(pending,{name:'AbortError'});finish(catalog([song(1)]));
 for(const bad of ['https://youtube.com/watch?v=bad&list=RDajBoh2XK6kU','https://youtube.com/watch?v=kpafW1g-Arg&v=ajBoh2XK6kU&list=RDajBoh2XK6kU'])await assert.rejects(readPlaylistLink(bad,{invoke:()=>assert.fail('invalid Mix')}),/public YouTube/);
});
test("playlist import reads beyond former page and song caps and marks partial failures",async()=>{
  let page=0;const pages=await readPlaylistLink(link,{delay,concurrency:1,invoke:async()=>({...catalog([song(++page)]),continuation:page<12?"next"+page:undefined})});assert.equal(page,12);assert.equal(pages.warnings.length,0);
  const songs=await readPlaylistLink(link,{delay,concurrency:1,invoke:async()=>catalog(Array.from({length:501},(_,i)=>song(i)))});assert.equal(songs.entries.length,501);assert.equal(songs.warnings.length,0);
  page=0;const partial=await readPlaylistLink(link,{delay,concurrency:1,invoke:async()=>{if(page++)throw Error("429 too many requests");return {...catalog([song(1)]),continuation:"second"};}});assert.equal(page,2);assert.equal(partial.entries.length,1);assert.match(partial.warnings[0],/rate-limited/);
});

test("Spotify public links use the bounded native reader and retain names and partial warnings",async()=>{
 const result={source:"spotify",name:"My list",entries:[entry(1)],playlists:[],warnings:["partial"]};
 const value=await readPlaylistLink("https://open.spotify.com/playlist/37i9dQZF1DZ06evO3eIivx?si=share",{invoke:async(command,args)=>{assert.equal(command,"music_import_spotify_playlist");assert.match(args.link,/open.spotify.com/);return result;}});
 assert.equal(value.name,"My list");assert.deepEqual(value.warnings,["partial"]);assert.equal(value.completeness,'unknown');
 for(const bad of ["https://open.spotify.com/collection/tracks","https://user@open.spotify.com/playlist/37i9dQZF1DZ06evO3eIivx","http://open.spotify.com/playlist/37i9dQZF1DZ06evO3eIivx"]){await assert.rejects(readPlaylistLink(bad,{invoke:()=>assert.fail("must not request")}),/public Spotify/);}
});
test("canceled Spotify reads cannot return late imports",async()=>{
 const controller=new AbortController();let finish;
 const pending=readPlaylistLink("https://open.spotify.com/playlist/37i9dQZF1DZ06evO3eIivx",{signal:controller.signal,invoke:()=>new Promise(resolve=>{finish=resolve;})});controller.abort();await assert.rejects(pending,{name:"AbortError"});finish({entries:[entry(1)]});
});

test("matching caps concurrency at three, streams progress, preserves order and caches repeated lookups",async()=>{
 let active=0,peak=0,calls=0;const completed=[];
 const invoke=async(command,args)=>{calls++;active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,args.value.startsWith("Song 1 ")?30:5));active--;return catalog([song(Number(args.value.match(/Song (\d+)/)[1]))]);};
 const entries=[entry(1),entry(2),entry(3),entry(4)];
 const rows=await resolveMusicImport(entries,{invoke,delay,onRow:(row,index)=>completed.push(index)});
 assert.equal(peak,3);assert.equal(calls,4);assert.notEqual(completed[0],0);assert.deepEqual(rows.map(r=>r.entry.key),entries.map(r=>r.key));
 await resolveMusicImport(entries,{invoke,delay});assert.equal(calls,4);
});
test("concurrent 429 stops scheduling further requests",async()=>{
 let calls=0;const rows=await resolveMusicImport(Array.from({length:20},(_,i)=>entry(i+1)),{delay,invoke:async()=>{calls++;throw Error("429");}});
 assert.ok(calls<=3);assert.equal(rows.length,20);assert.ok(rows.every(row=>/rate-limited/.test(row.error)));
});

test("1500-song link/file normalization shares matches and warm cache without assuming completeness",async context=>{
 const original=Array.from({length:1500},(_,i)=>entry(i+1)),started=performance.now();
 const publicList=await readPlaylistLink('https://open.spotify.com/playlist/37i9dQZF1DZ06evO3eIivx',{invoke:async()=>({source:'spotify',name:'Liked songs',entries:original,playlists:[],warnings:[]})});
 const file=parseMusicImport(JSON.stringify({tracks:original}),'playlist.json');
 assert.deepEqual(publicList.entries,file.entries);assert.equal(publicList.completeness,'unknown');
 assert.ok(publicList.entries.every(e=>!e.liked));
 let calls=0;const invoke=async(_,args)=>{calls++;return catalog([song(Number(args.value.match(/Song (\d+)/)[1]))]);};
 const cold=await resolveMusicImportLibrary(publicList.entries,{invoke,delay});const coldMs=performance.now()-started;
 const warmStart=performance.now();const warm=await resolveMusicImportLibrary(file.entries,{invoke,delay});
 assert.equal(cold.length,1500);assert.equal(warm.length,1500);assert.equal(calls,1500);
 assert.deepEqual(warm.map(r=>r.item.id),cold.map(r=>r.item.id));
 context.diagnostic(`Fixture only, network and pacing mocked: cold ${coldMs.toFixed(1)} ms, warm ${(performance.now()-warmStart).toFixed(1)} ms; 1500 then 0 lookups.`);
});
