import test from "node:test";
import assert from "node:assert/strict";
import {musicGain,gainFromVolumePosition,volumePositionFromGain,volumePercent} from "../src/music-volume.js";
import {readMusicState} from "../src/music-state.js";
import {exportMusicProfile,importMusicProfile} from "../src/music-profile.js";
import {readTaste} from "../src/music-taste.js";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

test("quiet-end positions offer finer control and zero remains exact silence",()=>{
  assert.equal(gainFromVolumePosition(0),0);assert.equal(gainFromVolumePosition(1),1);
  assert.equal(gainFromVolumePosition(.01),.0001);assert.equal(gainFromVolumePosition(.1),.010000000000000002);
  let previous=-1;for(let percent=0;percent<=100;percent++){const gain=gainFromVolumePosition(percent/100);assert.ok(gain>previous);previous=gain;}
  for(const bad of [NaN,Infinity,-Infinity,undefined,".5"]){assert.equal(gainFromVolumePosition(bad),0);assert.equal(musicGain(bad),.7);}
});
test("legacy state, imported backups and default preserve physical output across the new curve",()=>{
  for(const gain of [0,.0001,.01,.35,.7,1]){
    const saved=readMusicState({getItem:()=>JSON.stringify({favorites:[],recent:[],volume:gain})});
    const restored=importMusicProfile(exportMusicProfile(saved,readTaste())).saved;
    assert.equal(restored.volume,gain);assert.ok(Math.abs(gainFromVolumePosition(volumePositionFromGain(restored.volume))-gain)<1e-14);
  }
  const defaults=readMusicState();assert.equal(defaults.volume,.7);assert.equal(volumePercent(defaults.volume),84);
  // 84% is the position of the new curve; existing users still hear gain .7.
  assert.ok(Math.abs(gainFromVolumePosition(volumePositionFromGain(defaults.volume))-.7)<1e-14);
});

test("muting, closing and importing a profile retain the previous quiet output for unmute",()=>{
  const gain=gainFromVolumePosition(.05),state={favorites:[],recent:[],volume:0,volumeBeforeMute:gain};
  const saved=readMusicState({getItem:()=>JSON.stringify(state)});
  const restored=importMusicProfile(exportMusicProfile(saved,readTaste())).saved;
  assert.equal(restored.volume,0);assert.equal(restored.volumeBeforeMute,gain);assert.equal(volumePercent(restored.volumeBeforeMute),5);
  const invalid=readMusicState({getItem:()=>JSON.stringify({...state,volumeBeforeMute:-1})});assert.equal(invalid.volumeBeforeMute,undefined);
});

test("actual player volume wiring reports curved percent and mute restores the prior output",()=>{
  const source=readFileSync(new URL("../src/devil-music.js",import.meta.url),"utf8"),code=source.slice(source.indexOf("  const volume=el("),source.indexOf("  extras.append(queueButton"));
  const field=()=>({attrs:{},value:"",events:{},setAttribute(name,value){this.attrs[name]=value;},addEventListener(name,fn){this.events[name]=fn;}});
  let toggle;const audio={volume:.7},saved={volume:.7};
  const ctx={audio,saved,musicGain,gainFromVolumePosition,volumePositionFromGain,volumePercent,el:field,decks:{setVolume(value){audio.volume=value;}},button(_label,_icon,action){toggle=action;return field();},t:(text,params)=>text.replace("{percent}",params?.percent),onLanguageChange(){},setTimeout:()=>1,clearTimeout(){},persist(){}};
  const controls=runInNewContext(`(()=>{${code}\nreturn {volume,volumeMark};})()`,ctx);
  assert.equal(controls.volume.title,"Volume: 84%");assert.equal(controls.volume.attrs["aria-valuetext"],"84%");assert.equal(audio.volume,.7);
  controls.volume.value=".05";controls.volume.events.input();const quiet=gainFromVolumePosition(.05);assert.equal(saved.volume,quiet);assert.equal(saved.volumeBeforeMute,quiet);
  toggle();assert.equal(audio.volume,0);assert.equal(controls.volumeMark.attrs["aria-label"],"Unmute");
  toggle();assert.equal(audio.volume,quiet);assert.equal(controls.volume.title,"Volume: 5%");assert.equal(controls.volume.attrs["aria-valuetext"],"5%");
});
