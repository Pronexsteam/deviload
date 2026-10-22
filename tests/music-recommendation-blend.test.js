import test from "node:test";
import assert from "node:assert/strict";
import {adaptiveDiscoveryShare} from "../src/music-recommendation-blend.js";
import {recommend,readTaste,recordListening} from "../src/music-taste.js";
import {createRecommendationSession} from "../src/music-recommendation-session.js";

const now=1800000000000,minute=60000;
const song=(n,artist=`Artist ${n}`)=>({id:String(n).padStart(11,"0"),kind:"song",title:`Song ${n}`,artists:[artist],duration:180});
function outcomes(kind,familiar,count=4){return Array.from({length:count},(_,index)=>({id:song(index+100).id,session:index,kind,familiar,completed:kind==="listen",at:now}));}
function candidates(){
  const favorites=Array.from({length:20},(_,index)=>song(index+1,`Known ${index}`));
  const known=favorites.map((item,index)=>song(index+101,item.artists[0])),novel=Array.from({length:20},(_,index)=>song(index+201,`New ${index}`));
  return {favorites,items:[...known,...novel],novel:new Set(novel.map(item=>item.id))};
}

test("session completion earns more unfamiliar artists and repeated early skips reduce them without removing discovery",()=>{
  const {favorites,items,novel}=candidates(),profile=readTaste(),before=JSON.stringify(profile);
  const rank=sessionFeedback=>recommend(items,profile,favorites,{now,random:()=>.5,limit:18,sessionFeedback});
  const discoveries=rows=>rows.filter(item=>novel.has(item.id)).length;
  const cold=rank(),accepted=rank(outcomes("listen",false)),rejected=rank(outcomes("skip",false));
  assert.ok(discoveries(accepted)>discoveries(cold));
  assert.ok(discoveries(rejected)<discoveries(cold));
  assert.ok(discoveries(rejected)>=3,"even rejected discoveries retain a small exploration floor");
  for(const rows of [cold,accepted,rejected]){
    assert.equal(rows.length,18);assert.equal(new Set(rows.map(item=>item.id)).size,18);
    for(let index=1;index<rows.length;index++)assert.notEqual(rows[index].artists[0],rows[index-1].artists[0]);
  }
  assert.equal(JSON.stringify(profile),before);
});

test("mode bounds, neutral priors and expiring session evidence prevent permanent taste lock-in",()=>{
  const accepted=outcomes("listen",false,32),rejected=outcomes("skip",false,32);
  for(const [mode,base,min,max]of [["balanced",1/3,.22,.46],["familiar",1/6,.12,.24],["discovery",.5,.4,.64]]){
    const up=adaptiveDiscoveryShare(mode,accepted,{now}),down=adaptiveDiscoveryShare(mode,rejected,{now});
    assert.ok(up>base&&up<=max);assert.ok(down<base&&down>=min);
    const single=adaptiveDiscoveryShare(mode,outcomes("skip",false,1),{now});
    assert.ok(base-single<.02,"one skip must not take over the session");
    assert.equal(adaptiveDiscoveryShare(mode,rejected,{now:now+90*minute}),null);
  }
  assert.ok(adaptiveDiscoveryShare("balanced",accepted,{now:now+60*minute})<adaptiveDiscoveryShare("balanced",accepted,{now}));
});

test("cold start, unavailable signals, malformed feedback and missing cohorts retain safe deterministic fallback",()=>{
  const {favorites,items}=candidates(),profile=readTaste(),base={now,random:()=>.5,limit:18};
  const old=recommend(items,profile,favorites,base);
  for(const feedback of [undefined,[],null,{},[{kind:"listen",id:"invalid",familiar:false,session:1,at:now}],
    [{...outcomes("listen",false)[0],at:now+1}], [{...outcomes("listen",false)[0],session:NaN}],
    [{...outcomes("listen",false)[0],familiar:"false"}]]){
    assert.equal(adaptiveDiscoveryShare("balanced",feedback,{now}),null);
    assert.deepEqual(recommend(items,profile,favorites,{...base,sessionFeedback:feedback}),old);
  }
  const knownOnly=items.slice(0,20),newOnly=items.slice(20);
  for(const pool of [knownOnly,newOnly])assert.equal(recommend(pool,profile,favorites,{...base,sessionFeedback:outcomes("skip",false)}).length,18);
  assert.ok(Number.isFinite(adaptiveDiscoveryShare("toString",outcomes("listen",false),{now})));
});

test("checkpoints, duplicate events and replay loops cannot multiply the same acceptance vote",()=>{
  const session=createRecommendationSession(),item=song(1),initial={session:1,duration:180,familiar:false};
  session.recordListen(item,{...initial,seconds:30},now);
  const qualified=session.options(now).sessionFeedback;
  assert.equal(qualified.length,1);assert.equal(qualified[0].completed,false);
  for(const seconds of [45,90,150,180])session.recordListen(item,{session:1,duration:180,seconds,familiar:true},now+seconds*1000);
  const completed=session.options(now+3*minute).sessionFeedback;
  assert.equal(completed.length,1);assert.equal(completed[0].familiar,false);assert.equal(completed[0].completed,true);
  assert.equal(completed[0].at,now);
  assert.equal(adaptiveDiscoveryShare("balanced",Array(32).fill(completed[0]),{now:now+3*minute}),adaptiveDiscoveryShare("balanced",completed,{now:now+3*minute}));
  assert.ok(adaptiveDiscoveryShare("balanced",completed,{now:now+3*minute})>adaptiveDiscoveryShare("balanced",qualified,{now:now+3*minute}));
});

test("session outcomes stay bounded and disappear at explicit context and privacy boundaries",()=>{
  const session=createRecommendationSession();
  for(let index=0;index<80;index++)session.recordSkip(song(index+1),{seconds:5,duration:180,session:index,intent:"next",familiar:false},now+index);
  assert.equal(session.options(now+minute).sessionFeedback.length,32);
  const exposed=session.options(now+minute).sessionFeedback;exposed[0].familiar=true;
  assert.equal(session.options(now+minute).sessionFeedback[0].familiar,false,"callers cannot mutate retained evidence");
  session.setContext([song(100)]);assert.deepEqual(session.options(now+minute).sessionFeedback,[]);
  session.recordListen(song(101),{seconds:170,duration:180,session:100,familiar:false},now+minute);
  session.reset();assert.deepEqual(session.options(now+minute).sessionFeedback,[]);
  session.recordListen(song(102),{seconds:170,duration:180,session:101,familiar:false},now+minute);
  assert.deepEqual(session.options(now+92*minute).sessionFeedback,[]);
});

test("adaptive discovery never overrides exclusions, qualified cooldown or the manual playback queue",()=>{
  const profile=readTaste(),manual=[song(1),song(2),song(3),song(4)];
  profile.hiddenSongs=[manual[0].id];profile.blockedArtists=[manual[1].artists[0].toLowerCase()];
  recordListening(profile,manual[2],{seconds:170,duration:180,session:1},now);
  const before=JSON.stringify(manual);
  assert.deepEqual(recommend(manual,profile,manual,{now,limit:4,sessionFeedback:outcomes("listen",false),random:()=>.5}),[manual[3]]);
  assert.equal(JSON.stringify(manual),before);
});
