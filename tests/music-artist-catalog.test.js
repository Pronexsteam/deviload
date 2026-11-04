import test from "node:test";
import assert from "node:assert/strict";
import {createArtistCatalog} from "../src/music-artist-catalog.js";
import {videoRecordingCandidates,recordingAlternatives} from "../src/music-recordings.js";

const artist={id:"artist1",title:"Miley Cyrus",kind:"artist"};
test("a temporary artist failure offers credited songs and retries the complete page on the next visit",async()=>{
  let now=0,online=false;
  const requests=[];
  const song={kind:"song",artists:["Miley Cyrus","Other"],id:"s1"};
  const page={sections:[{items:[song]}],artwork:{id:artist.id}};
  const load=createArtistCatalog(async(command,args)=>{
    requests.push(args.kind);
    if(args.kind==="browse"){if(online)return page;throw Error("unavailable");}
    return {sections:[{items:[song,{kind:"song",artists:["Miley Cyrus Tribute"]}]}]};
  },()=>now);
  const partial=await load(artist,"ru");
  assert.deepEqual(partial.sections[0].items,[song]);
  online=true;
  assert.equal(await load(artist,"ru"),page);
  assert.equal(await load(artist,"ru"),page);
  online=false;now+=400000;
  assert.deepEqual((await load(artist,"ru")).artwork,page.artwork);
  assert.deepEqual(requests,["browse","search","browse","browse"]);
});

test("a publisher's Melbourne Recut video can be selected without conflating it with the original song",()=>{
  const original={kind:"song",id:"s_uxuGmhq1Q",title:"Gimme! Gimme! Gimme! (Sgt Slick's Melbourne Recut)",artists:["Sgt Slick"],duration:183};
  const hit={url:"https://www.youtube.com/watch?v=kAnQgluWpkc",title:"Sgt Slick - Gimme! Gimme! Gimme! (Sgt Slicks Melbourne Recut - Edit) - Official Music Video",channel:"ViciousRecordings",duration:187};
  const candidates=videoRecordingCandidates([hit,{...hit,url:"https://example.com/"}]);
  assert.equal(candidates.length,1);
  const [row]=recordingAlternatives(original,candidates);
  assert.equal(row.item.id,"kAnQgluWpkc");
  assert.equal(row.confidence,"review");
});
