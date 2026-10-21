import test from 'node:test';
import assert from 'node:assert/strict';
import {MascotMotion} from '../src/mascot-motion.js';
import {BurnProgress} from '../src/burn-progress.js';
import {CompletionScene} from '../src/completion-scene.js';

function fixture() {
  const frames = new Map(), media = new EventTarget(), page = new EventTarget(), viewport = new EventTarget();
  let next = 0, images = 0;
  media.matches = false;
  const context = {clearRect(){},drawImage(){},setTransform(){}};
  function node() {
    const result = new EventTarget(), classes = new Set();
    Object.assign(result,{dataset:{},hidden:false,attributes:{},children:[],style:{setProperty(key,value){this[key]=value;}},
      setAttribute(key,value){this.attributes[key]=value;},
      classList:{add:value=>classes.add(value),remove:value=>classes.delete(value),contains:value=>classes.has(value),toggle(value,force){if(force)classes.add(value);else classes.delete(value);}},
      getContext:kind => kind==='2d'?context:null,
      append(child){this.children.push(child);child.parent=this;},prepend(child){this.children.unshift(child);child.parent=this;},
      remove(){if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);this.parent=null;},
      getBoundingClientRect:() => ({x:10,y:10,left:10,top:10,bottom:60,width:200,height:50}),querySelector:() => null
    });
    return result;
  }
  page.documentElement = {dataset:{motion:'reduced'}};
  page.hidden=false;page.body=node();page.createElement=node;page.querySelector=()=>null;
  Object.assign(globalThis,{document:page,matchMedia:()=>media,devicePixelRatio:1,innerWidth:1000,innerHeight:800,
    requestAnimationFrame:callback=>{frames.set(++next,callback);return next;},cancelAnimationFrame:id=>frames.delete(id),
    addEventListener:viewport.addEventListener.bind(viewport),removeEventListener:viewport.removeEventListener.bind(viewport),
    IntersectionObserver:class{constructor(callback){this.callback=callback;}observe(){}disconnect(){this.disconnected=true;}},
    ResizeObserver:class{constructor(callback){this.callback=callback;}observe(){}disconnect(){this.disconnected=true;}},
    Image:class{constructor(){images++;}decode(){return new Promise(()=>{});}}
  });
  function motion(value) {page.documentElement.dataset.motion=value;page.dispatchEvent(new Event('deviload-motion-change'));}
  return {page,media,node,frames,motion,imageCount:()=>images};
}

test('calm mascot defers sprite loading, cancels frames, and resumes without duplicate loops', () => {
  const h=fixture(),host=h.node(),stage=h.node(),still=h.node(),prop=h.node();
  host.querySelector=selector=>selector==='.companion-stage'?stage:still;
  const mascot=new MascotMotion(host,prop);
  assert.equal(h.imageCount(),0);
  assert.equal(h.frames.size,0);
  assert.equal(still.hidden,false);
  let draws=0,captures=0;
  mascot.ready=true;mascot.images={idle:{},done:{},error:{}};mascot.renderer={render(){draws++;},capture(){captures++;}};
  h.motion('full');
  assert.equal(h.frames.size,1);assert.equal(still.hidden,true);assert.equal(draws,1);
  h.motion('reduced');
  assert.equal(h.frames.size,0);assert.equal(still.hidden,false);assert.equal(mascot.canvas.hidden,true);
  mascot.setState('done');
  assert.equal(draws,1);assert.equal(captures,0);assert.equal(h.frames.size,0);
  h.motion('full');
  assert.equal(draws,2);assert.equal(h.frames.size,1);
  h.motion('full');assert.equal(h.frames.size,1);
  h.media.matches=true;h.media.dispatchEvent(new Event('change'));assert.equal(h.frames.size,0);
  mascot.destroy();mascot.destroy();
  h.media.matches=false;h.motion('full');h.media.dispatchEvent(new Event('change'));
  assert.equal(h.frames.size,0);assert.equal(still.hidden,false);
});

test('calm progress retains numeric progress while disabling fire and resuming classic frames', () => {
  const h=fixture(),burn=new BurnProgress(),host=h.node();let draws=0;
  burn.gl={viewport(){},useProgram(){},uniform2f(){},uniform1f(){},drawArrays(){draws++;},TRIANGLES:4};burn.uniform={};
  burn.visible=true;burn.mount(host,.25,true);burn.setProgress(.72);
  assert.equal(host.attributes['aria-valuenow'],'72');assert.equal(host.style['--progress'],'72%');
  assert.equal(burn.canvas.hidden,true);assert.equal(host.classList.contains('has-combustion'),false);
  assert.equal(draws,0);assert.equal(h.frames.size,0);
  h.motion('full');assert.equal(burn.canvas.hidden,false);assert.equal(draws,1);assert.equal(h.frames.size,1);
  h.motion('reduced');assert.equal(h.frames.size,0);assert.equal(burn.canvas.hidden,true);
  burn.finish();assert.equal(host.attributes['aria-valuenow'],'100');assert.equal(burn.finishing,0);assert.equal(h.frames.size,0);
  const before=draws;burn.destroy();burn.destroy();h.motion('full');
  assert.equal(draws,before);assert.equal(h.frames.size,0);assert.equal(burn.resize.disconnected,true);
});

test('completion bursts stop on calm theme changes and future classic completions still work', () => {
  const h=fixture(),scene=new CompletionScene(),target=h.node(),stage=h.node(),mascot=h.node();let cancelled=0;
  mascot.querySelector=()=>stage;stage.animate=()=>({cancel(){cancelled++;}});
  scene.play(target,mascot);assert.equal(h.frames.size,0);assert.equal(h.page.body.children.length,0);
  h.motion('full');scene.play(target,mascot);
  assert.equal(h.frames.size,1);assert.equal(h.page.body.children.length,1);assert.equal(target.classList.contains('completion-focus'),true);
  h.motion('reduced');assert.equal(h.frames.size,0);assert.equal(h.page.body.children.length,0);assert.equal(cancelled,1);
  assert.equal(target.classList.contains('completion-focus'),false);
  h.motion('full');scene.play(target,mascot);assert.equal(h.frames.size,1);
  scene.destroy();scene.destroy();h.motion('full');scene.play(target,mascot);
  assert.equal(h.frames.size,0);assert.equal(h.page.body.children.length,0);assert.equal(cancelled,2);
});
