import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readCollectionTransfer,mergeCollectionTransfer} from '../src/music-collection-transfer.js';
const track=i=>({kind:'song',id:String(i).padStart(11,'0'),title:`Track ${i}`,artists:['Artist']});
test('phone collection merges 10000 songs idempotently without replacing taste or preferences',()=>{
 const source=JSON.stringify({format:'devil-music-collection',version:1,favorites:[track(5)],playlists:[{id:'phone',name:'Phone library',items:Array.from({length:10000},(_,i)=>track(i))}]});
 const transfer=readCollectionTransfer(source),current={saved:{favorites:[track(20)],playlists:[],volume:.2,sourceBindings:[{trackId:'keep'}]},taste:{entries:{untouched:1},mode:'discovery'}};
 const merged=mergeCollectionTransfer(current,transfer),again=mergeCollectionTransfer(merged,transfer);
 assert.equal(again.saved.playlists[0].items.length,10000);assert.equal(again.saved.favorites.length,2);assert.equal(again.taste,current.taste);assert.equal(again.saved.volume,.2);assert.equal(again.saved.sourceBindings,current.saved.sourceBindings);assert.equal(current.saved.playlists.length,0);
});
test('unsupported formats and device-local tracks cannot enter a transfer',()=>{
 for(const o of [{format:'devil-music-collection',version:99},{format:'devil-music-collection',version:1,favorites:[{...track(1),id:'content://phone/private'}],playlists:[]}])assert.throws(()=>readCollectionTransfer(JSON.stringify(o)));
});
test('adding a collection preserves existing order, metadata and playlist properties',()=>{
 const original={...track(3),title:'My title'};
 const current={saved:{favorites:[original,track(1)],playlists:[{id:'phone',name:'My playlist',pinned:true,items:[original,track(1)]}]},taste:{}};
 const result=mergeCollectionTransfer(current,{favorites:[track(3),track(2)],playlists:[{id:'phone',name:'Incoming',items:[track(3),track(2)]}]});
 assert.deepEqual(result.saved.favorites.map(t=>t.id),[3,1,2].map(i=>track(i).id));
 assert.equal(result.saved.favorites[0].title,'My title');assert.equal(result.saved.playlists[0].name,'My playlist');assert.equal(result.saved.playlists[0].pinned,true);
 assert.deepEqual(result.saved.playlists[0].items.map(t=>t.id),[3,1,2].map(i=>track(i).id));
});
