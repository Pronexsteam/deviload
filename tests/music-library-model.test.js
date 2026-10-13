import test from 'node:test';
import assert from 'node:assert/strict';
import {playlistCover,movePlaylistTracks,transferPlaylistTracks,selectTrackRange,duplicateGroups,smartPlaylists} from '../src/music-library-model.js';
import {readTaste} from '../src/music-taste.js';

const song=(n,artists=['Artist'],title=`Track ${n}`)=>({kind:'song',id:String(n).padStart(11,'0'),title,artists});
const ids=items=>items.map(item=>item.id);
const cover='data:image/png;base64,iVBORw0KGgo=';

test('playlist covers accept bounded raster data and reject remote or executable sources',()=>{
  assert.equal(playlistCover(cover),cover);
  for(const value of [null,{},'https://example.com/cover.png','javascript:alert(1)','data:image/svg+xml;base64,PHN2Zz4=','data:text/html;base64,PGgxPg==','data:image/png;base64,???',`data:image/png;base64,${'A'.repeat(110000)}`])assert.equal(playlistCover(value),'');
});

test('moving a selection keeps source order, preserves every track and supports dropping at the end',()=>{
  const items=[1,2,3,4,5].map(n=>song(n)),before=structuredClone(items);
  const moved=movePlaylistTracks(items,[song(4).id,song(2).id],song(1).id);
  assert.deepEqual(ids(moved),[2,4,1,3,5].map(n=>song(n).id));
  assert.deepEqual(ids(movePlaylistTracks(items,[song(2).id,song(4).id],null)),[1,3,5,2,4].map(n=>song(n).id));
  assert.equal(movePlaylistTracks(items,[song(2).id],song(2).id),items);
  assert.equal(movePlaylistTracks(items,[song(2).id],'missing'),items);
  assert.deepEqual(items,before);
});

test('copy and move deduplicate the target without mutating either original playlist',()=>{
  const lists=[{id:'source',name:'Source',items:[song(1),song(2),song(3)]},{id:'target',name:'Target',items:[song(2),song(4)]}],before=structuredClone(lists);
  const copied=transferPlaylistTracks(lists,'source','target',[song(1).id,song(2).id]);
  assert.deepEqual(ids(copied[0].items),ids(lists[0].items));
  assert.deepEqual(ids(copied[1].items),[2,4,1].map(n=>song(n).id));
  const moved=transferPlaylistTracks(lists,'source','target',[song(1).id,song(2).id],true);
  assert.deepEqual(ids(moved[0].items),[song(3).id]);
  assert.deepEqual(ids(moved[1].items),[2,4,1].map(n=>song(n).id));
  assert.deepEqual(lists,before);
  assert.equal(transferPlaylistTracks(lists,'source','missing',[song(1).id],true),lists);
  assert.equal(transferPlaylistTracks(lists,'source','source',[song(1).id],true),lists);
});

test('shift selection uses visible order in both directions and preserves earlier selections',()=>{
  const visible=['d','b','a','c'],selected=new Set(['hidden']);
  assert.deepEqual([...selectTrackRange(selected,'c',visible,'b',true)],['hidden','b','a','c']);
  assert.deepEqual([...selectTrackRange(selected,'d',visible,'a',true)],['hidden','d','b','a']);
  assert.deepEqual([...selected],['hidden']);
  assert.equal(selectTrackRange(new Set(['a']),'a',visible,null).has('a'),false);
  assert.deepEqual([...selectTrackRange(selected,'c',visible,'missing',true)],['hidden','c']);
});

test('duplicate detection keeps different performers, collaborations and versions separate',()=>{
  const duplicate=song(2,['Artist'],'  ＮＩＧＨＴ! '),original=song(1,['artist'],'Night');
  const items=[original,duplicate,song(3,['Other'],'Night'),song(4,['Artist'],'Night (Live)'),song(5,[],'Night'),song(6,[],'Night'),song(7,['AB','C'],'Collaboration'),song(8,['A','BC'],'Collaboration')];
  assert.deepEqual(duplicateGroups(items).map(ids),[[original.id,duplicate.id]]);
});

test('smart playlists apply qualified counts, taste, exclusions and the rediscovery date boundary',()=>{
  const now=1800000000000,day=86400000,taste=readTaste(),items=Array.from({length:9},(_,i)=>song(i+1));
  const entry=(item,plays,score,lastPlayed)=>({item,plays,score,lastPlayed,at:lastPlayed});
  for(const value of [entry(items[0],3,2,now-day),entry(items[1],2,1,now-14*day),entry(items[2],20,-2,now-20*day),entry(items[3],8,3,now-day),entry({...items[4],artists:['Blocked']},9,3,now-day),entry(items[5],1,1,now-14*day+1),entry(items[6],0,0,now-30*day)])taste.entries[value.item.id]=value;
  taste.hiddenSongs=[items[3].id];taste.blockedArtists=['blocked'];
  const saved={favorites:[items[6],items[3]],recent:items.slice(0,7)};
  const result=smartPlaylists(saved,taste,[...items,items[8]],now);
  assert.deepEqual(ids(result.frequent),[items[0].id,items[1].id]);
  assert.deepEqual(ids(result.rediscover),[items[6].id,items[1].id]);
  assert.deepEqual(ids(result.liked),[items[6].id]);
  assert.deepEqual(ids(result.discover),[items[7].id,items[8].id]);
});

test('smart lists remain bounded and an empty profile can discover candidates without likes',()=>{
  const taste=readTaste(),candidates=Array.from({length:120},(_,i)=>song(i)),saved={favorites:[],recent:[]};
  const result=smartPlaylists(saved,taste,candidates);
  assert.equal(result.discover.length,100);
  assert.deepEqual(result.frequent,[]);assert.deepEqual(result.rediscover,[]);assert.deepEqual(result.liked,[]);
});
