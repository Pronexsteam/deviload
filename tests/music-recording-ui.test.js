import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {recordingAlternatives,recordingDescriptor,resolveRecordingSource} from "../src/music-recordings.js";

const source=readFileSync(new URL("../src/music-recording-ui.js",import.meta.url),"utf8").replace(/^import .*;\r?\n/gm,"").replace("export function openRecordingPicker","function openRecordingPicker");
const song=(n,extra={})=>({kind:"song",id:String(n).padStart(11,"0"),title:"Night Drive",artists:["Artist"],duration:200,...extra});
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function fixture({item=song(1),bindings=[],invoke=async()=>({sections:[{items:[song(2)]}]}),save=()=>true}={}){
  let document;
  class Element{
    constructor(tag){this.tagName=tag;this.children=[];this.style={};this.attributes=new Map();this.listeners=new Map();this.disabled=false;this.value="";this.ownText="";this.open=false;}
    set textContent(value){this.ownText=String(value);this.replaceChildren();}get textContent(){return this.ownText+this.children.map(node=>node.textContent).join("");}
    append(...nodes){for(const node of nodes){node.remove();node.parentNode=this;this.children.push(node);}}
    replaceChildren(...nodes){for(const node of this.children)node.parentNode=null;this.children=[];this.append(...nodes);}
    remove(){if(this.parentNode){this.parentNode.children=this.parentNode.children.filter(node=>node!==this);this.parentNode=null;}}
    setAttribute(name,value){this.attributes.set(name,String(value));}getAttribute(name){return this.attributes.get(name);}
    addEventListener(name,callback){if(!this.listeners.has(name))this.listeners.set(name,[]);this.listeners.get(name).push(callback);}
    dispatch(name){const event={preventDefault(){},target:this};return Promise.all((this.listeners.get(name)||[]).map(callback=>callback(event)));}
    click(){if(!this.disabled)return this.dispatch("click");}focus(){document.activeElement=this;}
    showModal(){this.open=true;}close(){if(!this.open)return;this.open=false;this.dispatch("close");}
    get isConnected(){return this===document.body||!!this.parentNode?.isConnected;}
  }
  document={createElement:tag=>new Element(tag),activeElement:null};document.body=new Element("body");
  const previous=new Element("button");document.body.append(previous);previous.focus();
  const button=(label,glyph,action,cls="")=>{const node=document.createElement("button");node.textContent=label;node.className=cls;node.type="button";node.addEventListener("click",action);return node;};
  const cover=item=>{const node=document.createElement("span");node.track=item;return node;};
  const ctx={document,t:value=>value,language:()=>"en",errorText:error=>error.message||String(error),recordingAlternatives,recordingDescriptor,resolveRecordingSource};
  const open=runInNewContext(`(()=>{${source};return openRecordingPicker;})()`,ctx),calls=[],saves=[];
  const modal=open({item,button,cover,bindings:()=>bindings,invoke:(command,args)=>{calls.push({command,args});return invoke(command,args);},save:value=>{saves.push(value);return save(value);}});
  const walk=(root=modal)=>[root,...root.children.flatMap(node=>walk(node))];
  const buttonNamed=name=>walk().find(node=>node.tagName==="button"&&node.textContent===name);
  return {document,modal,previous,calls,saves,walk,buttonNamed,input:walk().find(node=>node.tagName==="input"),form:walk().find(node=>node.tagName==="form")};
}

test("opening source selection makes one bounded search and never selects a result automatically",async()=>{
  const h=fixture({invoke:async()=>({sections:[{items:[song(1),song(2),song(3,{title:"Night Drive (Slowed)"})]}]})});await settle();
  assert.equal(h.calls.length,1);assert.deepEqual({command:h.calls[0].command,args:{...h.calls[0].args}},{command:"music_catalog",args:{kind:"search",value:"Artist Night Drive",filter:"songs",language:"en"}});
  assert.equal(h.saves.length,0);assert.equal(h.modal.open,true);assert.equal(h.input.maxLength,180);
  assert.match(h.modal.textContent,/Matching metadata/);assert.match(h.modal.textContent,/Night Drive \(Slowed\)/);
  assert.match(h.modal.textContent,/This is a different version/);assert.ok(h.buttonNamed("Choose this different version"));
  assert.ok(!h.modal.textContent.includes(song(1).id));assert.equal(h.buttonNamed("Use original source").disabled,true);
});

