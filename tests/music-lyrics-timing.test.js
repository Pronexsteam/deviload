import test from 'node:test';
import assert from 'node:assert/strict';
import {timedLyrics,lyricFrame,parseLyrics,leadSinger} from '../src/music-lyrics-timing.js';
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
test('background vocals keep their own word timing beside the lead line',()=>{
 const [line]=timedLyrics([{text:'Lead',at:1,end:5,words:[{text:'Lead',at:1,end:4}],background:[{text:'(echo)',at:2,end:3}],backgroundText:'(echo)'}]);
 assert.equal(line.words.length,1);assert.equal(line.background.length,1);
 const [state]=lyricFrame([line],2.5);
 assert.equal(state.words[0].state,'current');assert.equal(state.background[0].state,'current');assert.equal(state.background[0].progress,.5);
 assert.deepEqual(timedLyrics([{text:'Lead',at:1,end:5,background:[{text:'late',at:6,end:7}]}])[0].background,[]);
});
test('the singer with the most lines leads, and unattributed lyrics have no lead',()=>{
 assert.equal(leadSinger([{agent:'v1'},{agent:'v2'},{agent:'v2'}]),'v2');
 assert.equal(leadSinger([{text:'a'},{agent:''}]),'');
});

test('a short breath between sung lines keeps the line lit, a real break still clears it',()=>{
 // Fast lyrics: each line's words end a tenth of a second before the next line starts.
 const lines=timedLyrics([
  {text:'One',at:1,end:2.9,words:[{text:'One',at:1,end:2.9}]},
  {text:'Two',at:3,end:4.8,words:[{text:'Two',at:3,end:4.8}]},
  {text:'Three',at:9,end:10,words:[{text:'Three',at:9,end:10}]},
 ]);
 assert.equal(lyricFrame(lines,2.95).length,1,'lit through the short breath');
 assert.equal(lyricFrame(lines,2.95)[0].index,0);
 // All its words are sung while it waits for the next line.
 assert.deepEqual(lyricFrame(lines,2.95)[0].words.map(w=>w.state),['sung']);
 assert.equal(lyricFrame(lines,3)[0].index,1);
 // Four seconds of music before the next verse is a break: the focus clears.
 assert.deepEqual(lyricFrame(lines,4.9),[]);
 assert.deepEqual(lyricFrame(lines,5),[]);
 assert.equal(lyricFrame(lines,9)[0].index,2);
});

test('a line ending a breath after the next one starts hands the focus over, a real second voice keeps both',()=>{
 const lines=[{at:1,end:3.4,text:'First'},{at:3,end:5,text:'Second'}];
 assert.deepEqual(lyricFrame(lines,3.2).map(s=>s.index),[1]);
 const duet=[{at:1,end:3.4,text:'Her',agent:'v1'},{at:3,end:5,text:'Him',agent:'v2'}];
 assert.deepEqual(lyricFrame(duet,3.2).map(s=>s.index),[0,1]);
 const choir=[{at:1,end:4.5,text:'Lead'},{at:3,end:5,text:'Choir'}];
 assert.deepEqual(lyricFrame(choir,3.5).map(s=>s.index),[0,1]);
});
