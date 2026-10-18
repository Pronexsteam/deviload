import test from "node:test";
import assert from "node:assert/strict";
import {losslessSelection,preciseCutTime} from "../src/quick-cut.js";

const project = () => ({clips:[{jobId:7,start:1.234,end:9.876,look:{speed:1,volume:1}}],audio:[],music:null,canvas:"16:9",fit:"fit"});
test("lossless selection retains requested source times and accepts original framing independently of rendered quality", () => {
  const value = project();
  assert.deepEqual(losslessSelection(value), {id:7,start:1.234,end:9.876});
  assert.equal(preciseCutTime(59.9996),"1:00.000");
  assert.equal(preciseCutTime(1.234),"0:01.234");
  assert.equal(preciseCutTime(NaN),"—");
});
test("lossless mode refuses timelines and effects that stream copy would silently discard", () => {
  for (const mutate of [p=>p.clips.push({...p.clips[0]}),p=>p.audio.push({jobId:8}),p=>p.music={jobId:8},
    ...Object.entries({speed:2,volume:.5,fadeIn:true,fadeOut:true,rotate:90,flip:true,brightness:.2,contrast:1.2,saturation:0,caption:"Text",transition:"fade"}).map(([key,value])=>p=>p.clips[0].look[key]=value),
    p=>p.clips[0].start=NaN,p=>p.clips[0].end=Infinity,p=>p.clips[0].end=1.235]) {
    const value=project();mutate(value);assert.throws(()=>losslessSelection(value));
  }
});
