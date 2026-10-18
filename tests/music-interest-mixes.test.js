import test from "node:test";
import assert from "node:assert/strict";
import {sanitizeInterestMixes,interestSources,interestSeeds,interestProfile,rankInterestMix,rememberInterestTrack,MAX_INTEREST_MIXES,MAX_INTEREST_PLAYLISTS} from "../src/music-interest-mixes.js";
import {readTaste,recordListening,hideRecommendation} from "../src/music-taste.js";

const now=1800000000000,day=86400000;
const song=(n,artist=`Artist ${n}`)=>({id:String(n).padStart(11,"0"),kind:"song",title:`Track ${n}`,artists:[artist]});
const list=(id,items)=>({id,name:id,items});
const mix=(id,playlistIds,name=id)=>({id,name,playlistIds});
const state=()=>({playlists:[list("jazz",[song(1,"Jazz A"),song(2,"Jazz B")]),list("phonk",[song(3,"Phonk")])],
  favorites:[],collections:[],interestMixes:[mix("work",["jazz"]),mix("energy",["phonk"])]});
const freeze=value=>{if(value&&typeof value==="object"){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};

test("mix configuration is bounded metadata and deleted playlists do not delete a named interest",()=>{
  const playlists=[list("a",[]),list("b",[])],values=[{...mix("mine",["a","gone","a","b"],"  My\n  mix  "),url:"secret",items:[song(1)],token:"private"}],before=JSON.stringify(values);
  assert.deepEqual(sanitizeInterestMixes(values,playlists),[mix("mine",["a","b"],"My mix")]);
  assert.equal(JSON.stringify(values),before);
  assert.deepEqual(sanitizeInterestMixes([mix("mine",["gone"])],playlists,{strict:true}),[mix("mine",[])]);
  assert.deepEqual(sanitizeInterestMixes(),[]);assert.deepEqual(sanitizeInterestMixes(null),[]);
  assert.ok(!/private|secret|token|items/.test(JSON.stringify(sanitizeInterestMixes(values,playlists))));
});

test("strict config rejects invalid identities, duplicate refs and overflow; normalization bounds Unicode labels",()=>{
  const playlists=Array.from({length:10},(_,i)=>list(`p${i}`,[])),valid=mix("id",["p0"]);
  for(const values of [null,{},[null],[{...valid,id:"../x"}],[{...valid,name:" "}],[{...valid,name:42}],[{...valid,playlistIds:"p0"}],[valid,valid],
    [{...valid,playlistIds:["p0","p0"]}],[{...valid,playlistIds:["../x"]}],Array.from({length:9},(_,i)=>mix(`m${i}`,["p0"])),
    [{...valid,playlistIds:playlists.map(value=>value.id)}],[{...valid,name:"漢😀\"".repeat(100)}]])assert.throws(()=>sanitizeInterestMixes(values,playlists,{strict:true}),/Invalid interest mixes/);
  const normalized=sanitizeInterestMixes([{...valid,name:"漢😀\"".repeat(100)}],playlists);
  assert.ok(Buffer.byteLength(JSON.stringify(normalized[0].name))-2<=160);
  assert.equal(sanitizeInterestMixes(Array.from({length:20},(_,i)=>mix(`m${i}`,playlists.map(value=>value.id))),playlists).length,MAX_INTEREST_MIXES);
  assert.equal(sanitizeInterestMixes([mix("all",playlists.map(value=>value.id))],playlists)[0].playlistIds.length,MAX_INTEREST_PLAYLISTS);
  assert.doesNotThrow(()=>sanitizeInterestMixes([{id:{toString(){throw Error("no coercion");}},name:"Bad",playlistIds:[]}],playlists));
});

test("source membership interleaves distinct playlists, deduplicates tracks and remains bounded",()=>{
  const a=song(1,"A"),b=song(2,"B"),c=song(3,"C"),saved={playlists:[list("large",[a,...Array.from({length:70},(_,i)=>song(i+100,"A")),c]),list("small",[b,a])],interestMixes:[mix("both",["large","small"])]};
  const members=interestSources(saved,"both");assert.deepEqual(members.slice(0,3).map(item=>item.id),[a.id,b.id,song(100,"A").id]);
  assert.equal(new Set(members.map(item=>item.id)).size,members.length);
  const seeds=interestSeeds(saved,readTaste(),"both");assert.deepEqual(seeds.map(item=>item.artists[0]),["A","B","C"]);
  const many={playlists:Array.from({length:8},(_,p)=>list(`p${p}`,Array.from({length:500},(_,i)=>song(p*500+i)))),interestMixes:[mix("many",Array.from({length:8},(_,p)=>`p${p}`))]};
  assert.equal(interestSources(many,"many").length,500);assert.equal(interestSeeds(many,readTaste(),"many",{limit:20}).length,8);
});

test("interest seeds rotate within selected playlists and honor exact/collaboration exclusions",()=>{
  const saved=state(),taste=readTaste(),other=song(4,"Jazz C");saved.playlists[0].items.push(other);
  assert.deepEqual(interestSeeds(saved,taste,"work",{limit:1}).map(item=>item.id),[song(1).id]);
  assert.deepEqual(interestSeeds(saved,taste,"work",{limit:1,rotation:1}).map(item=>item.id),[song(2).id]);
  assert.deepEqual(interestSeeds(saved,taste,"work",{limit:0}),[]);
  hideRecommendation(taste,song(1,"Jazz A"));hideRecommendation(taste,song(2,"Jazz B"),true);
  assert.deepEqual(interestSeeds(saved,taste,"work"),[other]);
  saved.playlists[0].items.push({...song(5),artists:["Jazz C"," ＪＡＺＺ\u00a0Ｂ "]});
  assert.deepEqual(interestSeeds(saved,taste,"work"),[other]);
  assert.ok(interestSeeds(saved,taste,"work").every(item=>item.artists[0]!=="Phonk"));
});

test("scoped preference uses only related qualified evidence/favorites without learning membership",()=>{
  const saved=state(),taste=readTaste(),jazz=song(10,"Jazz A"),phonk=song(11,"Phonk"),weak=song(12,"Jazz B");
  saved.favorites=[jazz,phonk];
  recordListening(taste,jazz,{seconds:190,duration:200},now-3*day);recordListening(taste,phonk,{seconds:190,duration:200},now-3*day);
  taste.entries[weak.id]={item:weak,score:.35,plays:0,at:now,lastPlayed:0};
  const before=JSON.stringify({saved,taste}),scope=interestProfile(saved,taste,"work",{now});
  assert.deepEqual(scope.favorites,[jazz]);assert.equal(scope.profile.entries[jazz.id].score,taste.entries[jazz.id].score);
  assert.equal(scope.profile.entries[phonk.id].score,0);assert.deepEqual(scope.profile.entries[phonk.id].item.artists,[]);
  assert.equal(scope.profile.entries[weak.id].score,0);
  assert.equal(scope.profile.entries[song(1).id],undefined,"playlist membership cannot simulate a listen");
  assert.equal(JSON.stringify({saved,taste}),before);assert.equal(scope.profile.entries[phonk.id].plays,1);
});

test("out-of-scope exact negatives and global cooldowns survive without importing unrelated positive affinity",()=>{
  const saved=state(),taste=readTaste(),bad=song(50,"Outside rejected"),recent=song(51,"Outside recent"),good=song(52,"Jazz A");
  recordListening(taste,bad,{seconds:5,duration:200,skipped:true},now-1000);
  recordListening(taste,recent,{seconds:190,duration:200},now-1000);
  const rows=rankInterestMix([bad,recent,good],saved,taste,"work",{now});
  assert.deepEqual(rows.map(row=>row.item.id),[good.id]);
  assert.deepEqual(taste.entries[bad.id].item.artists,["Outside rejected"]);
});

test("ranked interests keep global familiarity honest but do not boost unrelated favorites/followed artists",()=>{
  const saved=state(),taste=readTaste(),outside=song(60,"Phonk"),inside=song(61,"Jazz A"),globalLike=song(62,"Phonk");
  saved.favorites=[globalLike];saved.collections=[{kind:"artist",id:"UCoutside",title:"Phonk"}];
  const rows=rankInterestMix([outside,inside],saved,taste,"work",{now});
  assert.equal(rows[0].item.id,inside.id);
  assert.equal(rows.find(row=>row.item.id===outside.id).reason.code,"catalog","globally known artist is not falsely called new");
  assert.equal(rows.find(row=>row.item.id===inside.id).reason.code,"discovery","membership is not qualified history");
  const energy=rankInterestMix([outside,inside],saved,taste,"energy",{now});assert.equal(energy[0].item.id,outside.id);
});

test("a playlist-only interest keeps its direction in Familiar mode without pretending globally known artists are new",()=>{
  const saved=state(),taste=readTaste(),jazz=song(61,"Jazz A"),phonk=song(62,"Phonk");
  taste.mode="familiar";saved.favorites=[phonk];
  const before=JSON.stringify({saved,taste});
  const rows=rankInterestMix([phonk,jazz],saved,taste,"work",{now,familiarBoostIds:[phonk.id]});
  assert.equal(rows[0].item.id,jazz.id,"an unrelated global like cannot collect this interest's Familiar-mode bonus");
  assert.equal(rows.find(row=>row.item.id===phonk.id).reason.code,"catalog","global familiarity remains honest");
  assert.equal(rows.find(row=>row.item.id===jazz.id).reason.code,"discovery","playlist membership does not simulate listening");
  assert.equal(JSON.stringify({saved,taste}),before);
  const energy=rankInterestMix([jazz,phonk],saved,taste,"energy",{now});assert.equal(energy[0].item.id,phonk.id);
});

test("hard exclusions override interest membership, favorites and retrieval boosts",()=>{
  const saved=state(),taste=readTaste(),hidden=song(1,"Jazz A"),blocked=song(2,"Jazz B"),allowed=song(70,"Jazz A");
  saved.favorites=[hidden,blocked];hideRecommendation(taste,hidden);hideRecommendation(taste,blocked,true);
  saved.playlists[0].items.push(allowed);
  const rows=rankInterestMix([hidden,blocked,allowed],saved,taste,"work",{now,candidateScores:new Map([[hidden.id,1000],[blocked.id,1000]])});
  assert.deepEqual(rows.map(row=>row.item.id),[allowed.id]);
  hideRecommendation(taste,allowed);assert.deepEqual(rankInterestMix([song(71)],saved,taste,"work",{now}),[]);
});

test("deleted/empty/unknown interests fail closed, never fall back to unrelated global recommendations",()=>{
  const saved=state(),taste=readTaste();saved.playlists=[];
  assert.deepEqual(interestSources(saved,"work"),[]);assert.deepEqual(interestSeeds(saved,taste,"work"),[]);
  assert.deepEqual(rankInterestMix([song(1)],saved,taste,"work",{now}),[]);
  assert.deepEqual(rankInterestMix([song(1)],saved,taste,"missing",{now}),[]);
  assert.deepEqual(interestSources(null,"missing"),[]);assert.deepEqual(rankInterestMix([song(1)],null,null,"missing"),[]);
});

test("ranking is deterministic, respects mode/exclude options and does not mutate frozen global state",()=>{
  const saved=state(),taste=readTaste(),inside=song(80,"Jazz A"),other=song(81,"Unknown");saved.favorites=[song(1,"Jazz A")];
  freeze(saved);freeze(taste);const candidates=freeze([inside,other]),options={now,mode:"familiar",exclude:[other.id],sessionItems:[song(99,"Phonk")],candidateScores:new Map([[inside.id,1]])};
  const first=rankInterestMix(candidates,saved,taste,"work",options),second=rankInterestMix(candidates,saved,taste,"work",options);
  assert.deepEqual(first,second);assert.deepEqual(first.map(row=>row.item.id),[inside.id]);
  assert.equal(taste.mode,"balanced");assert.equal(saved.interestMixes[0].playlistIds[0],"jazz");
});

test("learned configuration retains only bounded unique track references, never a second history",()=>{
  const saved=state(),value={...saved.interestMixes[0],learnedIds:[song(10).id],history:{secret:true}};
  assert.deepEqual(sanitizeInterestMixes([value],saved.playlists,{strict:true}),[{...saved.interestMixes[0],learnedIds:[song(10).id]}]);
  for(const learnedIds of [null,"wrong",["../bad"],[song(10).id,song(10).id],Array.from({length:101},(_,i)=>song(i).id)])assert.throws(()=>sanitizeInterestMixes([{...value,learnedIds}],saved.playlists,{strict:true}),/Invalid interest mixes/);
  const normalized=sanitizeInterestMixes([{...value,learnedIds:[song(1).id,song(1).id,"bad",song(2).id]}],saved.playlists);
  assert.deepEqual(normalized[0].learnedIds,[song(1).id,song(2).id]);
});

test("remembering a trusted interest discovery is immutable, newest-first, deduplicated and bounded",()=>{
  const configs=freeze(state().interestMixes),first=rememberInterestTrack(configs,"work",song(10).id);
  assert.notEqual(first,configs);assert.equal(first[1],configs[1]);assert.equal(configs[0].learnedIds,undefined);
  let updated=first;for(let i=0;i<120;i++)updated=rememberInterestTrack(updated,"work",song(100+i).id);
  assert.equal(updated[0].learnedIds.length,100);assert.equal(updated[0].learnedIds[0],song(219).id);
  updated=rememberInterestTrack(updated,"work",song(150).id);assert.equal(updated[0].learnedIds[0],song(150).id);assert.equal(new Set(updated[0].learnedIds).size,100);
  assert.equal(rememberInterestTrack(configs,"missing",song(10).id),configs);assert.equal(rememberInterestTrack(configs,"work","bad"),configs);
});

test("only referenced, qualified, dated global discoveries extend an interest and its artist representatives",()=>{
  const saved=state(),taste=readTaste(),learned=song(90,"New Jazz Artist"),weak=song(91,"Only imported"),future=song(92,"Future"),unrelated=song(93,"Other context");
  recordListening(taste,learned,{seconds:40,duration:200},now-3600000);recordListening(taste,unrelated,{seconds:40,duration:200},now-3600000);
  taste.entries[weak.id]={item:weak,score:8,plays:0,at:now,lastPlayed:now};
  taste.entries[future.id]={item:future,score:8,plays:2,at:now+day,lastPlayed:now+day};
  saved.interestMixes[0].learnedIds=[learned.id,weak.id,future.id,song(999).id];
  assert.ok(!interestSources(saved,"work").some(item=>item.id===learned.id),"two-argument sources remain base playlist members");
  const members=interestSources(saved,"work",taste,{now});
  assert.ok(members.some(item=>item.id===learned.id));assert.ok(!members.some(item=>[weak.id,future.id,unrelated.id,song(999).id].includes(item.id)));
  const seeds=interestSeeds(saved,taste,"work",{now,limit:3});assert.ok(seeds.some(item=>item.id===learned.id));
  assert.ok(!interestSources(saved,"energy",taste,{now}).some(item=>item.id===learned.id));
  assert.equal(interestProfile(saved,taste,"work",{now}).profile.entries[learned.id].score,1);
});

test("a mix can retain qualified discoveries after source playlist deletion without saving their metadata",()=>{
  const saved=state(),taste=readTaste(),learned=song(90,"Learned artist");
  recordListening(taste,learned,{seconds:40,duration:200},now-day);
  saved.interestMixes=rememberInterestTrack(saved.interestMixes,"work",learned.id);saved.playlists=[];
  const clean=sanitizeInterestMixes(saved.interestMixes,[]);assert.equal(clean[0].playlistIds.length,0);assert.deepEqual(clean[0].learnedIds,[learned.id]);
  assert.deepEqual(interestSources(saved,"work",taste,{now}),[learned]);
  assert.ok(rankInterestMix([song(91,"Learned artist")],saved,taste,"work",{now}).length);
  delete taste.entries[learned.id];assert.deepEqual(interestSources(saved,"work",taste,{now}),[]);
  assert.deepEqual(clean[0].learnedIds,[learned.id],"evicted history does not rewrite the user's configuration");
});

test("full source playlists cannot bury qualified newly learned artists and total derived membership is bounded",()=>{
  const saved={playlists:[list("base",Array.from({length:500},(_,i)=>song(i,"Base artist")))],favorites:[],collections:[],interestMixes:[mix("mine",["base"])]},taste=readTaste();
  for(let i=0;i<100;i++){const item=song(1000+i,`Learned ${i}`);taste.entries[item.id]={item,score:1,plays:1,at:now-day,lastPlayed:now-day};saved.interestMixes=rememberInterestTrack(saved.interestMixes,"mine",item.id);}
  const members=interestSources(saved,"mine",taste,{now});assert.equal(members.length,600);
  assert.ok(members[1].id===song(1099).id);assert.ok(interestSeeds(saved,taste,"mine",{now,limit:2}).some(item=>item.id===song(1099).id));
});
