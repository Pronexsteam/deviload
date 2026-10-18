import test from "node:test";
import assert from "node:assert/strict";
import {createMusicDiagnostics} from "../src/music-diagnostics.js";
globalThis.document={documentElement:{}};
const {wirePlaybackSettings}=await import("../src/music-playback-settings.js");
const {t}=await import("../src/i18n.js");

function node(){return {children:[],dataset:{},listeners:{},disabled:false,textContent:"",value:"209715200",append(...children){this.children.push(...children);},addEventListener(name,fn){this.listeners[name]=fn;},emit(name){return this.listeners[name]?.({target:this});},focus(){},showModal(){},close(){}};}
function setup(invoke){
  const ids=Object.fromEntries(["music-preferences","music-settings-open","music-settings-close","music-playback-settings","music-cache-limit"].map(id=>[id,node()]));
  const panel=ids["music-playback-settings"],status=node(),clear=node(),update=node(),actions=node();
  panel.querySelector=selector=>({"[role=status]":status,"[data-clear-cache]":clear,"[data-update-engine]":update,".setting-actions":actions}[selector]);
  document.getElementById=id=>ids[id];document.createElement=()=>node();
  const diagnostics=createMusicDiagnostics();diagnostics.error("resolve","network error https://signed.example/?token=private C:/private");
  wirePlaybackSettings(invoke,{diagnostics});return {ids,panel,status,clear,update,report:actions.children[0]};
}
test("report export is explicit, disables concurrent actions and submits sanitized bounded facts",async()=>{
  const calls=[];let complete;
  const p=setup((command,args)=>{calls.push({command,args});return new Promise(resolve=>complete=resolve);});
  assert.equal(calls.length,0);const exportJob=p.report.emit("click");
  assert.equal(p.report.disabled,true);assert.equal(p.clear.disabled,true);assert.equal(p.update.disabled,true);
  await p.report.emit("click");assert.equal(calls.length,1);
  assert.equal(calls[0].command,"export_music_diagnostics");assert.equal(calls[0].args.events[0].code,"network");
  assert.ok(!/private|signed.example|token|C:\//.test(JSON.stringify(calls[0].args)));
  complete(true);await exportJob;assert.equal(p.report.disabled,false);assert.equal(p.status.textContent,t("Playback report saved. You can review it before sharing."));
});
test("opening playback settings reads engine facts and cancelling export preserves existing status",async()=>{
  const calls=[];const p=setup(async(command)=>{calls.push(command);return command==="music_cache"?{bytes:1048576,limit:209715200}:command==="music_diagnostics"?{engine:{running:true}}:false;});
  p.panel.open=true;p.panel.emit("toggle");await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(calls,["music_cache","music_diagnostics"]);assert.equal(p.panel.children[0].textContent,t("Music engine: running."));
  const before=p.status.textContent;await p.report.emit("click");assert.equal(p.status.textContent,before);assert.equal(p.report.disabled,false);
});
