import test from 'node:test';
import assert from 'node:assert/strict';
import {songTask,downloadProgress} from '../src/music-download-progress.js';

const url=id=>`https://www.youtube.com/watch?v=${id}`;
const song={id:'abcdefghijk',title:'Song',after:5,added:1000};

test('a song follows only the task added after its request, for its own video',()=>{
 const jobs=[{id:3,url:url('abcdefghijk'),status:'done'},{id:6,url:url('abcdefghijkl'),status:'running'},{id:7,url:url('zzzzzzzzzzz'),status:'running'},{id:8,url:url('abcdefghijk')+'&list=x',status:'running',percent:40}];
 assert.equal(songTask(song,jobs).id,8);
 assert.equal(songTask(song,jobs.slice(0,3)),null);
});

test('progress averages the songs still going and reports the ones that finished',()=>{
 const other={...song,id:'bbbbbbbbbbb'},third={...song,id:'ccccccccccc'};
 const jobs=[{id:6,url:url(song.id),status:'running',percent:30},{id:7,url:url(other.id),status:'queued',percent:0},{id:8,url:url(third.id),status:'done',percent:100,file:'C:/Music/Song.mp3'}];
 const view=downloadProgress([song,other,third],jobs,2000);
 assert.deepEqual(view.active.map(s=>s.id),[song.id,other.id]);
 assert.equal(view.percent,15);
 assert.equal(view.finished[0].status,'done');assert.equal(view.finished[0].jobId,8);assert.equal(view.finished[0].file,'C:/Music/Song.mp3');
 assert.equal(downloadProgress([song],[{id:9,url:url(song.id),status:'error'}],2000).finished[0].status,'error');
});

test('a request that never reaches the queue stops showing after a minute',()=>{
 assert.equal(downloadProgress([song],[],30000).active.length,1);
 assert.equal(downloadProgress([song],[],70000).active.length,0);
 assert.equal(downloadProgress([song],[{id:6,url:url(song.id),status:'running',percent:250}],2000).percent,100);
});
