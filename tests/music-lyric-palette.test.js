import test from 'node:test';
import assert from 'node:assert/strict';
import {lyricPalette} from '../src/music-lyric-palette.js';
test('monochrome and transparent art use readable neutral lyric colors',()=>{
 const fallback=lyricPalette([]);assert.deepEqual(lyricPalette([0,0,0,255,255,255,255,255,240,0,0,0]),fallback);
});
test('dominant blue and red covers produce distinct bright and dark text colors',()=>{
 assert.deepEqual(lyricPalette([255,0,0,255]),{light:'hsl(0 78% 80%)',dark:'hsl(0 60% 29%)'});
 assert.deepEqual(lyricPalette([0,0,255,255]),{light:'hsl(240 78% 80%)',dark:'hsl(240 60% 29%)'});
});
test('neutral borders do not overwhelm the colored artwork area',()=>{
 const gray=Array.from({length:100},()=>[120,120,120,255]).flat();assert.equal(lyricPalette([...gray,0,200,200,255]).light,'hsl(180 78% 80%)');
});
