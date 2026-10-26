import test from 'node:test';
import assert from 'node:assert/strict';
import {timedLyrics,lyricFrame,parseLyrics} from '../src/music-lyrics-timing.js';
const sample=()=>timedLyrics([{text:'Hello world',at:1,end:5,words:[{text:'Hello ',at:1,end:2},{text:'world',at:3,end:5}]}]);
test('enhanced LRC keeps genuine word times while ordinary lines have no invented words',()=>{
 const lines=parseLyrics('[00:01.00]<00:01.00>Hello <00:02.50>world<00:04.00>\n[00:05.00]Next line');
 assert.equal(lines[0].text,'Hello world');
 assert.deepEqual(lines[0].words,[{text:'Hello ',at:1,end:2.5},{text:'world',at:2.5,end:4}]);
 assert.deepEqual(lyricFrame(lines,3)[0].words.map(w=>w.state),['sung','current']);
 assert.deepEqual(lines[1].words,[]);
 assert.deepEqual(parseLyrics('[00:03]<00:02>Too early')[0].words,[]);
 assert.deepEqual(parseLyrics('[00:01][00:10]<00:01>Repeated').map(l=>l.words),[[],[]]);
});
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

test('enhanced lyric vocal end stops highlighting in a musical break',()=>{
 const lines=parseLyrics('[00:01]<00:01>Hello <00:02>world<00:04>\n[00:08]Next verse');
 assert.equal(lines[0].end,4);
 assert.equal(lyricFrame(lines,3).length,1);
 assert.deepEqual(lyricFrame(lines,4),[]);
 assert.deepEqual(lyricFrame(lines,7),[]);
 assert.equal(lyricFrame(lines,8)[0].index,1);
 assert.equal(parseLyrics('[00:00]Start')[0].end,undefined);
});

test('simultaneous vocal lines remain visible and playback end clears focus',()=>{
 const lines=timedLyrics([{at:1,text:'Lead'},{at:1,text:'Harmony'},{at:5,text:'Together'}]);
 assert.deepEqual(lyricFrame(lines,2).map(s=>s.index),[0,1]);
 assert.deepEqual(lyricFrame(lines,5).map(s=>s.index),[2]);
 assert.deepEqual(lyricFrame(lines,10,10),[]);
 assert.deepEqual(lyricFrame(lines,NaN),[]);
 assert.deepEqual(lyricFrame(lines,2).map(s=>s.index),[0,1]);
});
