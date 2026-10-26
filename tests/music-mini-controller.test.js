import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const code=readFileSync(new URL('../src/music-mini-controller.js',import.meta.url),'utf8').replace(/^import [^\n]*\n/,'').replace('export function','function');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function setup(invoke){
 let click,control;const errors=[];
 const node=()=>({disabled:false,classList:{add(){}},append(){},setAttribute(k,v){this[k]=v;},removeAttribute(k){delete this[k];}});
 const ctx={t:s=>s,errorText:String,onLanguageChange(){},Event:class{},window:{},document:{documentElement:{dataset:{theme:'ambient'}},createElement:node,dispatchEvent(){},addEventListener(){}},setInterval(){}};
 runInNewContext(code+';globalThis.factory=createMusicMiniPlayer',ctx);
 const player=ctx.factory({invoke,button:(text,icon,fn)=>{click=fn;control=node();return control;},extras:node(),getState:()=>({position:0,title:'Test'}),notify:error=>errors.push(error)});
 return {player,click,control,errors};
}
test('rapid mini-player clicks submit a single opening while native creation is slow',async()=>{
 const update=deferred(),open=deferred(),calls=[];
 const ui=setup((name)=>{calls.push(name);return name==='music_mini_open'?open.promise:calls.length===1?update.promise:Promise.resolve();});
 const first=ui.click();await Promise.all(Array.from({length:12},()=>ui.click()));
 assert.deepEqual(calls,['music_mini_update']);assert.equal(ui.control.disabled,true);assert.equal(ui.control['aria-busy'],'true');
 update.resolve();await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(calls,['music_mini_update','music_mini_open']);
 await ui.click();assert.equal(calls.filter(n=>n==='music_mini_open').length,1);
 open.resolve();await first;
 assert.equal(ui.player.isOpen,true);assert.equal(ui.control.disabled,false);assert.equal(ui.control['aria-busy'],undefined);assert.deepEqual(ui.errors,[]);
});
test('failed mini creation releases the launch button for a deliberate retry',async()=>{
 let attempts=0;const ui=setup(async name=>{if(name==='music_mini_open'&&++attempts===1)throw Error('creation failed');});
 await ui.click();assert.equal(ui.control.disabled,false);assert.equal(ui.player.isOpen,false);assert.equal(ui.errors.length,1);
 await ui.click();assert.equal(attempts,2);assert.equal(ui.player.isOpen,true);
});
