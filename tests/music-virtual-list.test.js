import test from 'node:test';
import assert from 'node:assert/strict';
import {musicListRange,musicThumbnail} from '../src/music-virtual-list.js';
test('large libraries keep a bounded viewport, including end-of-list and oversized windows',()=>{
 for(const count of [1420,1500,5000])for(const offset of [0,500,25000,count*72-800]){const r=musicListRange(count,offset,800);assert.ok(r.start>=0);assert.ok(r.end<=count);assert.ok(r.end-r.start<=80);assert.ok(r.start*72<=Math.max(0,offset));}
 assert.equal(musicListRange(5000,5000*72-800,800).end,5000);
 assert.ok(musicListRange(5000,0,100000).end<=80);
});
test('list artwork uses small provider thumbnails while unrelated artwork URLs stay untouched',()=>{
 assert.equal(musicThumbnail('https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg'),'https://i.ytimg.com/vi/abcdefghijk/mqdefault.jpg');
 assert.equal(musicThumbnail('https://lh3.googleusercontent.com/x=w544-h544-l90-rj'),'https://lh3.googleusercontent.com/x=w96-h96-l90-rj');
 const other='https://example.com/x=w544-h544';assert.equal(musicThumbnail(other),other);
});
