import {readFileSync} from 'node:fs';
import test from 'node:test';
import {createCinema} from '../src/cinema-player.js';
class Element extends EventTarget {
 constructor(id=''){super();this.id=id;this.hidden=false;this.open=false;this.currentTime=0;this.duration=100;this.ended=false;this.paused=true;this.attrs=new Map();this.children=[];this.value='';this.checked=true;this.classList={toggle(){},add(){},remove(){}};this.style={};this.playCalls=0;}
 setAttribute(k,v){this.attrs.set(k,String(v));}getAttribute(k){return this.attrs.get(k)||null;}removeAttribute(k){this.attrs.delete(k);if(k==='src')this._src='';}
 set src(v){this._src=v;this.attrs.set('src',v);}get src(){return this._src;}
 append(...a){this.children.push(...a);}replaceChildren(...a){this.children=a;}get childElementCount(){return this.children.length;}
 querySelectorAll(){return [];}focus(){}remove(){}load(){this.currentTime=0;}pause(){this.paused=true;}play(){this.paused=false;this.playCalls++;return Promise.resolve();}
 showModal(){this.open=true;}close(){this.open=false;this.dispatchEvent(new Event('close'));}
}
const source=readFileSync(new URL('../src/cinema-player.js',import.meta.url),'utf8');
const flush=async()=>{for(let n=0;n<5;n++)await new Promise(r=>setImmediate(r));};
function setup(controlCancellation=false){
 const els=new Map();for(const m of source.matchAll(/\$\("([^"]+)"\)/g))els.set(m[1],new Element(m[1]));
 const doc=new EventTarget();doc.getElementById=id=>{if(!els.has(id))els.set(id,new Element(id));return els.get(id);};doc.createElement=tag=>new Element(tag);doc.createDocumentFragment=()=>new Element('fragment');globalThis.document=doc;
 const positions={},jobs=[{id:1,status:'done',file:'C:/fixture/one.mp4'},{id:2,status:'done',file:'C:/fixture/two.mp4'}],pending=[];
 const cancels=[],streams=[],currentCalls=[];let failure="";
 const invoke=async(name,args)=>{if(controlCancellation&&name==='cinema_cancel'&&args.playback!==false)return new Promise(resolve=>cancels.push(resolve));if(name==='cinema_entries')return new Promise(resolve=>pending.push({kind:'discovery',resolve}));if(name==='cinema_stream'){streams.push(args.id);if(args.id===failure)throw Error('Fixture unavailable');return {url:'http://127.0.0.1/'+args.id,height:360,qualities:[360]};}if(name==='media_source')return new Promise(resolve=>pending.push({id:args.id,resolve}));if(name==='player_metadata')return {};return null;};
 let onlineActive='',onlinePlay=false,callbacks;const createOnlinePlayer=options=>{callbacks=options;return {async start(id,play){streams.push(id);if(id===failure)throw Error('Fixture unavailable');onlineActive=id;onlinePlay=play;},pause(){onlinePlay=false;},suspend(){onlineActive='';},stop(){onlineActive='';}};};
 const api=createCinema({createOnlinePlayer,invoke,convertFileSrc:x=>x,t:x=>x,errorText:String,getJobs:()=>jobs,getIds:()=>[1,2],getPositions:()=>positions,persistPositions(){},onCut(){},onShare(){},onActivity(){},onCurrent:item=>currentCalls.push(item)});
 return {api,doc,els,onlineState:state=>callbacks.onState(state),onlineActive:()=>onlineActive,onlinePlay:()=>onlinePlay,positions,jobs,pending,cancels,streams,currentCalls,failStream:id=>{failure=id;},video:els.get('player-video')};
}
const run=test;
await run('related search waits for media readiness and queue nodes survive status changes',async()=>{
 const x=setup();x.api.playEntries([{id:'aaaaaaaaaaa',title:'A'},{id:'bbbbbbbbbbb',title:'B'}]);await flush();
 check(x.currentCalls.every(item=>item===null),'related extraction competed with stream startup');
 const fragment=x.els.get('cinema-items').children[0];
 x.onlineState(1);await flush();
 check(x.currentCalls.at(-1).id==='aaaaaaaaaaa','ready video did not start related discovery');
 check(x.els.get('cinema-items').children[0]===fragment,'metadata rebuilt queue and thumbnails');
 x.els.get('player-dialog').close();
});
function check(v,m){if(!v)throw Error(m);}
await run('natural end advances once; failed next stops instead of requesting the remaining queue',async()=>{
 const x=setup();x.failStream('bbbbbbbbbbb');
 x.api.playEntries([{id:'aaaaaaaaaaa',title:'A'},{id:'bbbbbbbbbbb',title:'B'},{id:'ccccccccccc',title:'C'}]);await flush();
 x.onlineState(1);await flush();x.onlineState(0);await flush();
 check(x.streams.join(',')==='aaaaaaaaaaa,bbbbbbbbbbb','failure cascaded through online queue');
 check(!x.els.get('cinema-retry').hidden,'retry missing');check(x.els.get('player-title').textContent==='B','error item lost');
 x.els.get('player-dialog').close();
});
await run('old position never assigned to newly selected file',async()=>{
 const x=setup();x.api.openLocal(1);await flush();x.pending.shift().resolve(x.jobs[0].file);await flush();x.video.dispatchEvent(new Event('loadedmetadata'));await flush();x.video.currentTime=77;
 x.api.openLocal(2);await flush();check(x.positions[x.jobs[0].file]===77,'old position not saved');check(x.positions[x.jobs[1].file]===undefined,'old position copied to new file');
 x.pending.shift()?.resolve(x.jobs[1].file);await flush();x.els.get('player-dialog').close();
});
await run('music intent cancels pending Cinema autoplay',async()=>{
 const x=setup();x.api.openLocal(1);await flush();const p=x.pending.shift();x.doc.dispatchEvent(new Event('deviload:music-play'));p.resolve(x.jobs[0].file);await flush();x.video.dispatchEvent(new Event('loadedmetadata'));await flush();check(x.video.playCalls===0,'late video played over new music intent');x.els.get('player-dialog').close();
});
await run('close rejects late local resolution',async()=>{
 const x=setup();x.api.openLocal(1);await flush();const p=x.pending.shift();x.els.get('player-dialog').close();p.resolve(x.jobs[0].file);await flush();check(!x.video.getAttribute('src'),'closed dialog accepted late source');check(x.video.playCalls===0,'closed dialog played');
});
await run('rapid A-B selection ignores late A resolution',async()=>{
 const x=setup();x.api.openLocal(1);await flush();const a=x.pending.shift();x.api.openLocal(2);await flush();const b=x.pending.shift();b.resolve(x.jobs[1].file);await flush();a.resolve(x.jobs[0].file);await flush();check(x.video.src===x.jobs[1].file,'late A replaced B');x.els.get('player-dialog').close();
});
await run('music intent cancels pending playlist discovery autoplay',async()=>{
 const x=setup();x.api.openOnline();x.els.get('cinema-url').value='https://www.youtube.com/playlist?list=PLfixture';x.els.get('cinema-online-form').dispatchEvent(new Event('submit',{cancelable:true}));await flush();const p=x.pending.shift();x.doc.dispatchEvent(new Event('deviload:music-play'));p.resolve({entries:[{id:'abcdefghijk',title:'Fixture',index:1}],next:null,title:'Fixture'});await flush();x.video.dispatchEvent(new Event('loadedmetadata'));await flush();check(x.video.playCalls===0,'late discovery played over new music intent');x.els.get('player-dialog').close();
});
await run('related selection preserves playlist order and defeats a pending replacement',async()=>{
 const x=setup();const a={id:'aaaaaaaaaaa',title:'A'},b={id:'bbbbbbbbbbb',title:'B'},c={id:'ccccccccccc',title:'C'};
 x.api.playEntries([a,b],0,{address:'https://youtube.com/playlist?list=PLfixture',next:null});await flush();
 x.els.get('cinema-url').value='https://youtube.com/playlist?list=PLnew';x.els.get('cinema-online-form').dispatchEvent(new Event('submit',{cancelable:true}));await flush();const pending=x.pending.shift();
 x.api.playRelated(c);await flush();pending.resolve({entries:[{id:'ddddddddddd',title:'Stale'}],title:'Stale',next:null});await flush();
 check(x.els.get('player-title').textContent==='C','stale playlist replaced explicit selection');
 x.els.get('cinema-prev').dispatchEvent(new Event('click'));await flush();check(x.els.get('player-title').textContent==='B','related reordered playlist');
 x.els.get('cinema-prev').dispatchEvent(new Event('click'));await flush();check(x.els.get('player-title').textContent==='A','original playlist order lost');x.els.get('player-dialog').close();
});
for(const action of ['next','close-reopen','music'])await run(`all prior playback cancels settle before ${action} starts a stream`,async()=>{
 const x=setup(true),entries=[{id:'aaaaaaaaaaa',title:'A'},{id:'bbbbbbbbbbb',title:'B'}];
 x.api.playEntries(entries);await flush();
 if(action==='close-reopen'){x.els.get('player-dialog').close();x.api.playEntries(entries,1);}
 else {if(action==='music')x.doc.dispatchEvent(new Event('deviload:music-play'));x.els.get('cinema-next').dispatchEvent(new Event('click'));}
 await flush();
 // Intentionally finish a newer cancellation first if it was sent too early.
 x.cancels[1]?.();await flush();check(x.streams.length===0,'new stream raced an older native cancel');
 for(let i=0;i<8;i++){for(const resolve of x.cancels.splice(0))resolve();await flush();}
 check(x.streams.length===1&&x.streams[0]==='bbbbbbbbbbb','latest selection did not win');
 check(x.onlineActive()==='bbbbbbbbbbb','wrong embedded video');
 x.els.get('player-dialog').close();for(const resolve of x.cancels.splice(0))resolve();await flush();
});


await run('music pauses embedded playback and close releases its player',async()=>{const x=setup();x.api.playEntries([{id:'aaaaaaaaaaa',title:'A'}]);await flush();x.onlineState(1);check(x.onlinePlay(),'not playing');x.doc.dispatchEvent(new Event('deviload:music-play'));check(!x.onlinePlay(),'music did not pause video');x.els.get('player-dialog').close();check(!x.onlineActive(),'closed embed retained video');});
