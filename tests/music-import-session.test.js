import test from 'node:test';
import assert from 'node:assert/strict';
import {readImportDraft,writeImportDraft,clearImportDraft,IMPORT_DRAFT_KEY} from '../src/music-import-session.js';
import {mergeMusicImport} from '../src/music-import-model.js';
import {exportMusicProfile,importMusicProfile} from '../src/music-profile.js';
import {readTaste} from '../src/music-taste.js';
const entry=n=>({key:'spotify:'+n,title:'Song '+n,artists:['Artist'],liked:true,plays:0});
const item=n=>({kind:'song',id:String(n).padStart(11,'0'),title:'Song '+n,artists:['Artist']});
test('unfinished imports round-trip separately from preferences, retaining selection and committed rows',()=>{
  const data=new Map([['deviload-music-profile-v1','original profile']]),storage={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
  const entries=Array.from({length:6001},(_,n)=>entry(n));
  writeImportDraft(storage,{batch:{entries,name:'Likes',source:'spotify',playlists:[],warnings:[]},rows:[{entry:entry(0),item:item(0),confidence:'exact'},{entry:entry(1),item:item(1),confidence:'review'},{entry:entry(2),item:null}],applied:[entry(0).key],selected:[entry(1).key],destination:'favorites',name:'Likes',useForTaste:false});
  const restored=readImportDraft(storage);assert.equal(restored.batch.entries.length,6001);assert.equal(restored.rows.length,2);assert.equal(restored.rows[1].confidence,'review');assert.deepEqual(restored.selected,[entry(1).key]);assert.deepEqual(restored.applied,[entry(0).key]);assert.equal(data.get('deviload-music-profile-v1'),'original profile');
  clearImportDraft(storage);assert.equal(readImportDraft(storage),null);assert.equal(data.size,1);
  data.set(IMPORT_DRAFT_KEY,'broken');assert.equal(readImportDraft(storage),null);
});
test('the entire large collection survives playlist and favorite profile persistence without taste or history imports',()=>{
  for(const liked of [true,false]){
    const saved={favorites:[],recent:[],playlists:[],collections:[],volume:.6},taste=readTaste(),rows=Array.from({length:6001},(_,n)=>({entry:{...entry(n),liked},item:item(n)}));
    const result=mergeMusicImport(saved,taste,{name:'Full collection',rows},{useForTaste:false});
    const restored=importMusicProfile(exportMusicProfile(result.saved,result.taste));
    assert.equal(liked?restored.saved.favorites.length:restored.saved.playlists[0].items.length,6001);
    assert.deepEqual(restored.taste,taste);assert.deepEqual(restored.saved.recent,[]);assert.deepEqual(saved.favorites,[]);
  }
});
