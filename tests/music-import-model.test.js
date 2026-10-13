import test from 'node:test';
import assert from 'node:assert/strict';
import {selectImportMatch,mergeMusicImport} from '../src/music-import-model.js';
import {readTaste} from '../src/music-taste.js';

const song=(n,title='Night Drive',artists=['Artist'])=>({id:String(n).padStart(11,'0'),kind:'song',title,artists});
const state=()=>({favorites:[],recent:[song(8)],playlists:[],collections:[],volume:.6});
const row=(n,extra={})=>({entry:{key:String(n),title:'Night Drive',artists:['Artist'],liked:false,plays:0,...extra},item:song(n)});

test('matching uses stable video IDs and conservative normalized title plus artist evidence',()=>{
  const entry={title:'ＮＩＧＨＴ Drive',artists:['Artist']},item=song(1,'Artist - Night Drive (Official Audio)');
  assert.equal(selectImportMatch(entry,[item]).confidence,'exact');
  const identified=selectImportMatch({...entry,videoId:song(2).id},[item,song(2,'Changed metadata',['Other'])]);
  assert.equal(identified.confidence,'exact');assert.equal(identified.item.id,song(2).id);
  assert.equal(selectImportMatch(entry,[item,song(3)]).confidence,'review');
  assert.equal(selectImportMatch({title:'Night Drive',artists:[]},[song(1)]).confidence,'review');
  assert.equal(selectImportMatch(entry,[song(1,'Unrelated')]).confidence,'none');
});

test('matching never auto-accepts a different recording version or missing artist',()=>{
  const entry={title:'Night Drive',artists:['Artist']};
  for(const version of ['Live','Remix','Slowed','Sped Up','Acoustic','Instrumental','Karaoke','Radio Edit'])assert.notEqual(selectImportMatch(entry,[song(1,`Night Drive (${version})`)]).confidence,'exact');
  assert.equal(selectImportMatch(entry,[song(1,'Night Drive',[])]).confidence,'review');
  assert.equal(selectImportMatch(entry,[song(1,'Night Drive',['Other'])]).confidence,'review');
  assert.equal(selectImportMatch({...entry,title:'Night Drive (Live)'},[song(1,'Night Drive (Live)')]).confidence,'exact');
});

test('featured artist credits do not rank a different artist cover above the original',()=>{
  const entry={title:'Get Lucky',artists:['Daft Punk']};
  const original=song(1,'Get Lucky (feat. Pharrell Williams and Nile Rodgers)',['Daft Punk','Pharrell Williams','Nile Rodgers']);
  const result=selectImportMatch(entry,[song(2,'Get Lucky',['Funk Punk']),original,song(3,'Get Lucky (Radio Edit)',['Daft Punk'])]);
  assert.equal(result.item.id,original.id);
  assert.equal(result.confidence,'review');
});

test('merge preserves unrelated state, adds explicit likes only and leaves history untouched',()=>{
  const saved=state(),taste=readTaste(),before=structuredClone({saved,taste});
  const result=mergeMusicImport(saved,taste,{name:'My archive',source:'spotify',rows:[row(1,{liked:true}),row(2,{plays:4,lastPlayed:1500}),{entry:{},item:null}]},{now:2000});
  assert.deepEqual(saved,before.saved);assert.equal(JSON.stringify(taste),JSON.stringify(before.taste));
  assert.deepEqual(result.saved.favorites.map(item=>item.id),[song(1).id]);
  assert.deepEqual(result.saved.playlists[0].items.map(item=>item.id),[song(2).id]);
  assert.deepEqual(result.saved.recent,saved.recent);assert.equal(result.saved.volume,.6);
  assert.equal(result.taste.entries[song(2).id].plays,4);assert.equal(result.taste.entries[song(2).id].lastPlayed,1500);
  assert.equal(result.added,2);assert.equal(result.skipped,1);
});

test('reimport deduplicates rows and memberships without accumulating preference rewards',()=>{
  const batch={name:'Archive',source:'youtube',rows:[row(1,{plays:4}),row(1,{plays:4}),row(2,{liked:true})]};
  const first=mergeMusicImport(state(),readTaste(),batch,{now:2000});
  const second=mergeMusicImport(first.saved,first.taste,batch,{now:3000});
  assert.deepEqual(second.saved,first.saved);assert.deepEqual(second.taste,first.taste);
  assert.equal(second.added,0);assert.equal(second.skipped,3);
  assert.equal(second.taste.entries[song(1).id].plays,4);
});

test('an imported playlist has a stable identity and never merges into a user list with the same name',()=>{
  const saved=state();saved.playlists=[{id:'custom',name:'Archive',items:[song(9)]}];
  const batch={name:'Archive',source:'spotify',rows:[row(1)]};
  const first=mergeMusicImport(saved,readTaste(),batch);assert.equal(first.saved.playlists.length,2);
  assert.deepEqual(first.saved.playlists[0],saved.playlists[0]);first.saved.playlists[1].name='Renamed';
  const second=mergeMusicImport(first.saved,first.taste,{...batch,rows:[row(1),row(2)]});
  assert.equal(second.saved.playlists.length,2);assert.equal(second.saved.playlists[1].name,'Renamed');assert.equal(second.saved.playlists[1].items.length,2);
});

test('library capacity errors reject the entire proposed import instead of truncating it',()=>{
  const saved=state(),taste=readTaste();saved.playlists=[{id:'full',name:'Full',items:Array.from({length:500},(_,n)=>song(n))}];
  const before=structuredClone({saved,taste});
  assert.throws(()=>mergeMusicImport(saved,taste,{rows:[row(999,{liked:true}),row(1000)]}),/500 playlist entries/);
  assert.deepEqual(saved,before.saved);assert.equal(JSON.stringify(taste),JSON.stringify(before.taste));
  saved.playlists=Array.from({length:30},(_,n)=>({id:String(n),name:String(n),items:[]}));
  assert.throws(()=>mergeMusicImport(saved,taste,{rows:[row(1000)]}),/30 playlists/);
});

test('taste learning can be disabled and imported evidence remains bounded without inventing playback dates',()=>{
  const saved=state(),taste=readTaste();taste.hiddenSongs=[song(1).id];taste.blockedArtists=['other'];
  const disabled=mergeMusicImport(saved,taste,{rows:[row(1,{plays:10})]},{useForTaste:false});
  assert.deepEqual(disabled.taste,taste);
  for(let n=0;n<1000;n++)taste.entries[song(n).id]={item:song(n),score:1,at:n+1,lastPlayed:0,plays:0};
  const result=mergeMusicImport(saved,taste,{rows:[row(2000,{liked:true,plays:50000})]},{now:5000});
  assert.equal(Object.keys(result.taste.entries).length,1000);assert.ok(result.taste.entries[song(2000).id]);
  assert.equal(result.taste.entries[song(2000).id].plays,10000);assert.equal(result.taste.entries[song(2000).id].lastPlayed,0);
  assert.deepEqual(result.taste.hiddenSongs,taste.hiddenSongs);assert.deepEqual(result.taste.blockedArtists,taste.blockedArtists);
});
