import test from "node:test";
import assert from "node:assert/strict";
import {recordingDescriptor,recordingMatch,recordingAlternatives,resolveRecordingSource,setRecordingSource,removeRecordingSource,recordingFamilyIds,dedupeRecordings} from "../src/music-recordings.js";

const id=n=>String(n).padStart(11,"0");
const song=(n,extra={})=>({kind:"song",id:id(n),title:"Night Drive",artists:["Artist"],duration:200,...extra});

test("strong recording suggestions require exact normalized title, artists, version and finite duration",()=>{
  const original=song(1,{title:"Ｃａｆｅ́ – 夜",artists:["Ａｒｔｉｓｔ","\u041c\u0443\u0437\u044b\u043a\u0430\u043d\u0442"]});
  const candidate=song(2,{title:"Café - 夜 (Official Audio)",artists:[" \u043c\u0443\u0437\u044b\u043a\u0430\u043d\u0442 ","artist"],duration:200.8});
  const result=recordingMatch(original,candidate);
  assert.equal(result.confidence,"high");assert.equal(result.score,1);
  assert.deepEqual(result.reasons,["title_exact","artist_exact","version_exact","duration_close"]);
  assert.equal(recordingMatch(song(1,{title:"Artist - Night Drive"}),song(2)).confidence,"high");
});

test("missing or invalid duration, absent artist credits and partial collaboration matches remain reviewable",()=>{
  for(const candidate of [song(2,{duration:undefined}),song(2,{duration:NaN}),song(2,{duration:Infinity}),song(2,{duration:"3:20"}),song(2,{artists:[]}),song(2,{artists:["Artist","Guest"]}),song(2,{duration:210})]){
    assert.equal(recordingMatch(song(1),candidate).confidence,"review");
  }
  assert.ok(recordingMatch(song(1),song(2,{duration:NaN})).reasons.includes("duration_unknown"));
  assert.ok(recordingMatch(song(1),song(2,{duration:210})).reasons.includes("duration_mismatch"));
  assert.equal(recordingMatch(song(1),song(2,{duration:undefined,durationSeconds:200})).confidence,"high");
  assert.equal(recordingMatch(song(1),song(2,{duration:200,durationSeconds:220})).confidence,"review");
});

test("studio/original labels do not make slowed, sped, reverb, remix or performance versions interchangeable",()=>{
  assert.equal(recordingMatch(song(1),song(2,{title:"Night Drive (Studio Version)"})).confidence,"high");
  assert.equal(recordingMatch(song(1),song(2,{title:"Night Drive (Original Version)"})).confidence,"high");
  for(const [label,kind]of [["Slowed","slowed"],["Ultra Slowed 0.8x","slowed"],["Sped Up","sped"],["Reverb","reverb"],["DJ Moon Remix","remix"],["Live at Wembley 2019","live"],["Cover","cover"],["Acoustic","acoustic"],["Instrumental","instrumental"],["2011 Remastered","remaster"],["Radio Edit","edit"],["Extended","extended"]]){
    const candidate=song(2,{title:`Night Drive (${label})`}),descriptor=recordingDescriptor(candidate);
    assert.ok(descriptor.variant.kinds.includes(kind),label);assert.equal(descriptor.title,"night drive");
    assert.notEqual(recordingMatch(song(1),candidate).confidence,"high",label);
    assert.ok(recordingMatch(song(1),candidate).reasons.includes("version_mismatch"));
  }
});

test("named remixes, remaster years and speed details survive normalization",()=>{
  for(const [a,b]of [["DJ Moon Remix","DJ Sun Remix"],["2011 Remastered","2024 Remastered"],["Slowed 0.8x","Slowed 0.9x"],["Ultra Slowed","Slowed"],["Live in Tokyo","Live in Paris"]]){
    const original=song(1,{title:`Night Drive (${a})`}),candidate=song(2,{title:`Night Drive (${b})`});
    assert.notDeepEqual(recordingDescriptor(original).variant.details,recordingDescriptor(candidate).variant.details);
    assert.equal(recordingMatch(original,candidate).confidence,"review",`${a} / ${b}`);
  }
  const original=song(1,{title:"Night Drive - DJ Moon Remix"}),candidate=song(2,{title:"Night Drive [ＤＪ Moon Remix]"});
  assert.deepEqual(recordingDescriptor(original).variant.details,["dj moon remix"]);
  assert.equal(recordingMatch(original,candidate).confidence,"high");
});

