import { stallClock } from './stall.ts';

const equal=(actual:unknown,expected:unknown)=>{if(actual!==expected)throw Error(`${actual} !== ${expected}`);};

Deno.test('a slow download that keeps moving never expires',()=>{
  let time=0;const stalled=stallClock(100,()=>time);
  for(let bytes=0;bytes<50;bytes++){time+=90;equal(stalled(bytes),false);}
});

Deno.test('a download that stops expires after the limit',()=>{
  let time=0;const stalled=stallClock(100,()=>time);
  equal(stalled(10),false);time=100;equal(stalled(10),false);time=101;equal(stalled(10),true);
  equal(stalled(11),false);
});
