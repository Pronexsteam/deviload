import test from "node:test";
import assert from "node:assert/strict";
import {createMusicDiscovery} from "../src/music-discovery.js";

const id=value=>String(value).padStart(11,"0");
const mbid=value=>`00000000-0000-4000-8000-${String(value).padStart(12,"0")}`;
const track=(value=1,extra={})=>({id:id(value),kind:"song",title:"Night Drive",artists:["Artist"],duration:200,...extra});
const recording=(value=1,extra={})=>({mbid:mbid(value),title:"Night Drive",artists:["Artist"],duration:200,...extra});
const catalog=items=>({sections:[{items}]});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({rows=[recording()],items=[track()],now=()=>0}={}){
  const calls=[],invoke=async(command,args)=>{calls.push({command,...args});return command==="music_discovery"?{recordings:rows}:catalog(items);};
  return {calls,discovery:createMusicDiscovery({invoke,now})};
}

test("public discovery derives at most two primary artists and uses only allowed tags and bounded song searches",async()=>{
  const f=fixture(),seeds=[track(1,{artists:[" Artist ","Guest"]}),track(2,{artists:["artist"]}),track(3,{artists:["Another"]}),track(4,{artists:["Third"]})];
  const result=await f.discovery.candidates({seeds,tags:[" Jazz ","unknown","PHONK","jazz","rock"],language:"es"});
  assert.deepEqual(f.calls[0],{command:"music_discovery",artists:["Artist","Another"],tags:["jazz","phonk"]});
  assert.deepEqual(f.calls[1],{command:"music_catalog",kind:"search",value:"Artist Night Drive",filter:"songs",language:"es"});
  assert.equal(result[0].id,id(1));assert.equal(f.calls.length,2);
});

test("automatic candidates require exact titles, all artist credits, versions and known close duration",async()=>{
  const good=track(2,{title:"Artist - Night Drive (Official Audio)",duration:200.5}),bad=[
    track(3,{title:"Night Drive (Slowed)"}),track(4,{title:"Night Drive (Live)"}),track(5,{title:"Night Drive (Cover)"}),
    track(6,{title:"Night Drives"}),track(7,{artists:["Artist","Guest"]}),track(8,{artists:["Someone else"]}),
    track(9,{duration:undefined}),track(10,{duration:NaN}),track(11,{duration:220}),track(12,{artists:[]}),
  ];
  const f=fixture({items:[...bad,good]});const result=await f.discovery.candidates({artists:["Artist"]});
  assert.deepEqual(result.map(item=>item.id),[good.id]);
  for(const item of bad){
    const only=fixture({items:[item]});assert.deepEqual(await only.discovery.candidates({artists:["Artist"]}),[],item.title);
  }
});

test("an explicitly named slowed, live or remixed recording keeps that exact version when resolved",async()=>{
  for(const version of ["Slowed 0.8x","Live in Tokyo 2020","DJ Moon Remix","2011 Remastered"]){
    const title=`Night Drive (${version})`,f=fixture({rows:[recording(1,{title})],items:[track(1),track(2,{title}),track(3,{title:"Night Drive (DJ Sun Remix)"})]});
    assert.deepEqual((await f.discovery.candidates({artists:["Artist"]})).map(item=>item.id),[id(2)],version);
  }
});

test("incomplete recording metadata does not consume catalog searches or guess a playable version",async()=>{
  const rows=[recording(1,{duration:undefined}),recording(2,{duration:Infinity}),recording(3,{artists:[]}),recording(4,{mbid:"not-a-mbid"}),recording(5,{title:""}),recording(6,{duration:90000})];
  const f=fixture({rows});assert.deepEqual(await f.discovery.candidates({artists:["Artist"]}),[]);
  assert.equal(f.calls.length,1);
});

test("each augmentation searches at most three distinct complete recordings from a bounded metadata response",async()=>{
  const rows=[recording(1),recording(1),recording(2),...Array.from({length:20},(_,index)=>recording(index+3,{title:`Song ${index}`}))];
  const f=fixture({rows,items:[]});assert.deepEqual(await f.discovery.candidates({artists:["Artist"]}),[]);
  const searches=f.calls.filter(call=>call.command==="music_catalog");assert.equal(searches.length,3);
  assert.deepEqual(searches.map(call=>call.value),["Artist Night Drive","Artist Song 0","Artist Song 1"]);
});

