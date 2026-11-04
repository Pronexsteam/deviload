import test from 'node:test';
import assert from 'node:assert/strict';
import {clampLyricsOffset,readLyricsOffsets,saveLyricsOffset} from '../src/music-lyrics-preferences.js';
import {lyricFrame} from '../src/music-lyrics-timing.js';
test('per-recording lyric delay survives reload, is bounded and does not touch other preferences',()=>{
 const data=new Map([['theme','ambient']]),storage={getItem:key=>data.get(key),setItem:(key,value)=>data.set(key,value)};
 let offsets={};for(let i=0;i<105;i++)offsets=saveLyricsOffset(storage,offsets,'song'+i,i/10);
 assert.equal(Object.keys(offsets).length,100);assert.equal(offsets.song104,10);assert.deepEqual(readLyricsOffsets(storage),offsets);assert.equal(data.get('theme'),'ambient');
 offsets=saveLyricsOffset(storage,offsets,'song104',-.2);assert.equal(readLyricsOffsets(storage).song104,-.2);
 assert.deepEqual(readLyricsOffsets({getItem:()=>'{bad'}),{});assert.equal(clampLyricsOffset(Infinity),0);
 const lines=[{at:10,end:12,text:'Word',words:[{at:10,end:12,text:'Word'}]}];
 assert.equal(lyricFrame(lines,9.9).length,0);assert.equal(lyricFrame(lines,9.9+.2)[0].words[0].state,'current');
 assert.equal(lyricFrame(lines,10.1-.2).length,0);
});
