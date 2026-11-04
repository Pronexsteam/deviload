import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
test('queue pointer handle reorders across virtual rows and cleans up canceled captures',()=>{
 const events=()=>({listeners:{},addEventListener(key,fn){this.listeners[key]=fn;},removeEventListener(key){delete this.listeners[key];}});
 const classes=()=>({add(){},remove(){}}),handle={...events(),style:{}},row={classList:classes()},target={dataset:{trackId:'other'},classList:classes(),getAttribute:()=> '5'};
 let captured=false;const moves=[],frames=[];
 const panel={...events(),isConnected:true,hidden:false,scrollTop:0,contains:()=>true,querySelectorAll:()=>[target],getBoundingClientRect:()=>({top:0,bottom:300}),setPointerCapture(){captured=true;},hasPointerCapture:()=>captured,releasePointerCapture(){captured=false;}};
 const ctx={document:{elementFromPoint:()=>({closest:()=>target})},requestAnimationFrame:fn=>{frames.push(fn);return frames.length;},cancelAnimationFrame(){}};
 const wire=runInNewContext(readFileSync(new URL('../src/music-queue-drag.js',import.meta.url),'utf8').replace('export function','function')+';wireQueueHandle',ctx);
 wire(handle,row,panel,'first',(...args)=>moves.push(args));
 const e={button:0,isPrimary:true,pointerId:2,clientX:0,clientY:10,preventDefault(){},stopPropagation(){}};
 handle.listeners.pointerdown(e);panel.listeners.pointerup(e);assert.equal(moves.length,0);assert.equal(captured,false);
 handle.listeners.pointerdown(e);panel.listeners.pointermove({...e,clientY:150});panel.listeners.pointerup(e);assert.deepEqual(moves,[['first',4]]);assert.equal(captured,false);assert.deepEqual(Object.keys(panel.listeners),[]);
 handle.listeners.pointerdown(e);panel.listeners.pointermove({...e,clientY:160});panel.listeners.pointercancel(e);assert.equal(moves.length,1);assert.equal(captured,false);assert.equal(handle.draggable,false);
});
