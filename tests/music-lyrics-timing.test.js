import test from 'node:test';
import assert from 'node:assert/strict';
import {timedLyrics,lyricFrame} from '../src/music-lyrics-timing.js';
const sample=()=>timedLyrics([{text:'Hello world',at:1,end:5,words:[{text:'Hello ',at:1,end:2},{text:'world',at:3,end:5}]}]);
test('word sync follows audio time including gaps, seeking backwards and exact boundaries',()=>{
 const lines=sample();assert.deepEqual(lyricFrame(lines,.9),[]);
 assert.equal(lyricFrame(lines,1.5)[0].words[0].progress,.5);
 assert.deepEqual(lyricFrame(lines,2.5)[0].words.map(w=>w.state),['sung','upcoming']);
 assert.equal(lyricFrame(lines,4)[0].words[1].progress,.5);
 assert.equal(lyricFrame(lines,1)[0].words[0].progress,0);
 assert.deepEqual(lyricFrame(lines,5),[]);
 assert.deepEqual(lyricFrame(lines,4),lyricFrame(lines,4));
});
test('overlapping vocals keep independent end times, plain LRC follows the next line',()=>{
 const lines=sample();lines.push({text:'Harmony',at:2,end:6});
 assert.deepEqual(lyricFrame(lines,4).map(s=>s.index),[0,1]);
 assert.deepEqual(lyricFrame(lines,5.5).map(s=>s.index),[1]);
 assert.deepEqual(lyricFrame([{at:1,text:'A'},{at:2,text:'B'}],2).map(s=>s.index),[1]);
});
test('invalid word timing keeps readable lines, no end time fabricates no duration',()=>{
 for(const words of [[{text:'Wrong',at:1}],[{text:'Hello world',at:NaN}],[{text:'Hello world',at:0}],[{text:'Hello world',at:1,end:10}]]){
  assert.deepEqual(timedLyrics([{text:'Hello world',at:1,end:5,words}])[0].words,[]);
 }
 const lines=timedLyrics([{text:'Long note',at:1,words:[{text:'Long note',at:1}]}]);
 assert.deepEqual(lyricFrame(lines,1.5)[0].words,[{state:'current',progress:1}]);
 assert.deepEqual(timedLyrics(null),[]);
});
