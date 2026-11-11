import { Ranges } from './ranges.ts';
import { segmentIndex, segmentAt, sessionStart, SegmentPlacer } from './segments.ts';

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

Deno.test('a session starts at the segment holding the first missing byte',()=>{
  const index={starts:[10,20,30],times:[0,10000,20000],ticks:[0,441000,882000],end:40};
  equal(sessionStart(index,25),{startTimeMs:10000,begin:20,init:10});
  equal(sessionStart(index,15),{startTimeMs:0,begin:0,init:0});
  equal(sessionStart(undefined,25),{startTimeMs:0,begin:0,init:0});
  // A start between two milliseconds is rounded up, so the server never begins at the segment before.
  equal(sessionStart({starts:[10,20,30],times:[0,9999.4,20000],ticks:[0,440973,882000],end:40},25).startTimeMs,10000);
});

// A small fragmented MP4: init (ftyp, moov, sidx) and one moof+mdat per segment, decode times in ticks.
function fragment(sequence:number,decode:number,payload:number){
  const mfhd=new Uint8Array(8),tfhd=new Uint8Array(8),tfdt=new Uint8Array(8);
  new DataView(mfhd.buffer).setUint32(4,sequence);new DataView(tfdt.buffer).setUint32(4,decode);
  return join(box('moof',join(box('mfhd',mfhd),box('traf',join(box('tfhd',tfhd),box('tfdt',tfdt))))),box('mdat',new Uint8Array(payload).fill(sequence)));
}
function song(count=4,step=441000){
  const fragments=Array.from({length:count},(_,i)=>fragment(i+1,i*step,200+i*37));
  const init=join(box('ftyp',new Uint8Array(16)),box('moov',new Uint8Array(40)),sidx(fragments.map(f=>f.length),fragments.map(()=>step)));
  return {file:join(init,...fragments),init,fragments};
}
// Feeds output in uneven pieces and writes what the placer returns into a blank file.
function place(index:any,output:Uint8Array,size:number,piece=7){
  const placer=new SegmentPlacer(index),file=new Uint8Array(size),written:number[]=[];
  for(let at=0;at<output.length;at+=piece)
    for(const [offset,bytes]of placer.push(output.subarray(at,at+piece))){file.set(bytes,offset);written.push(offset);}
  return {file,written};
}

Deno.test('session output lands by each fragment\'s own decode time, wherever the server started',()=>{
  const {file,init,fragments}=song(),index=segmentIndex(file)!;
  equal(index.ticks,[0,441000,882000,1323000]);
  // In order, cut into any pieces: the file comes out byte for byte.
  equal([...place(index,file,file.length,1).file],[...file]);
  equal([...place(index,file,file.length,1000).file],[...file]);
  // Asked for segment 2 and got it: init at 0, then segment 2 at its own offset.
  const fromTwo=place(index,join(init,fragments[2],fragments[3]),file.length);
  equal([...fromTwo.file.subarray(index.starts[2])],[...file.subarray(index.starts[2])]);
  equal([...fromTwo.file.subarray(0,init.length)],[...init]);
  equal(fromTwo.file.subarray(index.starts[0],index.starts[2]).every(b=>b===0),true);
  // Asked for segment 2 but the server sent the song from the start (token check pending): still in place.
  const ignored=place(index,join(init,fragments[0],fragments[1]),file.length);
  equal([...ignored.file.subarray(0,index.starts[2])],[...file.subarray(0,index.starts[2])]);
});

Deno.test('output that is not the expected recording is refused instead of written somewhere',()=>{
  const {file,init,fragments}=song(),index=segmentIndex(file)!;
  const fails=(output:Uint8Array)=>{try{place(index,output,file.length);return '';}catch(error){return (error as Error).message;}};
  equal(fails(join(init,box('free',new Uint8Array(20)),fragments[1])),'Audio streams differ');
  equal(fails(join(init,fragment(9,123,50))),'Audio streams differ');
  // Without an index the output is the file itself, from its first byte.
  equal(place(undefined,new Uint8Array([1,2,3,4,5]),5,2).written,[0,2,4]);
});