test("only an explicit result click saves a source; closing restores the original focus",async()=>{
  const source=song(3,{title:"Night Drive (DJ Moon Remix)"});
  const h=fixture({invoke:async()=>({sections:[{items:[source]}]})});await settle();
  assert.equal(h.saves.length,0);await h.buttonNamed("Choose this different version").click();
  assert.deepEqual(h.saves,[source]);assert.equal(h.modal.open,false);assert.equal(h.modal.isConnected,false);assert.equal(h.document.activeElement,h.previous);
});

test("current source metadata is shown, its choice is disabled and reset saves null",async()=>{
  const current=song(2,{title:"Night Drive (Live in Paris)"}),bindings=[{trackId:song(1).id,source:current}];
  const h=fixture({bindings,invoke:async()=>({sections:[{items:[current,song(3)]}]})});await settle();
  assert.match(h.modal.textContent,/Your song/);assert.match(h.modal.textContent,/Current source/);assert.match(h.modal.textContent,/Live in Paris/);
  assert.equal(h.buttonNamed("Currently used").disabled,true);await h.buttonNamed("Currently used").click();assert.equal(h.saves.length,0);
  await h.buttonNamed("Use original source").click();assert.deepEqual(h.saves,[null]);assert.equal(h.modal.open,false);
});

test("failed persistence keeps the dialog open with an actionable error",async()=>{
  let accept=false;const h=fixture({save:()=>accept});await settle();await h.buttonNamed("Use this source").click();
  assert.equal(h.modal.open,true);assert.match(h.modal.textContent,/Could not save your music preferences/);
  assert.equal(h.walk().find(node=>node.getAttribute("role")==="alert").textContent,"Could not save your music preferences.");
  accept=true;await h.buttonNamed("Use this source").click();assert.equal(h.modal.open,false);assert.equal(h.saves.length,2);
});

test("a newer search wins and stale results cannot replace its recording choices",async()=>{
  const first=deferred(),second=deferred();let requests=0;
  const h=fixture({invoke:()=>++requests===1?first.promise:second.promise});
  h.input.value="Another explicit search";await h.form.dispatch("submit");
  second.resolve({sections:[{items:[song(4)]}]});await settle();first.resolve({sections:[{items:[song(2)]}]});await settle();
  const displayed=h.walk().filter(node=>node.track).map(node=>node.track.id);
  assert.ok(displayed.includes(song(4).id));assert.ok(!displayed.includes(song(2).id));assert.equal(h.saves.length,0);
});

test("closing during a search discards late success and failure without reopening or saving",async()=>{
  for(const fail of [false,true]){
    const pending=deferred(),h=fixture({invoke:()=>pending.promise});h.modal.close();
    if(fail)pending.reject(Error("late connection error"));else pending.resolve({sections:[{items:[song(2)]}]});
    await settle();assert.equal(h.modal.isConnected,false);assert.equal(h.document.activeElement,h.previous);assert.equal(h.saves.length,0);
    assert.ok(!h.walk().some(node=>node.track?.id===song(2).id));assert.ok(!h.modal.textContent.includes("late connection error"));
  }
});

test("search input is bounded, repeated pending submit is coalesced and metadata mismatch needs an explicit warning action",async()=>{
  const pending=deferred(),h=fixture({item:song(1,{title:"Night Drive ".repeat(35)}),invoke:()=>pending.promise});
  assert.equal(h.calls[0].args.value.length,180);await h.form.dispatch("submit");assert.equal(h.calls.length,1);
  pending.resolve({sections:[]});await settle();assert.match(h.modal.textContent,/No alternative recordings found/);
  const mismatched=fixture({invoke:async()=>({sections:[{items:[song(2,{artists:["Other artist"],duration:240})]}]})});await settle();
  assert.match(mismatched.modal.textContent,/The artist credits differ/);assert.match(mismatched.modal.textContent,/The duration differs/);
  assert.ok(mismatched.buttonNamed("Choose this different version"));assert.equal(mismatched.saves.length,0);
});
