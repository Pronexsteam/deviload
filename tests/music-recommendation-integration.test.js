import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const source=readFileSync(new URL("../src/devil-music.js",import.meta.url),"utf8");
const code=source.slice(source.indexOf("  function visibleRecommendation("),source.indexOf("  function persistSession("));
function impressions(){
  const timers=new Map(),shown=[],observed=[];let serial=0,callback;
  const ctx={privateSession:false,contextRevision:0,recommendationRevision:0,recommendationObserver:null,recommendationNodes:new Map(),recommendationIntersections:new Map(),impressionTimers:new Map(),
    innerWidth:800,innerHeight:600,dock:{hidden:false,offsetHeight:80},
    document:{hidden:false,hasFocus:()=>true,querySelector:()=>({dataset:{page:"music"}})},
    recommendationSession:{markShown:items=>shown.push(...items)},
    IntersectionObserver:class {constructor(fn){callback=fn;}observe(node){observed.push(node);}disconnect(){observed.length=0;}},
    setTimeout(fn,delay){assert.equal(delay,500);const id=++serial;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id)};
  const actions=runInNewContext(`(()=>{${code};return {observeRecommendation,refreshRecommendationImpressions,clearRecommendationObservations};})()`,ctx);
  const rect={left:0,right:200,top:100,bottom:300,width:200,height:200};
  const node={isConnected:true,getBoundingClientRect:()=>rect};
  return {ctx,shown,node,rect,...actions,enter:(intersecting=true,ratio=1)=>callback([{target:node,isIntersecting:intersecting,intersectionRatio:ratio}]),flush(){const pending=[...timers.values()];timers.clear();pending.forEach(fn=>fn());},pending:()=>timers.size};
}

test("recommendation exposure requires half a visible card and foreground dwell, not just DOM render",()=>{
  const h=impressions(),item={id:"00000000001"};h.observeRecommendation(h.node,item);
  assert.equal(h.shown.length,0);h.rect.top=600;h.rect.bottom=800;h.enter();h.flush();assert.equal(h.shown.length,0);
  h.rect.top=450;h.rect.bottom=650;h.enter();h.flush();assert.equal(h.shown.length,0); // Most of the card is behind the player/outside the viewport.
  h.rect.top=100;h.rect.bottom=300;h.enter();assert.equal(h.pending(),1);assert.equal(h.shown.length,0);h.flush();
  assert.deepEqual(h.shown,[item]);
});

test("private, background, detached and stale-context cards do not create impressions",()=>{
  for(const reason of ["private","background","blurred","detached","context"]){
    const h=impressions();h.observeRecommendation(h.node,{id:"00000000001"});h.enter();
    if(reason==="private")h.ctx.privateSession=true;
    else if(reason==="background")h.ctx.document.hidden=true;
    else if(reason==="blurred")h.ctx.document.hasFocus=()=>false;
    else if(reason==="detached")h.node.isConnected=false;
    else h.ctx.contextRevision++;
    h.flush();assert.equal(h.shown.length,0,reason);
  }
});

test("leaving the viewport or replacing a shelf cancels its unfinished impression",()=>{
  const h=impressions();h.observeRecommendation(h.node,{id:"00000000001"});h.enter();assert.equal(h.pending(),1);
  h.rect.top=700;h.rect.bottom=900;h.enter();assert.equal(h.pending(),0);h.flush();assert.equal(h.shown.length,0);
  h.rect.top=100;h.rect.bottom=300;h.refreshRecommendationImpressions();assert.equal(h.pending(),1);
  h.clearRecommendationObservations();assert.equal(h.pending(),0);h.flush();assert.equal(h.shown.length,0);
});

test("a card clipped by its horizontal shelf is not exposed even when its rectangle is inside the viewport",()=>{
  const h=impressions();h.observeRecommendation(h.node,{id:"00000000001"});
  h.refreshRecommendationImpressions();h.flush();assert.equal(h.shown.length,0); // Await the first actual observer result.
  h.enter(false,0);h.flush();assert.equal(h.shown.length,0);
  h.enter(true,.2);h.flush();assert.equal(h.shown.length,0);
  h.enter(true,.8);assert.equal(h.pending(),1);h.enter(false,0);h.flush();assert.equal(h.shown.length,0);
  h.enter(true,.8);h.flush();assert.equal(h.shown.length,1);
});
