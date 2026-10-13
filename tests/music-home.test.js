import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
const source=readFileSync(new URL("../src/devil-music.js",import.meta.url),"utf8");
const code=source.slice(source.indexOf("  async function personalize("),source.indexOf("  function showLocal("));
const local={id:"local",title:"Regional release"},personal={id:"personal",title:"Related to liked artist"},recent={id:"recent",title:"Last played"};
const base=[{title:"New releases",items:[local]}];
function home(showRegional){
  const ctx={saved:{favorites:[],recent:[recent],showRegional},taste:{},request:1,current:null,sections:[],audio:{paused:true},prepared:[],tracks:items=>items,intent:{enter:id=>ctx.prepared.push(id)},captureListening(){},tasteSeeds:()=>[{id:"liked"}],radio:async()=>[personal],recommend:items=>items,t:s=>s,render(){}};
  return {ctx,...runInNewContext(`(()=>{${code};return {personalize,homeSections};})()`,ctx)};
}
test("regional catalog is never presented as learned personal recommendations",async()=>{
  const h=home(true);await h.personalize(1,base);
  assert.equal(h.ctx.sections[0].title,"For you");assert.equal(h.ctx.sections[0].items.length,1);assert.equal(h.ctx.sections[0].items[0].id,"personal");assert.equal(h.ctx.sections[2],base[0]);
  assert.deepEqual(h.ctx.prepared,["personal"]);
});
test("hiding regional releases retains recent listening and personal discovery",async()=>{
  const h=home(false);await h.personalize(1,base);
  assert.equal(h.ctx.sections.length,2);assert.equal(h.ctx.sections[1].items[0].id,"recent");assert.ok(!h.ctx.sections.flatMap(section=>section.items).some(item=>item.id==="local"));
  h.ctx.tasteSeeds=()=>[];await h.personalize(1,base);assert.equal(h.ctx.sections.length,1);assert.equal(h.ctx.sections[0].title,"Recently played");
});