test("multilingual versions and Unicode musical titles remain distinct rather than losing details",()=>{
  for(const [label,kind]of [["\u0417\u0430\u043c\u0435\u0434\u043b\u0435\u043d\u043d\u0430\u044f \u0432\u0435\u0440\u0441\u0438\u044f","slowed"],["\u0423\u0441\u043a\u043e\u0440\u0435\u043d\u043d\u0430\u044f \u0432\u0435\u0440\u0441\u0438\u044f","sped"],["\u0420\u0435\u043c\u0438\u043a\u0441 \u0414\u0438\u0434\u0436\u0435\u044f","remix"],["\u0410\u043a\u0443\u0441\u0442\u0438\u0447\u0435\u0441\u043a\u0430\u044f \u0432\u0435\u0440\u0441\u0438\u044f","acoustic"],["En vivo Madrid 2020","live"],["Versión acústica","acoustic"],["Ralentizado","slowed"]]){
    const descriptor=recordingDescriptor(song(1,{title:`夜の音 (${label})`,artists:["\u0418\u0441\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044c"]}));
    assert.equal(descriptor.title,"夜の音");assert.ok(descriptor.variant.kinds.includes(kind),label);
    assert.equal(descriptor.variant.details[0],label.normalize("NFKC").toLowerCase());
  }
  assert.equal(recordingMatch(song(1,{title:"Café"}),song(2,{title:"Cafe"})).confidence,"none");
  assert.equal(recordingMatch(song(1,{artists:["\u0421\u0430\u0448\u0430"]}),song(2,{artists:["C\u0430\u0448\u0430"]})).confidence,"review"); // Latin C is not Cyrillic \u0421.
});

test("words belonging to the song title are not blindly removed as version annotations",()=>{
  for(const title of ["Live and Let Die","Cover Me","Acoustic Dreams","Instrumental Love"]){
    const descriptor=recordingDescriptor(song(1,{title}));assert.equal(descriptor.title,title.toLowerCase());assert.deepEqual(descriptor.variant.kinds,["studio"]);
  }
  const combo=recordingDescriptor(song(1,{title:"Night Drive (Slowed + Reverb)"}));
  assert.deepEqual(combo.variant.kinds,["reverb","slowed"]);assert.deepEqual(combo.variant.details,["slowed reverb"]);
});

test("alternative rows rank metadata agreement, exclude the original source and keep ambiguity explicit",()=>{
  const original=song(1),close=song(2),unknown=song(3,{duration:undefined}),live=song(4,{title:"Night Drive (Live)"}),unrelated=song(5,{title:"Different Song"});
  const result=recordingAlternatives(original,[original,live,unknown,unrelated,close,close]);
  assert.equal(result[0].item,close);assert.equal(result[0].confidence,"high");
  assert.equal(result.length,3);assert.ok(result.slice(1).every(row=>row.confidence==="review"));
  assert.ok(result.every(row=>Object.keys(row).sort().join(",")==="confidence,item,reasons,score"));
  assert.deepEqual(recordingAlternatives(original,[close],{limit:0}),[]);
});

test("a user source choice is one hop and does not mutate the logical song, likes or caller objects",()=>{
  const original=Object.freeze({...song(1),artists:Object.freeze(["Artist"])}),source=Object.freeze({...song(2),artists:Object.freeze(["Artist"])}),third=song(3);
  const empty=Object.freeze([]),bindings=setRecordingSource(empty,original.id,source);
  assert.equal(resolveRecordingSource(original,bindings),source);assert.equal(original.id,id(1));assert.equal(empty.length,0);
  const chain=setRecordingSource(bindings,source.id,third);
  assert.equal(resolveRecordingSource(original,chain),source);assert.equal(resolveRecordingSource(source,chain),third);
  assert.equal(resolveRecordingSource(song(4),chain).id,id(4));
  const reset=setRecordingSource(bindings,original.id,original);assert.deepEqual(reset,[]);assert.equal(resolveRecordingSource(original,reset),original);
});

test("binding updates/removal are reversible, bounded and do not evict unrelated confirmed choices",()=>{
  const original=song(1),first=song(2),replacement=song(3);
  const a=setRecordingSource([],original.id,first),b=setRecordingSource(a,original.id,replacement);
  assert.equal(a[0].source,first);assert.equal(b.length,1);assert.equal(b[0].source,replacement);
  assert.deepEqual(removeRecordingSource(b,original.id),[]);assert.equal(b.length,1);
  let full=[];for(let i=0;i<200;i++)full=setRecordingSource(full,id(i+1000),song(i+2000));
  const before=JSON.stringify(full);assert.throws(()=>setRecordingSource(full,id(9),song(10)),/200 source choices/);assert.equal(JSON.stringify(full),before);
  assert.equal(setRecordingSource(full,id(1000),song(9999)).length,200);
  assert.throws(()=>setRecordingSource(full,"invalid",song(2)),/Invalid recording source/);
});

