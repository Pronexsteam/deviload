import test from 'node:test';
import assert from 'node:assert/strict';
import {createMotionCover,isMotionCover} from '../src/music-motion.js';

test('motion cover deduplicates loads, rejects stale tracks and releases hidden video',async()=>{
  const oldDocument=globalThis.document,oldMatch=globalThis.matchMedia;
  const doc=new EventTarget();doc.hidden=false;
  const reduced=new EventTarget();reduced.matches=false;
  let host={child:null,append(n){this.child=n;},contains(n){return this.child===n;}};
  const created=[];
  doc.createElement=()=>{const n=new EventTarget();Object.assign(n,{paused:true,classList:{add(){}},setAttribute(){},removeAttribute(){this.src='';},pause(){this.paused=true;},play(){this.paused=false;return Promise.resolve();},load(){},remove(){if(host.child===this)host.child=null;}});created.push(n);return n;};
  globalThis.document=doc;globalThis.matchMedia=()=>reduced;
  try{
    const calls=[];let visible=true,playing=true;
    const controller=createMotionCover({invoke:(_name,args)=>new Promise(resolve=>calls.push({args,resolve})),convertFileSrc:p=>'asset:'+p,host,isVisible:()=>visible,isPlaying:()=>playing});
    const a={id:'a',title:'A',artists:['Artist']},b={id:'b',title:'B',artists:['Artist']};
    const one=controller.update(a),two=controller.update(a);await Promise.resolve();assert.equal(calls.length,1);
    const three=controller.update(b);await Promise.resolve();calls[0].resolve('/a.mp4');await Promise.all([one,two]);assert.equal(created.length,0);
    calls[1].resolve('/b.mp4');await three;assert.equal(host.child.src,'asset:/b.mp4');assert.equal(host.child.paused,false);
    assert.equal(isMotionCover(host.child),true);assert.equal(isMotionCover({muted:true,className:'music-motion-cover'}),false);
    playing=false;controller.sync();assert.equal(host.child.paused,true);
    doc.hidden=true;controller.sync();assert.equal(host.child,null);assert.equal(created[0].src,'');
    doc.hidden=false;await controller.update(b);assert.equal(calls.length,2);assert.ok(host.child);
    reduced.matches=true;await controller.update(b);assert.equal(host.child,null);
    controller.dispose();
  }finally{globalThis.document=oldDocument;globalThis.matchMedia=oldMatch;}
});
