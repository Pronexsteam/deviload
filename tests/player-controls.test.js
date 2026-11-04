import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../src/player-controls.js',import.meta.url),'utf8').replaceAll('export ','');
function controls(){
 const listeners={},frames=new Map();let serial=0,queries=0,mutation,disconnected=false;
 const input=()=>({min:'0',max:'100',value:'0',isConnected:true,matches:()=>true,
  style:{values:new Map(),getPropertyValue(key){return this.values.get(key);},setProperty(key,value){this.values.set(key,value);}}});
 const seek=input(),volume=input(),nodes=[seek,volume];
 const document={hidden:false,documentElement:{},querySelectorAll:()=>{queries++;return nodes;},addEventListener:(name,fn)=>listeners[name]=fn};
 const api=runInNewContext(`(()=>{${source};return {registerPlaybackRange,isRangeDragging};})()`,{document,
  window:{addEventListener:(name,fn)=>listeners[name]=fn},requestAnimationFrame:fn=>{frames.set(++serial,fn);return serial;},cancelAnimationFrame:id=>frames.delete(id),
  MutationObserver:class {constructor(fn){mutation=fn;}observe(){}disconnect(){disconnected=true;}}});
 return {api,document,seek,volume,nodes,listeners,input,get queries(){return queries;},get disconnected(){return disconnected;},get pending(){return frames.size;},
  mutate:nodeType=>mutation([{addedNodes:[{nodeType}],removedNodes:[]}]),frame(){const [id,fn]=frames.entries().next().value||[];if(fn){frames.delete(id);fn();}}};
}
test('playback paints smooth values without rescanning the document on every frame or text update',()=>{
 const h=controls();let position=0;h.api.registerPlaybackRange(h.seek,()=>++position);
 for(let i=0;i<120;i++){h.mutate(3);h.frame();}
 assert.equal(h.queries,1);assert.equal(h.seek.value,'120');assert.equal(h.seek.style.values.get('--range-progress'),'100.0000%');
 const added=h.input();added.value='25';h.nodes.push(added);h.mutate(1);h.frame();
 assert.equal(h.queries,2);assert.equal(added.style.values.get('--range-progress'),'25.0000%');
 h.nodes.splice(0,1);h.seek.isConnected=false;h.mutate(1);h.frame();assert.equal(h.queries,3);
});
test('dragged seeks remain under user control and visibility restarts exactly one animation loop',()=>{
 const h=controls();h.api.registerPlaybackRange(h.seek,()=>80);h.listeners.pointerdown({target:h.seek});h.seek.value='30';h.frame();
 assert.equal(h.seek.value,'30');assert.equal(h.api.isRangeDragging(h.seek),true);
 h.listeners.pointerup();h.frame();assert.equal(h.seek.value,'80');
 h.document.hidden=true;h.frame();assert.equal(h.pending,0);
 h.document.hidden=false;h.listeners.visibilitychange();h.listeners.visibilitychange();assert.equal(h.pending,1);
 h.listeners.pagehide();assert.equal(h.pending,0);assert.equal(h.disconnected,true);
});

test('track fill ends at the native thumb centre at both ends and intermediate positions',()=>{
 const h=controls();h.seek.min='20';h.seek.max='120';
 for(const fraction of [0,.1,.5,.9,1]){
  h.seek.value=String(20+fraction*100);h.listeners.input({target:h.seek});
  const fill=h.seek.style.values.get('--range-fill'),parts=fill.match(/calc\(([\d.]+)% \+ (-?[\d.]+) \*/);
  assert(parts);
  for(const width of [80,400,900]){
   const edge=Number(parts[1])/100*width+Number(parts[2])*10;
   assert(Math.abs(edge-(5+fraction*(width-10)))<.001);
  }
 }
});