test("confirmed families are connected, deterministic, cycle-safe and independent of recursive playback resolution",()=>{
  const bindings=[{trackId:id(1),source:song(2)},{trackId:id(2),source:song(3)},{trackId:id(3),source:song(1)},{trackId:id(4),source:song(5)}];
  assert.deepEqual(new Set(recordingFamilyIds(id(2),bindings)),new Set([id(1),id(2),id(3)]));
  assert.equal(recordingFamilyIds(id(2),bindings)[0],id(2));assert.deepEqual(recordingFamilyIds(id(9),bindings),[id(9)]);
  assert.deepEqual(recordingFamilyIds("bad",bindings),[]);
  assert.equal(resolveRecordingSource(song(1),bindings).id,id(2));
  const chain=Array.from({length:200},(_,i)=>({trackId:id(i),source:song(i+1)}));
  assert.equal(recordingFamilyIds(id(0),chain).length,201);assert.ok(recordingFamilyIds(id(0),chain).length<=400);
});

test("binding changes preserve only valid logical-track snapshots on unrelated choices",()=>{
  const logical=song(1),other=song(3),bindings=[{trackId:logical.id,track:logical,source:song(2)},{trackId:other.id,track:other,source:song(4)}];
  const updated=setRecordingSource(bindings,other.id,song(5));
  assert.equal(updated.find(binding=>binding.trackId===logical.id).track,logical);
  assert.equal(updated.find(binding=>binding.trackId===other.id).track,other);
  assert.equal(removeRecordingSource(updated,other.id)[0].track,logical);
  const malformed=[{trackId:logical.id,track:other,source:song(2),secret:"discard"}];
  assert.deepEqual(Object.keys(removeRecordingSource(malformed,other.id)[0]).sort(),["source","trackId"]);
});

test("recommendation deduplication uses confirmed bindings only, never title or high metadata confidence",()=>{
  const original=song(1),sameMetadata=song(2),slowed=song(3,{title:"Night Drive (Slowed)"}),other=song(4);
  assert.equal(recordingMatch(original,sameMetadata).confidence,"high");
  assert.deepEqual(dedupeRecordings([original,sameMetadata,slowed]),[original,sameMetadata,slowed]);
  const bindings=[{trackId:original.id,source:sameMetadata}];
  assert.deepEqual(dedupeRecordings([original,sameMetadata,slowed,other],bindings),[original,slowed,other]);
  assert.deepEqual(dedupeRecordings([sameMetadata,original],bindings),[sameMetadata]);
  assert.deepEqual(dedupeRecordings([original,sameMetadata],bindings,{limit:0}),[]);
});

test("malformed metadata and bindings cannot invent high confidence or redirect playback",()=>{
  const original=song(1),bad=[null,{},song(2,{title:""}),song(2,{title:"\u0001\u200b\ufeff"}),song(2,{id:{toString(){throw Error("No coercion");}}}),song(2,{title:"x".repeat(1025)})];
  for(const candidate of bad)assert.equal(recordingMatch(original,candidate).confidence,"none");
  const bindings=[{trackId:id(1),source:{id:id(2),kind:"album",title:"Wrong type"}},{trackId:"bad",source:song(2)},null];
  assert.equal(resolveRecordingSource(original,bindings),original);assert.deepEqual(recordingFamilyIds(original.id,bindings),[original.id]);
  assert.deepEqual(recordingAlternatives(original,bad),[]);
  assert.equal(recordingMatch(original,song(2,{artists:[null,42,{}],duration:-10})).confidence,"review");
});

test("models preserve frozen inputs and bound candidate/binding work",()=>{
  const original=Object.freeze({...song(1),artists:Object.freeze(["Artist"])}),candidate=Object.freeze({...song(2),artists:Object.freeze(["Artist"])});
  const candidates=Object.freeze([candidate]),bindings=Object.freeze([{trackId:original.id,source:candidate}]);
  const before=JSON.stringify({original,candidates,bindings});recordingDescriptor(original);recordingAlternatives(original,candidates);recordingFamilyIds(original.id,bindings);dedupeRecordings(candidates,bindings);
  assert.equal(JSON.stringify({original,candidates,bindings}),before);
  assert.equal(recordingAlternatives(original,Array.from({length:2500},(_,i)=>song(i+10)),{limit:10000}).length,50);
  assert.equal(dedupeRecordings(Array.from({length:2500},(_,i)=>song(i+10))).length,2000);
});
