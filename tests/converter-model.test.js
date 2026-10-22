import test from "node:test";
import assert from "node:assert/strict";
import {actionError, conversionOptions, outputDimensions, serialFileAdder, mediaTracks, originalAudioExtension, trackOptions, copyCompatible, jobError} from "../src/converter-model.js";

test("conversion settings are a frozen snapshot, with size independent of resolution and quality", () => {
  const controls = {preset:"mp4",resolution:"720",quality:"high",megabytes:10,folder:"C:/Exports"};
  const options = conversionOptions(controls);
  controls.resolution = "480"; controls.quality = "smaller"; controls.folder = "C:/Other";
  assert.equal(options.resolution,"720");assert.equal(options.quality,"high");assert.equal(options.folder,"C:/Exports");
  assert.ok(Object.isFrozen(options));
  assert.throws(()=>conversionOptions({preset:"size",megabytes:0}));
  assert.throws(()=>conversionOptions({preset:"size",megabytes:10.5}));
  assert.throws(()=>conversionOptions({resolution:"2160"}));
  assert.throws(()=>conversionOptions({quality:"injected"}));
});
test("maximum resolution preserves orientation and bounds both dimensions without upscaling", () => {
  assert.deepEqual(outputDimensions(1920,1080,"720"),{width:1280,height:720});
  assert.deepEqual(outputDimensions(1080,1920,"720"),{width:720,height:1280});
  assert.deepEqual(outputDimensions(640,360,"1080"),{width:640,height:360});
  assert.deepEqual(outputDimensions(1000,1000,"720"),{width:720,height:720});
  assert.deepEqual(outputDimensions(3840,1080,"720"),{width:1280,height:360});
  assert.deepEqual(outputDimensions(641,361),{width:640,height:360});
  assert.equal(outputDimensions(NaN,100,"720"),null);
});
test("actions reject missing streams and long GIFs before launching the engine", () => {
  assert.match(actionError({video:false,audio:true,duration:20},"mp4"),/no picture/);
  assert.match(actionError({video:true,audio:false,duration:20},"mp3"),/no sound/);
  assert.match(actionError({video:true,audio:true,duration:61},"gif"),/60 seconds/);
  assert.equal(actionError({video:true,audio:false,duration:20},"mp4"),"");
  assert.equal(actionError({video:false,audio:true,duration:180},"size"),"");
});
test("overlapping drops serialize probes and deduplicate files against the completed addition", async () => {
  const items=[], calls=[];let release;
  const first = new Promise(resolve=>release=resolve);
  const add = serialFileAdder({items,windows:true,probe:async paths=>{calls.push(paths);if(calls.length===1)await first;return paths.map(path=>({path}));},append:files=>items.push(...files)});
  const one=add(["C:\\Music\\A.mp4"]),two=add(["c:/music/a.mp4","C:/Music/B.mp4"]);
  await Promise.resolve(); assert.equal(calls.length,1);
  release();await Promise.all([one,two]);
  assert.deepEqual(calls,[["C:\\Music\\A.mp4"],["C:/Music/B.mp4"]]);
  assert.equal(items.length,2);
});
test("a concurrent addition cannot exceed the batch limit; a failed probe does not poison subsequent drops", async () => {
  const items=[],calls=[];
  const add=serialFileAdder({items,limit:2,probe:async paths=>{calls.push(paths);if(paths.includes("bad.mp4"))throw Error("probe failed");return paths.map(path=>({path}));},append:files=>items.push(...files)});
  await assert.rejects(add(["bad.mp4"]),/probe failed/);
  const outcomes=await Promise.allSettled([add(["a.mp4","b.mp4"]),add(["c.mp4"])]);
  assert.equal(outcomes[0].status,"fulfilled");assert.equal(outcomes[1].status,"rejected");
  assert.equal(items.length,2);assert.equal(calls.length,2);
  assert.deepEqual(await add(["a.mp4"]),[]);
});

const movie = {path:"movie.mkv",video:true,audio:true,duration:20,tracks:[
  {index:0,kind:"video",codec:"h264"}, {index:1,kind:"audio",codec:"aac",language:"en"},
  {index:2,kind:"audio",codec:"flac",language:"ja"}, {index:3,kind:"subtitle",codec:"subrip"}
]};
test("new actions distinguish original extraction from lossy MP3 and compatible containers", () => {
  assert.equal(originalAudioExtension("aac"),"m4a");assert.equal(originalAudioExtension("opus"),"opus");assert.equal(originalAudioExtension("flac"),"flac");
  assert.equal(originalAudioExtension("mp3"),"");assert.match(actionError({audio:true,tracks:[{kind:"audio",codec:"mp3"}]},"audio"),/AAC/);
  assert.equal(conversionOptions({preset:"remux",container:"mov"}).container,"mov");
  assert.equal(conversionOptions({preset:"audio"}).preset,"audio");
  assert.throws(()=>conversionOptions({preset:"remux",container:"mp4;evil"}));
  assert.equal(copyCompatible("mkv",movie.tracks[3]),true);
  assert.equal(copyCompatible("mp4",movie.tracks[3]),false);
  assert.equal(copyCompatible("mp4",movie.tracks[1]),true);
  assert.equal(copyCompatible("mov",movie.tracks[2]),false);
});
test("track selections are frozen per file and do not leak unrelated stream indices into a batch", () => {
  const first = {...movie,selection:{audioTracks:[2],subtitleTracks:[3]}};
  const second = {video:true,audio:true,tracks:[{index:5,kind:"video",codec:"hevc"},{index:7,kind:"audio",codec:"opus"}]};
  const one=trackOptions(first,"remux"),two=trackOptions(second,"remux");
  assert.deepEqual(one,{videoTrack:0,audioTracks:[2],subtitleTracks:[3]});
  assert.deepEqual(two,{videoTrack:5,audioTracks:[7],subtitleTracks:[]});
  first.selection.audioTracks.push(1);assert.deepEqual(one.audioTracks,[2]);assert.ok(Object.isFrozen(one.audioTracks));
  assert.deepEqual(trackOptions(first,"gif").audioTracks,[]);
  assert.deepEqual(trackOptions(first,"size").subtitleTracks,[]);
});
test("copy compatibility reports selected-track conflicts instead of dropping tracks silently", () => {
  const chosen={...movie,selection:{audioTracks:[1],subtitleTracks:[3]}};
  assert.match(jobError(chosen,"remux","mp4"),/cannot be copied/);
  assert.equal(jobError(chosen,"remux","mkv"),"");
  assert.equal(jobError(chosen,"mp4","mp4"),"");
  const picture={...movie,tracks:[...movie.tracks,{index:4,kind:"subtitle",codec:"hdmv_pgs_subtitle"}],selection:{subtitleTracks:[4]}};
  assert.match(jobError(picture,"mp4"),/text subtitles/);assert.equal(jobError(picture,"remux","mkv"),"");
});
test("one-track exports choose a matching original codec and preserve explicit no-audio choices", () => {
  assert.deepEqual(trackOptions({...movie,selection:{audioTracks:[2,1]}},"audio").audioTracks,[2]);
  assert.deepEqual(trackOptions({...movie,selection:{audioTracks:[]}},"remux").audioTracks,[]);
  assert.match(jobError({...movie,selection:{audioTracks:[]}},"mp3"),/one audio track/);
  assert.equal(mediaTracks({video:false,audio:true,audioCodec:"aac"},"audio")[0].index,0);
});
