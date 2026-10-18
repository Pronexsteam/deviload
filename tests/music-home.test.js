import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {createRecommendationSession} from "../src/music-recommendation-session.js";
import {canonicalArtistKey} from "../src/music-taste.js";
import {createRecordingView} from "../src/music-recording-view.js";
import {resolveRecordingSource} from "../src/music-recordings.js";
const source=readFileSync(new URL("../src/devil-music.js",import.meta.url),"utf8");
const code=source.slice(source.indexOf("  function resetPublicDiscovery("),source.indexOf("  function recommendationOptions("))+
  source.slice(source.indexOf("  async function personalize("),source.indexOf("  function showLocal("));
const song=(n,title)=>({kind:"song",id:String(n).padStart(11,"0"),title,artists:["Artist"]});
const local=song(1,"Regional release"),personal=song(2,"Related to liked artist"),recent=song(3,"Last played"),liked=song(4,"Liked song");
const base=[{title:"New releases",items:[local]}];
function home(showRegional){
  const ctx={saved:{favorites:[],recent:[recent],showRegional,sourceBindings:[],interestMixes:[],playlists:[],collections:[]},taste:{},queue:[],request:1,personalization:0,playbackContext:[],playbackSourceContext:{kind:"manual"},followedCursor:0,privateSession:false,recommendationReasons:new Map(),current:null,sections:[],audio:{paused:true},prepared:[],tracks:items=>items,intent:{enter:id=>ctx.prepared.push(id)},captureListening(){},tasteSeeds:()=>[liked],radio:async()=>[personal],createRecordingView,recommendationSession:{seeds:(_,seeds)=>seeds,contextItems:()=>[],mergePools:pools=>({items:pools.flatMap(pool=>pool.items),scores:new Map()}),allowed:items=>items},recommendationOptions:()=>({}),rankMusicRecommendations:items=>items.map(item=>({item,reason:{code:"catalog"}})),t:s=>s,render(){}};
  Object.assign(ctx,{publicDiscovery:{candidates:async()=>[],clear(){}},publicGeneration:0,sourceRevision:0,navigator:{},resolveRecordingSource,language:()=>"en",view:"home",lastQuery:{kind:"home"}});
  return {ctx,...runInNewContext(`(()=>{${code};return {personalize,homeSections};})()`,ctx)};
}
test("regional catalog is never presented as learned personal recommendations",async()=>{
  const h=home(true);await h.personalize(1,base);
  assert.equal(h.ctx.sections[0].title,"For you");assert.equal(h.ctx.sections[0].items.length,1);assert.equal(h.ctx.sections[0].items[0].id,personal.id);assert.equal(h.ctx.sections[2],base[0]);
  assert.deepEqual(h.ctx.prepared,[personal.id]);
});
test("hiding regional releases retains recent listening and personal discovery",async()=>{
  const h=home(false);await h.personalize(1,base);
  assert.equal(h.ctx.sections.length,2);assert.equal(h.ctx.sections[1].items[0].id,recent.id);assert.ok(!h.ctx.sections.flatMap(section=>section.items).some(item=>item.id===local.id));
  h.ctx.tasteSeeds=()=>[];await h.personalize(1,base);assert.equal(h.ctx.sections.length,1);assert.equal(h.ctx.sections[0].title,"Recently played");
});

test("home represents the chosen music context within three stations and rotates other followed artists",async()=>{
  const song=(n,artist)=>({kind:"song",id:String(n).padStart(11,"0"),title:`Song ${n}`,artists:[artist]});
  const h=home(false),queries=[],radios=[],context=[song(1,"Jazz A"),song(2,"Jazz B"),song(3,"Jazz C")];
  h.ctx.recommendationSession=createRecommendationSession();h.ctx.recommendationSession.setContext(context);
  h.ctx.saved.collections=["Jazz A","Other 1","Other 2","Other 3"].map((title,index)=>({kind:"artist",id:`UC${index}`,title}));
  h.ctx.canonicalArtistKey=canonicalArtistKey;h.ctx.language=()=>"en";h.ctx.tasteSeeds=()=>[song(9,"Phonk")];
  h.ctx.invoke=async(_,args)=>{queries.push(args.value);return {sections:[{items:[]}]};};
  h.ctx.radio=async seed=>{radios.push(seed.id);return [song(20+Number(seed.id),seed.artists[0])];};
  for(let i=0;i<4;i++){const before=radios.length;await h.personalize(1,[]);assert.equal(radios.length-before,3);}
  assert.ok(radios.every(id=>context.some(item=>item.id===id)));assert.equal(queries.length,8);
  assert.deepEqual(new Set(queries),new Set(["UC0","UC1","UC2","UC3"]));
});
