import test from 'node:test';
import assert from 'node:assert/strict';
import {readPlaylistLink,resolveMusicImport} from '../src/music-import-resolver.js';
import {importMusicProfile,sanitizeMusicCollection,sanitizeMusicTrack} from '../src/music-profile.js';
import {playlistArtwork} from '../src/music-playlist-art.js';

const track=n=>({kind:'song',id:String(n).padStart(11,'0'),title:'Track '+n,artists:['Artist'],image:''});
const cover=n=>`https://i.ytimg.com/vi/${track(n).id}/hqdefault.jpg`;

test('imported YouTube mixes keep the catalog artwork even on the exact-ID shortcut',async()=>{
  const source={...track(1),image:'https://lh3.googleusercontent.com/album=s320'};
  const batch=await readPlaylistLink('https://www.youtube.com/watch?v=00000000001&list=RD00000000001',{invoke:async()=>({sections:[{items:[source,track(2)]}]})});
  const rows=await resolveMusicImport(batch.entries,{invoke:()=>assert.fail('no separate catalog lookup needed')});
  assert.deepEqual(rows.map(row=>row.item.image),[source.image,cover(2)]);
});

test('saved playlists missing images recover YouTube thumbnails without inventing local or album artwork',()=>{
  const data={format:'devil-music-profile',version:3,saved:{favorites:[],recent:[],playlists:[{id:'mix',name:'Mix',items:[track(1)]}]},taste:{entries:{},hiddenSongs:[],blockedArtists:[],mode:"balanced"}};
  assert.equal(importMusicProfile(JSON.stringify(data)).saved.playlists[0].items[0].image,cover(1));
  assert.equal(sanitizeMusicTrack({...track(1),id:'local:'+'a'.repeat(64)}).image,'');
  assert.equal(sanitizeMusicCollection({...track(1),kind:'album',id:'MPREalbum'}).image,'');
});

test('collages use four distinct covers and preserve a custom image',t=>{
  const previous=globalThis.document;
  globalThis.document={createElement:tag=>({tag,children:[],append(child){this.children.push(child);}})};
  t.after(()=>{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;});
  const items=[1,1,2,3,4,5].map(n=>({...track(n),image:cover(n)}));
  const collage=playlistArtwork({name:'Mix',items},song=>song.image);
  assert.deepEqual(collage.children,[cover(1),cover(2),cover(3),cover(4)]);
  const custom='data:image/png;base64,AAAA';
  const uploaded=playlistArtwork({name:'Mix',items,cover:custom},()=>assert.fail('custom cover wins'));
  assert.equal(uploaded.children.length,1);assert.equal(uploaded.children[0].src,custom);
});
