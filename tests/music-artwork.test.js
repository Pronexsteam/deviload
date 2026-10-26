import test from 'node:test';
import assert from 'node:assert/strict';
import {artworkCandidates,loadArtwork,applyBrowseArtwork} from '../src/music-artwork.js';
test('contextual artwork restores album header and missing track covers without contaminating artists or recommendations',()=>{
 const image='https://lh3.googleusercontent.com/album=w600-h600',own='https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg';
 const album={kind:'album',id:'MPREalbum',title:'Album',image:''};
 const sections=[{title:'',items:[{id:'a',kind:'song',image:''},{id:'b',kind:'song',image:own}]},{title:'You may also like',items:[{id:'c',kind:'song',image:''}]}];
 const result=applyBrowseArtwork(album,sections,{id:album.id,image},album.id);
 assert.equal(result.item.image,image);assert.equal(result.sections[0].items[0].image,image);assert.equal(result.sections[0].items[1].image,own);assert.equal(result.sections[1].items[0].image,'');assert.equal(album.image,'');
 assert.deepEqual(applyBrowseArtwork(album,sections,{id:'MPREother',image},album.id),{item:album,sections});
 assert.equal(applyBrowseArtwork({...album,kind:'artist'},sections,{id:album.id,image},album.id).sections,sections);
 const back=applyBrowseArtwork(result.item,result.sections,{id:album.id,image},album.id);assert.deepEqual(back,result);
});
test('large artwork upgrades known providers with the original as fallback; list images stay small',()=>{
 const google='https://lh3.googleusercontent.com/cover=w120-h120-l90-rj';
 assert.deepEqual(artworkCandidates(google,1024),['https://lh3.googleusercontent.com/cover=w1024-h1024-l90-rj',google]);
 const youtube='https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg';
 assert.deepEqual(artworkCandidates(youtube,1024),['https://i.ytimg.com/vi/abcdefghijk/maxresdefault.jpg',youtube]);
 assert.equal(artworkCandidates(youtube,96)[0],'https://i.ytimg.com/vi/abcdefghijk/mqdefault.jpg');
 for(const url of ['file:///secret','https://evil.example/x','https://user:password@i.ytimg.com/x','https://i.ytimg.com:8080/x'])assert.deepEqual(artworkCandidates(url),[]);
});

test('missing large YouTube covers fall back through medium quality before the small original',()=>{
 const raw='https://i.ytimg.com/vi/abcdefghijk/default.jpg';
 assert.deepEqual(artworkCandidates(raw,1024),['maxresdefault','hqdefault','default'].map(name=>raw.replace('default.jpg',name+'.jpg')));
 assert.equal(artworkCandidates('https://lh3.googleusercontent.com/cover=s120-c',640)[0],'https://lh3.googleusercontent.com/cover=s640-c');
 assert.ok(!artworkCandidates(raw,NaN)[0].includes('NaN'));
});

test('offscreen covers are lazy before the first request and small placeholders trigger a bounded fallback',()=>{
 const events={},requests=[];
 const img={addEventListener:(name,fn)=>events[name]=fn,remove(){this.removed=true;},set src(url){requests.push({url,loading:this.loading,decoding:this.decoding});},naturalWidth:120};
 const raw='https://i.ytimg.com/vi/abcdefghijk/default.jpg';
 assert.equal(loadArtwork(img,raw,1024),true);
 assert.equal(requests[0].loading,'lazy');assert.equal(requests[0].decoding,'async');
 events.load();assert.ok(requests[1].url.endsWith('/hqdefault.jpg'));
 events.error();assert.equal(requests[2].url,raw);events.error();assert.equal(img.removed,true);assert.equal(requests.length,3);
 assert.equal(loadArtwork(img,'file:///secret'),false);assert.equal(requests.length,3);
});
