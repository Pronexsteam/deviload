import { Ranges } from './ranges.ts';
import { segmentIndex, segmentAt } from './segments.ts';
import { resumeState, type Snapshot } from './resume.ts';

const equal=(actual:unknown,expected:unknown)=>{const a=JSON.stringify(actual),b=JSON.stringify(expected);if(a!==b)throw Error(`${a} !== ${b}`);};

function box(type:string,body:Uint8Array){
  const bytes=new Uint8Array(8+body.length),view=new DataView(bytes.buffer);
  view.setUint32(0,bytes.length);bytes.set([...type].map(c=>c.charCodeAt(0)),4);bytes.set(body,8);return bytes;
}
function sidx(sizes:number[],durations:number[],timescale=44100){
  const body=new Uint8Array(24+sizes.length*12),view=new DataView(body.buffer);
  view.setUint32(4,1);view.setUint32(8,timescale);view.setUint16(22,sizes.length);
  sizes.forEach((size,i)=>{view.setUint32(24+i*12,size);view.setUint32(28+i*12,durations[i]);});
  return box('sidx',body);
}
const join=(...parts:Uint8Array[])=>{const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const p of parts){out.set(p,at);at+=p.length;}return out;};

Deno.test('ranges merge, cover and report the first gap',()=>{
  const ranges=new Ranges();
  ranges.add(0,100);ranges.add(300,400);
  equal(ranges.covers(10,90),true);equal(ranges.covers(90,110),false);
  equal(ranges.gap(0,500),100);equal(ranges.gap(320,500),400);equal(ranges.gap(150,500),150);
  ranges.add(100,300);
  equal(ranges.covers(0,400),true);equal(ranges.total,400);equal(ranges.gap(0,400),undefined);
  equal(ranges.overlaps(350,450),[[350,400]]);
});

Deno.test('the segment index maps bytes to segment start times',()=>{
  const head=join(box('ftyp',new Uint8Array(16)),box('moov',new Uint8Array(40)));
  const index=sidx([1000,1200,900],[441000,441000,220500]);
  const parsed=segmentIndex(join(head,index,new Uint8Array(64)))!;
  const first=head.length+index.length;
  equal(parsed.starts,[first,first+1000,first+2200]);
  equal(parsed.times,[0,10000,20000]);
  equal(parsed.end,first+3100);
  equal(segmentAt(parsed,first-1),-1);equal(segmentAt(parsed,first+1500),1);equal(segmentAt(parsed,first+5000),2);
});

Deno.test('a missing or truncated index is ignored',()=>{
  equal(segmentIndex(box('ftyp',new Uint8Array(8))),undefined);
  const index=sidx([1000],[44100]);
  equal(segmentIndex(index.subarray(0,index.length-4)),undefined);
});

Deno.test('a resumed session starts at the segment with an empty buffer',()=>{
  const base:Snapshot={durationMs:30000,requestNumber:3,activeSabrContexts:[],sabrContextUpdates:[],formats:[
    {formatKey:'140:x',formatInitializationMetadata:{formatId:{itag:140}}},
    {formatKey:'137:x',formatInitializationMetadata:{formatId:{itag:137}}},
  ]};
  const state=resumeState(base,{starts:[10,20,30],times:[0,10000,20000],end:40},2)!;
  equal(state.playerTimeMs,20000);equal(state.requestNumber,3);
  const audio=state.initializedFormats[0];
  equal(audio.downloadedSegments.map(([n]:[number,unknown])=>n),[0,1,2]);
  equal(audio.lastMediaHeaders,[]);
  equal(state.initializedFormats[1].downloadedSegments,[]);
  equal(resumeState(base,{starts:[10],times:[0],end:20},0),undefined);
  const audioOnly=resumeState({...base,formats:[base.formats[0]],formatToDiscard:'248:'},{starts:[10,20],times:[0,10000],end:30},1)!;
  equal(audioOnly.initializedFormats.map((f:any)=>[f.formatKey,f.formatInitializationMetadata.formatId.itag]),[['140:x',140],['248:',248]]);
});
