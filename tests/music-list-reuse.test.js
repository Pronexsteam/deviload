import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
test('short reverse scroll reuses cover nodes while long jumps evict detached rows',()=>{
 let offset=0,created=0;const listeners={},frames=[];
 const node=()=>({children:[],style:{},classList:{add(){}},setAttribute(){},isConnected:true,addEventListener(){},removeEventListener(){},getBoundingClientRect:()=>({top:-offset,height:144}),append(...children){for(const child of children){child.parent=this;this.children.push(child);}},insertBefore(child,before){child.remove();child.parent=this;this.children.splice(this.children.indexOf(before),0,child);},remove(){if(this.parent){this.parent.children.splice(this.parent.children.indexOf(this),1);this.parent=null;}},get nextSibling(){return this.parent?.children[this.parent.children.indexOf(this)+1]||null;}});
 const body=node(),container=node();container.parentElement=body;
 const win={scrollY:0,addEventListener:(key,fn)=>listeners[key]=fn,removeEventListener:key=>delete listeners[key],scrollTo(){}};
 const ctx={document:{createElement:node,body},window:win,innerHeight:144,requestAnimationFrame:fn=>{frames.push(fn);return frames.length;},cancelAnimationFrame(){},ResizeObserver:class{observe(){}disconnect(){}}};
 const source=readFileSync(new URL('../src/music-virtual-list.js',import.meta.url),'utf8').replaceAll('export ','');
 const mount=runInNewContext(source+';mountMusicList',ctx),items=Array.from({length:10000},(_,id)=>({id}));
 const view=mount(container,items,()=>{created++;return node();});const first=container.children[1];
 const scroll=position=>{offset=position;listeners.scroll();frames.shift()();};
 scroll(720);const count=created;scroll(0);assert.equal(container.children[1],first);assert.equal(created,count);
 for(let i=1;i<20;i++)scroll(i*7200);const before=created;scroll(0);assert.ok(created>before);assert.ok(container.children.length<=82);
 view.destroy();assert.equal(listeners.scroll,undefined);
});
