import { continueFromReserve, mayRetryContinuation, continueDelay, type Transfer } from './reserve.ts';
import { Ranges } from './ranges.ts';

const equal=(actual:unknown,expected:unknown)=>{if(JSON.stringify(actual)!==JSON.stringify(expected))throw Error(`${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);};
const SIZE=100;
// A reserve relay that answers ranges; each answer may stop early, stay silent, or lie about the range.
function relay(plan:('full'|'half'|'silent'|'wrong'|'busy')[]){
  const asked:number[]=[];
  const open=(from:number,signal:AbortSignal)=>{
    const kind=plan[asked.length]??'full';asked.push(from);
    if(kind==='busy')return Promise.resolve(new Response(null,{status:502}));
    const range=kind==='wrong'?`bytes 0-${SIZE-1}/${SIZE}`:`bytes ${from}-${SIZE-1}/${SIZE}`;
    const end=kind==='half'?from+Math.floor((SIZE-from)/2):SIZE;let at=from;
    const body=new ReadableStream<Uint8Array>({
      start(controller){if(kind==='silent')signal.addEventListener('abort',()=>controller.error(Error('aborted')));},
      pull(controller){
        if(kind==='silent')return new Promise(()=>{});
        if(at<end){controller.enqueue(new Uint8Array(Math.min(10,end-at)).fill(at%251));at+=10;return;}
        if(kind==='half')controller.error(Error('connection reset'));else controller.close();
      },
    });
    return Promise.resolve(new Response(body,{status:206,headers:{'content-range':range}}));
  };
  return {asked,open};
}
function track(prefix:number){
  const ranges=new Ranges();ranges.add(0,prefix);let want:number|undefined;
  return {ranges,seek:(at:number)=>{want=at;},
    next:()=>{if(want!==undefined){const at=ranges.gap(want,SIZE);if(at!==undefined)return at;want=undefined;}return ranges.gap(0,SIZE);},
    place:(offset:number,bytes:Uint8Array)=>{const fresh=!ranges.covers(offset,offset+bytes.length);ranges.add(offset,offset+bytes.length);return Promise.resolve(fresh);}};
}
const fast={idleMs:30,pauseMs:1};

Deno.test('the reserve continues after the opening audio instead of starting over',async()=>{
  const t=track(40),r=relay(['full']);
  await continueFromReserve({size:SIZE,next:t.next,open:r.open,place:t.place,signal:new AbortController().signal,...fast});
  equal(r.asked,[40]);equal(t.ranges.covers(0,SIZE),true);
});

Deno.test('a broken transfer resumes where it stopped, as often as it keeps making progress',async()=>{
  const t=track(0),r=relay(['half','half','half','half','full']);
  await continueFromReserve({size:SIZE,next:t.next,open:r.open,place:t.place,signal:new AbortController().signal,...fast,attempts:2});
  equal(r.asked,[0,50,75,87,93]);
  equal(t.ranges.covers(0,SIZE),true);
});

Deno.test('a silent transfer is dropped and retried, and it gives up after attempts bring nothing',async()=>{
  const t=track(30),r=relay(['silent','full']);
  await continueFromReserve({size:SIZE,next:t.next,open:r.open,place:t.place,signal:new AbortController().signal,...fast});
  equal(r.asked,[30,30]);equal(t.ranges.covers(0,SIZE),true);
  const stuck=track(30),dead=relay(['silent','silent','silent','silent']);let failed=false;
  try{await continueFromReserve({size:SIZE,next:stuck.next,open:dead.open,place:stuck.place,signal:new AbortController().signal,...fast,attempts:3});}catch{failed=true;}
  equal([failed,dead.asked.length],[true,3]);
});

Deno.test('a reserve answering a different range is rejected without retrying',async()=>{
  const t=track(30),r=relay(['wrong','full']);let message='';
  try{await continueFromReserve({size:SIZE,next:t.next,open:r.open,place:t.place,signal:new AbortController().signal,...fast});}catch(error){message=(error as Error).message;}
  equal([message,r.asked.length],['Reserve audio differs',1]);
});

Deno.test('choosing another song stops the reserve at once',async()=>{
  const t=track(30),r=relay(['silent']),control=new AbortController();
  setTimeout(()=>control.abort(),5);let message='';
  try{await continueFromReserve({size:SIZE,next:t.next,open:r.open,place:t.place,signal:control.signal,idleMs:5000,pauseMs:1});}catch(error){message=(error as Error).message;}
  equal([message,r.asked.length],['Cancelled',1]);
});

Deno.test('a relay error is retried, while a different recording stops at once',async()=>{
  const t=track(30),r=relay(['busy','full']);
  await continueFromReserve({size:SIZE,next:t.next,open:r.open,place:t.place,signal:new AbortController().signal,...fast});
  equal([r.asked,t.ranges.covers(0,SIZE)],[[30,30],true]);
});

Deno.test('a seek moves the reserve there, and the skipped part is filled in afterwards without fetching twice',async()=>{
  const t=track(30),r=relay(['silent','full','full']);let jumped=false;
  const onTransfer=(transfer:Transfer|undefined)=>{if(transfer&&!jumped){jumped=true;t.seek(70);setTimeout(()=>transfer.jump(),1);}};
  await continueFromReserve({size:SIZE,next:t.next,open:r.open,place:t.place,signal:new AbortController().signal,idleMs:5000,pauseMs:1,attempts:1,onTransfer});
  // 30 hung, the seek moved it to 70, and the gap 30..70 was filled last, stopping where audio already was.
  equal([r.asked,t.ranges.covers(0,SIZE)],[[30,70,30],true]);
});

Deno.test('only passing failures earn another continuation, a few times per song',()=>{
  equal(mayRetryContinuation('Reserve timeout',1,false),true);
  equal(mayRetryContinuation('No media parts or protocol updates received from server',2,false),true);
  equal(mayRetryContinuation('Reserve timeout',3,false),false);
  equal(mayRetryContinuation('Audio streams differ',1,false),false);
  equal(mayRetryContinuation('Cancelled',1,false),false);
  equal(mayRetryContinuation('Reserve timeout',1,true),false);
});

Deno.test('the rest of a song waits until it is listened to, unless someone seeks past the opening',()=>{
  equal(continueDelay(1000,1000,false),10000);
  equal(continueDelay(1000,6000,false),5000);
  equal(continueDelay(1000,20000,false),0);
  equal(continueDelay(1000,1000,true),0);
});
