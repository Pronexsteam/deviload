import test from "node:test";
import assert from "node:assert/strict";
import {transitionPlan,sameAlbum} from "../src/music-transition-model.js";
import {soundSettings} from "../src/music-sound-model.js";
import {createSleepTimer,sleepDim,sleepLabel} from "../src/music-sleep.js";
import {romanize,needsRomanization,lyricsLanguage,lyricsExtrasFor,translatable} from "../src/music-romanize.js";

const song=(id,album,artist="Band")=>({kind:"song",id,title:id,artists:[artist],album});

test("tracks from one album join without a fade, others follow the crossfade setting",()=>{
  const a=song("a","Blue"),b=song("b","blue"),c=song("c","Other");
  assert.equal(sameAlbum(a,b),true);assert.equal(sameAlbum(a,song("x","Blue","Someone else")),false);assert.equal(sameAlbum(song("y",""),song("z","")),false);
  assert.deepEqual(transitionPlan({transition:6,seamless:true,current:a,next:b,remaining:.5}),{kind:"join",at:.46});
  assert.equal(transitionPlan({transition:6,seamless:true,current:a,next:b,remaining:3}),null);
  assert.deepEqual(transitionPlan({transition:6,seamless:false,current:a,next:b,remaining:3}),{kind:"fade",overlap:3});
  assert.deepEqual(transitionPlan({transition:6,seamless:true,current:a,next:c,remaining:5}),{kind:"fade",overlap:5});
  assert.equal(transitionPlan({transition:0,seamless:true,current:a,next:c,remaining:1}),null);
  assert.equal(transitionPlan({transition:6,current:a,next:null,remaining:1}),null);
});

test("saved sound settings from older versions keep working and gain the new defaults",()=>{
  const old=soundSettings({preset:"bass",transition:4,soft:true});
  assert.equal(old.transition,4);assert.equal(old.seamless,true);assert.equal(old.soft,true);
  assert.equal(soundSettings({transition:12}).transition,12);assert.equal(soundSettings({transition:3}).transition,0);
  assert.equal(soundSettings({seamless:false}).seamless,false);assert.equal(soundSettings().seamless,true);
});

test("the sleep timer fades out, pauses once and can wait for the end of a track",()=>{
  let now=0,tick=null,dims=[],expired=0;
  const timer=createSleepTimer({now:()=>now,schedule:fn=>{tick=fn;return 1;},cancel:()=>{tick=null;},onDim:v=>dims.push(v),onExpire:()=>expired++});
  timer.set(15);assert.equal(timer.mode,"time");assert.equal(timer.remaining(),900000);
  now=900000-15000;tick();assert.equal(dims.at(-1),.5);
  now=900000;tick();assert.equal(expired,1);assert.equal(timer.mode,"off");assert.equal(dims.at(-1),1);assert.equal(tick,null);
  timer.set("track");assert.equal(timer.holdsTrackEnd(),true);assert.equal(timer.consumeTrackEnd(),true);assert.equal(timer.consumeTrackEnd(),false);
  timer.set(7);assert.equal(timer.mode,"off");
  assert.equal(sleepDim(60000),1);assert.equal(sleepDim(0),0);
  const label=sleepLabel({mode:"time",remaining:()=>61000},(text,params)=>text.replace("{minutes}",params?.minutes));assert.equal(label,"Sleep in 2 min");
});

test("lyrics romanize Cyrillic, Greek, Hangul and kana but leave Han characters",()=>{
  assert.equal(romanize("\u041f\u0440\u0438\u0432\u0435\u0442, \u0449\u0451\u043a\u0438"),"Privet, shchyoki");
  assert.equal(romanize("\uc0ac\ub791\ud574"),"saranghae");
  assert.equal(romanize("\u304d\u3087\u3046 \u3061\u3087\u3063\u3068 \u30e9\u30fc\u30e1\u30f3"),"kyou chotto raamen");
  assert.equal(romanize("\u03b3\u03b5\u03b9\u03b1 \u03c3\u03bf\u03c5"),"geia sou");
  assert.equal(romanize("\u6771\u4eac\u306e\u591c"),"");assert.equal(needsRomanization("hello"),false);
  assert.equal(lyricsLanguage([{text:"te quiero mi amor"},{text:"no me dejes"}]),"es");
  assert.equal(lyricsLanguage([{text:"\u0457\u0436\u0430\u043a"}]),"uk");
});

