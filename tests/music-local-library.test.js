import test from 'node:test';
import assert from 'node:assert/strict';
import {readLocalLibrary,localPlaybackSource,getExactLocalCopy,setExactLocalCopy,exactLocalPlaybackSource,localRecordingCandidates,localDurationDiffers} from '../src/music-local-model.js';
import {isMusicTrackId,localArtworkUrl} from '../src/music-track-id.js';
import {exportMusicProfile,importMusicProfile} from '../src/music-profile.js';
import {readTaste,recordListening} from '../src/music-taste.js';
import {tracks,playbackQueue} from '../src/music-state.js';
import {saveMusicSession,readMusicSession} from '../src/music-session.js';
import {artworkCandidates} from '../src/music-artwork.js';
const song=n=>({kind:'song',id:'local:'+n.toString(16).padStart(64,'0'),title:'Local '+n,artists:['Test'],subtitle:'Test',album:'Album',image:'music-art://localhost/'+n.toString(16).padStart(64,'0')+'.jpg',duration:180});
test('exact local choices require native verification and persist only device-local identifiers',async()=>{
  const data=new Map(),storage={getItem:key=>data.get(key),setItem:(key,v)=>data.set(key,v)};
  const track='abcdefghijk',remote='bcdefghijkl',hash='b'.repeat(64),file={...song(1),contentHash:hash,path:'private-path'};
  const calls=[];const invoke=async(cmd,args)=>{calls.push([cmd,args]);return args.play?'private-path':null;};
  await setExactLocalCopy(storage,track,remote,file,invoke);
  const choice=getExactLocalCopy(storage,track,remote);assert.equal(choice.hash,hash);assert.equal(choice.localId,file.id);
  assert.equal(getExactLocalCopy(storage,track,track),null);
  assert(![...data.values()].some(v=>v.includes('private-path')||v.includes(file.title)));
  assert.deepEqual(await exactLocalPlaybackSource(choice,invoke,path=>'asset:'+path),{url:'asset:private-path',offline:true});
  assert.deepEqual(calls,[['music_local_exact',{id:file.id,hash,play:false}],['music_local_exact',{id:file.id,hash,play:true}]]);
  await assert.rejects(setExactLocalCopy(storage,track,remote,{...file,contentHash:'a'.repeat(64)},async()=>{throw Error('changed');}),/changed/);
  assert.equal(getExactLocalCopy(storage,track,remote).hash,hash);
  await assert.rejects(exactLocalPlaybackSource(choice,async()=>{throw Error('changed');},()=>assert.fail()),/changed/);
  await setExactLocalCopy(storage,track,remote,null,invoke);assert.equal(getExactLocalCopy(storage,track,remote),null);
});
test('local recording search reaches the end of a large library with bounded results',()=>{
  const items=Array.from({length:1420},(_,i)=>({...song(i),contentHash:'a'.repeat(64)}));
  assert.equal(localRecordingCandidates(items,'').length,16);
  assert.equal(localRecordingCandidates(items,'local 1419 test')[0].id,items.at(-1).id);
  assert.equal(localDurationDiffers({duration:182},{duration:183}),false);
  assert.equal(localDurationDiffers({duration:182},{duration:204}),true);
});
test('local and legacy music survive profile migration, likes, taste and playback sessions',()=>{
 const online={kind:'song',id:'abcdefghijk',title:'Existing',artists:['Original'],subtitle:'Original',image:''};
 const taste=readTaste();recordListening(taste,online,{seconds:90,duration:100,session:42},Date.now()-1000);
 const saved={favorites:[online],recent:[online],volume:.37,publicDiscovery:false,playlists:[{id:'old',name:'Existing',items:[online]}]};
 const legacy=JSON.parse(exportMusicProfile(saved,taste));legacy.version=2;
 const migrated=importMusicProfile(JSON.stringify(legacy));migrated.saved.favorites.push(song(1));migrated.saved.playlists[0].items.push(song(1));
 recordListening(migrated.taste,song(1),{seconds:90,duration:100,session:43},Date.now());
 const restored=importMusicProfile(exportMusicProfile(migrated.saved,migrated.taste));
 assert.equal(restored.saved.volume,.37);assert.equal(restored.saved.publicDiscovery,false);assert.deepEqual(restored.taste.entries[online.id],migrated.taste.entries[online.id]);
 assert.deepEqual(restored.saved.favorites,[online,song(1)]);assert.deepEqual(restored.saved.playlists[0].items,[online,song(1)]);assert(restored.taste.entries[song(1).id]);
 const data=new Map(),storage={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)};
 saveMusicSession(storage,{queue:restored.saved.favorites,id:song(1).id,position:12,duration:180,repeat:'all',shuffle:true,autoplay:false});
 const session=readMusicSession(storage);assert.equal(session.id,song(1).id);assert.equal(session.queue.length,2);
 assert.equal(playbackQueue(restored.saved.favorites).length,2);assert.equal(tracks([song(1),song(1)]).length,1);
 for(const id of ['local:../secret','local:C:/music/song.mp3','file:///music.wav','local:123'])assert(!isMusicTrackId(id));
});
test('local playback never requests a remote fallback when missing or unsupported',async()=>{
 const calls=[];const invoke=async(name,args)=>{calls.push([name,args]);throw Error('File missing');};
 await assert.rejects(localPlaybackSource(song(1).id,invoke,()=>assert.fail()),/File missing/);assert.deepEqual(calls.map(c=>c[0]),['music_offline_source']);
 const result=await localPlaybackSource(song(1).id,async()=>'/selected/local.flac',path=>'asset:'+path);assert.deepEqual(result,{url:'asset:/selected/local.flac',offline:true});
});
test('large library uses one snapshot and publishes every entry without duplicates',async()=>{
 const items=Array.from({length:2420},(_,n)=>song(n)),calls=[];
 const result=await readLocalLibrary(async(name,args)=>{calls.push(args);return {items:items.slice(args.offset,args.offset+400),total:items.length,generation:7,scanning:false};});
 assert.equal(result.items.length,2420);assert.equal(calls.length,7);assert(calls.slice(1).every(c=>c.generation===7));
 await assert.rejects(readLocalLibrary(async(_,args)=>({items:items.slice(args.offset,args.offset+400),total:800,generation:args.offset?8:7})),/changed/);
});
test('local covers resolve only indexed hash names, never arbitrary file URLs',()=>{
 assert(localArtworkUrl(song(1).image));assert.deepEqual(artworkCandidates(song(1).image),[song(1).image]);
 for(const value of ['music-art://localhost/../secret.jpg','music-art://elsewhere/'+ 'a'.repeat(64)+'.jpg','file:///C:/secret.jpg']){assert(!localArtworkUrl(value));assert.deepEqual(artworkCandidates(value),[]);}
});
