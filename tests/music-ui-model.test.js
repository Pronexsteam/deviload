import test from 'node:test';import assert from 'node:assert/strict';
import {panelLayout,searchSuggestions,rememberSearch,collectionFacts,creditAlbumArtist,creditAlbumTracks,creditArtistCards,songAlbum} from '../src/music-ui-model.js';
test('panels protect content when app navigation reduces the actual workspace width',()=>{
 for(const width of [540,720,766,800,880,1000,1002,1120,1440]){const p=panelLayout(width,330,380,true);if(p.preview)assert.ok(width-p.library-p.playing-32>=560);else if(!p.overlay)assert.ok(width-p.library-16>=560);assert.equal(p.overlay,width<766);}
 assert.equal(panelLayout(880,240,280,false).preview,true);assert.equal(panelLayout(880,240,280,true).preview,false);
 assert.equal(panelLayout(900,NaN,Infinity).library,240);
});
test('search suggestions are bounded, deduplicated and remain local',()=>{
 assert.deepEqual(rememberSearch(['MUSE','Other'],' muse '),['muse','Other']);
 const rows=searchSuggestions('mu',['Muse','Music'],[{kind:'artist',title:'Muse'},{artists:['Muse','Mumford']}]);
 assert.deepEqual(rows.map(x=>x.text),['Muse','Mumford','Music']);assert.ok(rememberSearch(Array(15).fill('x'),'new').length<=8);
});
test('collection duration distinguishes complete and partial metadata',()=>{
 assert.deepEqual(collectionFacts([{kind:'song',duration:60},{kind:'song'},{kind:'album',duration:600}]),{count:2,seconds:60,complete:false});
 assert.equal(collectionFacts([{kind:'song',duration:60}]).complete,true);
});
test('songs under an artist card take that artist, and only those songs',()=>{
 const items=[{kind:'artist',title:'Radiohead',artists:[]},{kind:'song',title:'Creep',artists:[]},{kind:'song',title:'Reckoner',artists:[]},{kind:'album',title:'OK Computer',artists:['Radiohead']},{kind:'song',title:'Loose',artists:[]},{kind:'song',title:'Credited',artists:['UNKLE']}];
 const rows=creditArtistCards([{title:'',items}])[0].items;
 assert.deepEqual(rows.map(row=>row.artists),[[],['Radiohead'],['Radiohead'],['Radiohead'],[],['UNKLE']]);
 assert.deepEqual(items[1].artists,[]);
});
test('an album opened from an artist page keeps that artist and passes it to its tracks',()=>{
 const album=creditAlbumArtist({kind:'album',title:'In Rainbows',artists:[]},{kind:'artist',title:'Radiohead'});
 assert.deepEqual(album.artists,['Radiohead']);
 assert.deepEqual(creditAlbumArtist({kind:'album',artists:['UNKLE']},{kind:'artist',title:'Radiohead'}).artists,['UNKLE']);
 const [tracks,related]=creditAlbumTracks(album,[{title:'',items:[{kind:'song',artists:[]},{kind:'song',artists:['Guest']}]},{title:'More',items:[{kind:'song',artists:[]}]}]);
 assert.deepEqual(tracks.items.map(item=>item.artists),[['Radiohead'],['Guest']]);
 assert.deepEqual(related.items[0].artists,[]);
});
test('the album of a song comes from its own field or a catalog byline with a clock',()=>{
 assert.equal(songAlbum({album:'Hot Space'}),'Hot Space');assert.equal(songAlbum({album:{title:'Legacy'}}),'Legacy');
 assert.equal(songAlbum({subtitle:'Queen • Hot Space • 4:09 · 366M plays'}),'Hot Space');
 assert.equal(songAlbum({subtitle:'Song • 3:59 · 2M plays'}),'');assert.equal(songAlbum({}),'');
});