test("fresh hourly resolution rotates three of twelve cached metadata recordings without increasing search budget",async()=>{
  let now=0;const calls=[],rows=Array.from({length:12},(_,index)=>recording(index+1,{title:`Song ${index}`}));
  const discovery=createMusicDiscovery({now:()=>now,invoke:async(command,args)=>{
    calls.push({command,...args});if(command==="music_discovery")return {recordings:rows};
    const index=Number(args.value.match(/Song (\d+)$/)[1]);return catalog([track(index+1,{title:`Song ${index}`})]);
  }});
  for(let hour=0;hour<5;hour++){
    now=hour*3600000;
    const items=await discovery.candidates({artists:["Artist"]}),start=hour*3%12;
    assert.deepEqual(items.map(item=>item.id),[0,1,2].map(offset=>id((start+offset)%12+1)));
    const previous=calls.length;now+=3599999;await discovery.candidates({artists:["Artist"]});assert.equal(calls.length,previous);
  }
  assert.equal(calls.filter(call=>call.command==="music_catalog").length,15);
});

test("hourly rotation skips incomplete metadata before choosing its three-recording window",async()=>{
  let now=3600000;
  const rows=[recording(1,{duration:undefined}),...Array.from({length:4},(_,index)=>recording(index+2,{title:`Song ${index}`}))];
  const f=fixture({rows,items:[],now:()=>now});await f.discovery.candidates({artists:["Artist"]});
  assert.deepEqual(f.calls.filter(call=>call.command==="music_catalog").map(call=>call.value),["Artist Song 3","Artist Song 0","Artist Song 1"]);
});

test("resolved songs have a small safe source shape and cannot carry MBIDs, stream URLs, local paths or unsafe images",async()=>{
  const raw=track(1,{image:"https://evil.example/image.png",subtitle:" Official\n Audio ",mbid:mbid(1),url:"file:///secret",stream:"https://evil.example/audio",token:"secret"});
  const f=fixture({items:[raw,track(2,{id:"file:///bad"})]}),result=await f.discovery.candidates({artists:["Artist"]});
  assert.deepEqual(result,[{id:id(1),kind:"song",title:"Night Drive",artists:["Artist"],duration:200,image:"",subtitle:"Official Audio"}]);
  assert.equal(raw.token,"secret");assert.equal(raw.subtitle," Official\n Audio ");
});

test("public metadata failures and retryable backoff are silent and do not create a negative cache",async()=>{
  for(const failure of [()=>{throw Error("service absent");},()=>({recordings:[],retryable:true}),()=>null]){
    const calls=[];let first=true;
    const discovery=createMusicDiscovery({invoke:async(command,args)=>{calls.push({command,...args});if(command==="music_catalog")return catalog([track()]);if(first){first=false;return failure();}return {recordings:[recording()]};}});
    assert.deepEqual(await discovery.candidates({artists:["Artist"]}),[]);
    assert.equal((await discovery.candidates({artists:["Artist"]}))[0].id,id(1));assert.equal(calls.filter(call=>call.command==="music_discovery").length,2);
  }
});

test("usable metadata from a partially successful retryable lookup resolves within budget without caching the partial result",async()=>{
  const calls=[],rows=Array.from({length:8},(_,index)=>recording(index+1,{title:`Song ${index}`}));
  const discovery=createMusicDiscovery({now:()=>0,invoke:async(command,args)=>{
    calls.push({command,...args});if(command==="music_discovery")return {recordings:rows,retryable:true};
    const index=Number(args.value.match(/Song (\d+)$/)[1]);return catalog([track(index+1,{title:`Song ${index}`})]);
  }});
  for(let attempt=0;attempt<2;attempt++){
    const result=await discovery.candidates({artists:["Successful seed","Unavailable seed"]});
    assert.deepEqual(result.map(item=>item.id),[id(1),id(2),id(3)]);
    assert.equal(calls.filter(call=>call.command==="music_discovery").length,attempt+1);
    assert.equal(calls.filter(call=>call.command==="music_catalog").length,(attempt+1)*3);
  }
});

test("real no-results use a ten-minute negative cache while resolved candidates last an hour",async()=>{
  let now=1000;
  const empty=fixture({rows:[],now:()=>now});
  await empty.discovery.candidates({artists:["Artist"]});now+=599999;await empty.discovery.candidates({artists:["Artist"]});assert.equal(empty.calls.length,1);
  now++;await empty.discovery.candidates({artists:["Artist"]});assert.equal(empty.calls.length,2);
  const good=fixture({now:()=>now});await good.discovery.candidates({artists:["Artist"]});now+=3599999;await good.discovery.candidates({artists:["Artist"]});assert.equal(good.calls.length,2);
  now++;await good.discovery.candidates({artists:["Artist"]});assert.equal(good.calls.length,4);
});

