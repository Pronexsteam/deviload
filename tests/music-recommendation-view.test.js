import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {mergeRecommendationPools,recommendationLabel} from "../src/music-recommendation-view.js";
import {readTaste,tasteSeeds,recommendWithReasons,canonicalArtistKey} from "../src/music-taste.js";
import {tracks} from "../src/music-state.js";
import {createRecommendationSession} from "../src/music-recommendation-session.js";

const song=(n,artist=`Artist ${n}`)=>({id:String(n).padStart(11,"0"),kind:"song",title:`Song ${n}`,artists:[artist]});
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test("candidate pools take equal turns, deduplicate and retain bounded original items",()=>{
  const a=[song(1),song(2),song(3)],b=[song(4),a[0],song(5)],before=JSON.stringify([a,b]);
  const merged=mergeRecommendationPools([a,b]);
  assert.deepEqual(merged.map(item=>item.id),[1,4,2,3,5].map(n=>song(n).id));
  assert.equal(merged[0],a[0]);assert.equal(JSON.stringify([a,b]),before);
  assert.deepEqual(mergeRecommendationPools([a,b],0),[]);
  assert.equal(mergeRecommendationPools([Array.from({length:3000},(_,i)=>song(i))]).length,2000);
});
test("recommendation reasons describe actual local evidence without inventing musical similarity",()=>{
  assert.equal(recommendationLabel({code:"liked"}),"From your liked songs");
  assert.equal(recommendationLabel({code:"followed_artist",artist:"A < B"}),"You follow A < B");
  assert.equal(recommendationLabel({code:"related_artist",artist:"Example"}),"More from Example");
  assert.equal(recommendationLabel({code:"listening_history"}),"From your listening history");
  assert.equal(recommendationLabel({code:"discovery"}),"An artist new to your listening");
  assert.equal(recommendationLabel({code:"server_model"}),"From this station");
});
test("an older home personalization cannot replace a newer taste choice",async()=>{
  const source=readFileSync(new URL("../src/devil-music.js",import.meta.url),"utf8");
  const code=source.slice(source.indexOf("  async function personalize("),source.indexOf("  function prepareHomeSelection("));
  const old=deferred(),fresh=deferred(),rendered=[],ctx={
    personalization:0,request:1,saved:{favorites:[song(1)],recent:[],collections:[]},taste:readTaste(),
    current:null,playbackContext:[],playbackSourceContext:{kind:"manual"},followedCursor:0,privateSession:false,discoveryCandidates:[],sections:[],recommendationSession:createRecommendationSession(),
    recommendationReasons:new Map(),captureListening(){},tasteSeeds,tracks,canonicalArtistKey,
    radio:seed=>seed.id===song(1).id?old.promise:fresh.promise,invoke(){throw Error("no artist request expected");},
    mergeRecommendationPools,recommendWithReasons,recommendationOptions:()=>({random:()=>.5}),homeSections:(_,items)=>items,
    render(){rendered.push(ctx.sections.map(item=>item.id));},prepareHomeSelection(){},language:()=>"en",t:s=>s
  };
  const personalize=runInNewContext(`(()=>{${code};return personalize;})()`,ctx);
  const first=personalize(1,[]);await settle();ctx.saved.favorites=[song(2)];
  const second=personalize(1,[]);await settle();fresh.resolve([song(4)]);await second;
  old.resolve([song(3)]);await first;
  assert.deepEqual(rendered.map(ids=>Array.from(ids)),[[song(4).id]]);
  assert.deepEqual(Array.from(ctx.recommendationReasons.keys()),[song(4).id]);
});
