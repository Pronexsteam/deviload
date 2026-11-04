import test from 'node:test';
import assert from 'node:assert/strict';
import {playlistId,collectPlaylist,scriptCandidates} from '../src-tauri/spotify-import.mjs';
import {parseMusicImport} from '../src/music-import-format.js';
import {readPlaylistLink} from '../src/music-import-resolver.js';
import {selectImportMatch} from '../src/music-import-model.js';
import {readImportDraft,writeImportDraft} from '../src/music-import-session.js';

const id=n=>String(n).padStart(22,'0'),uri=n=>'spotify:track:'+id(n);
const track=n=>({itemV2:{data:{uri:uri(n),name:'Same title',artists:{items:[{profile:{name:'Artist'}}]},trackDuration:{totalMilliseconds:180000+n},albumOfTrack:{name:'Album'}}}});
const response=(items,total)=>({data:{playlistV2:{name:'My playlist',content:{items,totalCount:total}}}});
test('full Spotify pagination preserves different recordings, reports missing metadata and normalizes without loss',async()=>{
 const rows=Array.from({length:1476},(_,i)=>track(i));rows[100].itemV2.data.name='';const offsets=[];
 const batch=await collectPlaylist(id(9),async(offset,limit)=>{offsets.push(offset);return response(rows.slice(offset,offset+limit),rows.length);});
 assert.deepEqual(offsets,[0,343,686,1029,1372]);assert.equal(batch.receivedCount,1476);assert.equal(batch.entries.length,1475);assert.equal(batch.unavailableCount,1);assert.equal(batch.unidentified[0].uri,uri(100));
 const result=await readPlaylistLink('https://open.spotify.com/playlist/'+id(9),{invoke:async()=>batch});
 assert.equal(result.entries.length,1475);assert.equal(result.completeness,'complete');assert.equal(result.reportedTotal,1476);assert.equal(result.entries[0].durationMs,180000);
 assert.equal(new Set(result.entries.map(e=>e.key)).size,1475);
 let saved;const storage={setItem:(_,v)=>saved=v,getItem:()=>saved};writeImportDraft(storage,{batch:result,rows:[],selected:[],applied:[],useForTaste:false});
 const restored=readImportDraft(storage);assert.deepEqual(restored.batch.entries,result.entries);assert.deepEqual(restored.batch.unidentified,[{uri:uri(100)}]);assert.equal(restored.batch.reportedTotal,1476);assert.equal(restored.useForTaste,false);
});
test('same Spotify ID deduplicates while equal title/artist with different IDs survives file import',()=>{
 const tracks=[1,2,1].map(n=>({name:'Same',artists:['Artist'],uri:uri(n),duration_ms:180000,album:{name:'Album'}}));
 const parsed=parseMusicImport(JSON.stringify({tracks}),'playlist.json');assert.equal(parsed.entries.length,2);assert.equal(parsed.entries[0].spotifyId,id(1));assert.equal(parsed.entries[0].album,'Album');
});
test('duration rejects wrong recordings and disambiguates matching titles',()=>{
 const song=(n,d)=>({kind:'song',id:String(n).padStart(11,'0'),title:'Song',artists:['Artist'],duration:d});
 const entry={title:'Song',artists:['Artist'],durationMs:180000};
 assert.equal(selectImportMatch(entry,[song(1,270)]).confidence,'review');
 assert.equal(selectImportMatch(entry,[song(1,270),song(2,181)]).item.id,song(2,181).id);
 assert.equal(selectImportMatch(entry,[song(1,270),song(2,181)]).confidence,'exact');
});
test('explicit featured artists can match while missing credits and different editions remain reviewable',()=>{
 const entry={title:'Lifestyle',artists:['Rich Gang','Young Thug','Rich Homie Quan'],durationMs:269693};
 const song={kind:'song',id:'abcdefghijk',title:'Lifestyle (feat. Young Thug & Rich Homie Quan)',artists:['Rich Gang'],duration:270};
 assert.equal(selectImportMatch(entry,[song]).confidence,'exact');
 assert.equal(selectImportMatch(entry,[{...song,title:'Lifestyle'}]).confidence,'review');
 for(const suffix of [' (Live)',' (Remix)',' (Slowed)',' (Instrumental)'])assert.equal(selectImportMatch(entry,[{...song,title:song.title+suffix}]).confidence,'review');
 assert.equal(selectImportMatch(entry,[{...song,duration:310}]).confidence,'review');
});
test('missing or changing pages fail instead of declaring a truncated playlist complete',async()=>{
 await assert.rejects(collectPlaylist(id(1),async offset=>response(offset?[]:[track(1)],3)));
 await assert.rejects(collectPlaylist(id(1),async offset=>response([track(offset+1)],offset?3:2)),/changed/);
 const abort=new AbortController();abort.abort();await assert.rejects(collectPlaylist(id(1),()=>assert.fail(),{signal:abort.signal}));
 const empty=await collectPlaylist(id(1),async()=>response([],0));assert.equal(empty.completeness,'complete');assert.equal(empty.entries.length,0);
});
test('public links and chunk discovery never accept arbitrary destinations or execute source code',()=>{
 assert.equal(playlistId('https://open.spotify.com/intl-de/playlist/'+id(1)+'?si=x'),id(1));
 for(const u of ['http://open.spotify.com/playlist/','https://open.spotify.com.evil.test/playlist/','https://user@open.spotify.com/playlist/'])assert.throws(()=>playlistId(u+id(1)));
 assert.deepEqual(scriptCandidates('{1:"xpui-routes-home",2:"xpui-routes-playlist"};{1:"12345678",2:"abcdef12"}'),['xpui-routes-playlist.abcdef12.js','xpui-routes-home.12345678.js']);
});