test("cache entries are isolated from caller mutations and clear resets completed results",async()=>{
  const f=fixture(),first=await f.discovery.candidates({artists:["Artist"]});first[0].title="Changed";first[0].artists.push("Injected");first.push(track(3));
  const second=await f.discovery.candidates({artists:["Artist"]});assert.equal(second.length,1);assert.equal(second[0].title,"Night Drive");assert.deepEqual(second[0].artists,["Artist"]);assert.equal(f.calls.length,2);
  f.discovery.clear();await f.discovery.candidates({artists:["Artist"]});assert.equal(f.calls.length,4);
});

test("the transient cache contains at most twenty-four recently used seed keys",async()=>{
  const f=fixture({rows:[]});for(let i=0;i<24;i++)await f.discovery.candidates({artists:[`Artist ${i}`]});
  await f.discovery.candidates({artists:["Artist 0"]});await f.discovery.candidates({artists:["Artist 24"]});assert.equal(f.calls.length,25);
  await f.discovery.candidates({artists:["Artist 0"]});assert.equal(f.calls.length,25);
  await f.discovery.candidates({artists:["Artist 1"]});assert.equal(f.calls.length,26);
});

test("twenty-four distinct in-flight lookups bound retained work without preventing equivalent coalescing",async()=>{
  const wait=deferred(),calls=[],discovery=createMusicDiscovery({invoke:async(command,args)=>{calls.push({command,...args});return wait.promise;}});
  const requests=Array.from({length:24},(_,index)=>discovery.candidates({artists:[`Artist ${index}`]}));
  const same=discovery.candidates({artists:["Artist 0"]});assert.deepEqual(await discovery.candidates({artists:["Artist 24"]}),[]);assert.equal(calls.length,24);
  wait.resolve({recordings:[]});await Promise.all([...requests,same]);assert.equal(calls.length,24);
  await discovery.candidates({artists:["Artist 24"]});assert.equal(calls.length,25);
});

test("parallel equivalent lookups coalesce before catalog searches and retain independent result copies",async()=>{
  const wait=deferred(),calls=[],discovery=createMusicDiscovery({invoke:async(command,args)=>{calls.push({command,...args});return command==="music_discovery"?wait.promise:catalog([track()]);}});
  const first=discovery.candidates({artists:["Artist","Other"],tags:["jazz","rock"]});
  const second=discovery.candidates({artists:["other","ARTIST"],tags:["rock","jazz"]});assert.equal(calls.length,1);
  wait.resolve({recordings:[recording()]});const [a,b]=await Promise.all([first,second]);assert.equal(calls.length,2);assert.deepEqual(a,b);assert.notEqual(a[0],b[0]);assert.notEqual(a[0].artists,b[0].artists);
});

test("an obsolete consumer cannot cancel a coalesced lookup still needed by another current consumer",async()=>{
  const wait=deferred(),calls=[];let firstCurrent=true;
  const discovery=createMusicDiscovery({invoke:async(command)=>{calls.push(command);return command==="music_discovery"?wait.promise:catalog([track()]);}});
  const first=discovery.candidates({artists:["Artist"],isCurrent:()=>firstCurrent});
  const second=discovery.candidates({artists:["Artist"],isCurrent:()=>true});firstCurrent=false;wait.resolve({recordings:[recording()]});
  const [a,b]=await Promise.all([first,second]);assert.deepEqual(a,[]);assert.equal(b[0].id,id(1));assert.deepEqual(calls,["music_discovery","music_catalog"]);
});

test("an obsolete or throwing guard prevents network work before starting",async()=>{
  const f=fixture();assert.deepEqual(await f.discovery.candidates({artists:["Artist"],isCurrent:()=>false}),[]);
  assert.deepEqual(await f.discovery.candidates({artists:["Artist"],isCurrent:()=>{throw Error("closed");}}),[]);assert.equal(f.calls.length,0);
  assert.deepEqual(await createMusicDiscovery().candidates({artists:["Artist"]}),[]);
});

test("obsolescence after public metadata stops catalog work and never writes a late cache",async()=>{
  const wait=deferred(),calls=[];let current=true,first=true;
  const discovery=createMusicDiscovery({invoke:async(command)=>{calls.push(command);if(command==="music_catalog")return catalog([track()]);if(first){first=false;return wait.promise;}return {recordings:[recording()]};}});
  const pending=discovery.candidates({artists:["Artist"],isCurrent:()=>current});current=false;wait.resolve({recordings:[recording()]});assert.deepEqual(await pending,[]);assert.deepEqual(calls,["music_discovery"]);
  assert.equal((await discovery.candidates({artists:["Artist"]}))[0].id,id(1));assert.equal(calls.filter(value=>value==="music_discovery").length,2);
});