test("lyrics offer translation only for languages the listener may not read",()=>{
  const russian=[{text:"\u041f\u0440\u0438\u0432\u0435\u0442"}],korean=[{text:"\uc0ac\ub791\ud574"}],english=[{text:"you and me"}];
  assert.deepEqual(lyricsExtrasFor(russian,"ru"),{source:"ru",romanize:false,translate:false});
  assert.deepEqual(lyricsExtrasFor(korean,"ru"),{source:"ko",romanize:true,translate:true});
  assert.deepEqual(lyricsExtrasFor(english,"ru"),{source:"en",romanize:false,translate:true});
  assert.deepEqual(lyricsExtrasFor(russian,"en"),{source:"ru",romanize:true,translate:true});
  assert.deepEqual(translatable([{text:"la la"},{text:"la la"},{text:"\u266a"},{text:""},{text:"oh"}]),["la la","oh"]);
});

import {createPlaybackOrder} from "../src/music-session.js";
const seeded=(seed=7)=>()=>((seed=(seed*1103515245+12345)%2147483648)/2147483648);
const track=(id,artist)=>({kind:"song",id:id.padEnd(11,"x"),title:id,artists:[artist]});

test("shuffle rarely puts the same artist back to back",()=>{
  const queue=[..."abcd"].map(c=>track("a"+c,"Alpha")).concat([..."abcd"].map(c=>track("b"+c,"Beta")));
  const random=seeded(11);let pairs=0,total=0;
  for(let run=0;run<200;run++){
    const order=createPlaybackOrder(random);order.reset(queue[0].id);
    const plan=[queue[0],...order.preview(queue,0,false,true,8)];
    for(let i=1;i<plan.length;i++){total++;if(plan[i].artists[0]===plan[i-1].artists[0])pairs++;}
  }
  assert.ok(pairs/total<.25,`same-artist neighbours: ${(pairs/total*100).toFixed(1)}%`);
});

test("a repeated shuffle does not open the new round with the songs that just ended",()=>{
  const queue=Array.from({length:9},(_,i)=>track("s"+i,"Artist "+i)),order=createPlaybackOrder(seeded(3));
  let index=0;order.reset(queue[0].id);const played=[queue[0].id];
  for(let step=0;step<14;step++){index=order.next(queue,index,true,true);order.visit(queue[index].id,queue);played.push(queue[index].id);}
  const firstRound=played.slice(0,9),lastThree=firstRound.slice(-3),nextThree=played.slice(9,12);
  assert.equal(new Set(firstRound).size,9);
  assert.ok(nextThree.every(id=>!lastThree.includes(id)),`${lastThree} then ${nextThree}`);
});

import {distinctSongs} from "../src/music-recommendation-engine.js";
import {smartPlaylists} from "../src/music-library-model.js";

test("another upload of the same song is shown once and never right after itself",()=>{
  const a={kind:"song",id:"aaaaaaaaaaa",title:"Numb",artists:["Linkin Park"]},b={kind:"song",id:"bbbbbbbbbbb",title:"NUMB",artists:["Linkin Park"]};
  const live={kind:"song",id:"ccccccccccc",title:"Numb (Live)",artists:["Linkin Park"]},other={kind:"song",id:"ddddddddddd",title:"In the End",artists:["Linkin Park"]};
  assert.deepEqual(distinctSongs([a,b,live,other]).map(x=>x.id),[a.id,live.id,other.id]);
  assert.deepEqual(distinctSongs([b,other],[a]).map(x=>x.id),[other.id]);
});

test("On repeat favours recent repeats and drops songs not heard for two months",()=>{
  const day=86400000,now=200*day,song=id=>({kind:"song",id:id.padEnd(11,"x"),title:id,artists:["A"]});
  const entries={};
  for(const [id,plays,ago] of [["old",40,90],["fading",20,45],["fresh",6,1]])entries[song(id).id]={item:song(id),plays,score:2,lastPlayed:now-ago*day,at:now-ago*day};
  const lists=smartPlaylists({favorites:[],recent:[]},{entries,blockedArtists:[],hiddenSongs:[]},[],now);
  assert.deepEqual(lists.frequent.map(x=>x.title),["fresh","fading"]);
});