test("obsolescence during a catalog search drops results and stops later recording searches",async()=>{
  const wait=deferred(),calls=[];let current=true;
  const discovery=createMusicDiscovery({invoke:async(command)=>{calls.push(command);return command==="music_discovery"?{recordings:[recording(),recording(2,{title:"Second"})]}:wait.promise;}});
  const pending=discovery.candidates({artists:["Artist"],isCurrent:()=>current});await tick();assert.equal(calls.length,2);
  current=false;wait.resolve(catalog([track()]));assert.deepEqual(await pending,[]);assert.equal(calls.length,2);
});

test("clear invalidates old metadata calls without letting them overwrite a newer cache for the same key",async()=>{
  const old=deferred(),calls=[];let first=true;
  const discovery=createMusicDiscovery({invoke:async(command)=>{calls.push(command);if(command==="music_catalog")return catalog([track(2)]);if(first){first=false;return old.promise;}return {recordings:[recording()]};}});
  const pending=discovery.candidates({artists:["Artist"]});discovery.clear();assert.equal((await discovery.candidates({artists:["Artist"]}))[0].id,id(2));
  old.resolve({recordings:[]});assert.deepEqual(await pending,[]);assert.equal((await discovery.candidates({artists:["Artist"]}))[0].id,id(2));assert.equal(calls.length,3);
});

test("clear during catalog resolution drops the late track and prevents further searches",async()=>{
  const wait=deferred(),calls=[];let block=true;
  const discovery=createMusicDiscovery({invoke:async(command)=>{calls.push(command);if(command==="music_discovery")return {recordings:[recording(),recording(2,{title:"Second"})]};return block?wait.promise:catalog([track()]);}});
  const pending=discovery.candidates({artists:["Artist"]});await tick();discovery.clear();wait.resolve(catalog([track()]));assert.deepEqual(await pending,[]);assert.equal(calls.length,2);
  block=false;assert.equal((await discovery.candidates({artists:["Artist"]}))[0].id,id(1));assert.equal(calls.filter(value=>value==="music_discovery").length,2);
});

test("a failed recording search leaves later matches available but does not cache the incomplete attempt",async()=>{
  const calls=[];let failures=1;
  const discovery=createMusicDiscovery({invoke:async(command,args)=>{calls.push({command,...args});if(command==="music_discovery")return {recordings:[recording(1,{title:"First"}),recording(2)]};if(args.value.endsWith("First")&&failures-->0)throw Error("catalog offline");return catalog([track()]);}});
  assert.equal((await discovery.candidates({artists:["Artist"]}))[0].id,id(1));await discovery.candidates({artists:["Artist"]});assert.equal(calls.filter(call=>call.command==="music_discovery").length,2);
});

test("closest matching duration wins and duplicate playable sources do not multiply candidates",async()=>{
  const f=fixture({rows:[recording(),recording(2,{title:"Night Drive (Official Audio)"})],items:[track(1,{duration:200.8}),track(2,{duration:200.1}),track(3,{duration:200.6})]});
  const result=await f.discovery.candidates({artists:["Artist"]});assert.deepEqual(result.map(item=>item.id),[id(2)]);
});

test("unknown artists need an allowed explicit tag and a supplied empty artist list does not leak seed artists",async()=>{
  const f=fixture();assert.deepEqual(await f.discovery.candidates({seeds:[track(1,{artists:["Unknown artist"]})],tags:["untrusted"]}),[]);assert.equal(f.calls.length,0);
  await f.discovery.candidates({seeds:[track()],artists:[],tags:["pop"],language:"unsupported"});assert.deepEqual(f.calls[0],{command:"music_discovery",artists:[],tags:["pop"]});assert.equal(f.calls[1].language,"en");
});

test("queries remain bounded even when complete metadata contains long titles and collaboration credits",async()=>{
  const title="N".repeat(500),artists=["A".repeat(100),"B".repeat(100)],f=fixture({rows:[recording(1,{title,artists})],items:[track(1,{title,artists,image:"https://i.ytimg.com/vi/test/default.jpg"})]});
  assert.equal((await f.discovery.candidates({artists:["Artist"]})).length,1);assert.equal(f.calls[1].value.length,180);
});
