import test from 'node:test';import assert from 'node:assert/strict';
import {nearestInDirection} from "../src/music-results-keys.js";
import {matchScore,foldSearch,panelLayout,searchSuggestions,rememberSearch,collectionFacts,creditAlbumArtist,creditAlbumTracks,creditArtistCards,songAlbum,suggestionRows} from '../src/music-ui-model.js';
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
test('search suggestions lead with artists and covers, without repeating them as text',()=>{
 const song={id:'a',kind:'song',title:'Muse Song',artists:['Band']},artist={id:'b',kind:'artist',title:'Muse'},other={id:'c',kind:'song',title:'Other',artists:['Band']};
 const rows=suggestionRows('mu',{rich:[song,artist],local:[song,other],texts:[{text:'MUSE',kind:'query'},{text:'music',kind:'query'}]});
 assert.deepEqual(rows.map(row=>row.text),['Muse','Muse Song','music']);assert.equal(rows[0].item,artist);
 assert.deepEqual(suggestionRows('band',{local:[other]}).map(row=>row.text),['Other']);
 assert.ok(suggestionRows('x',{texts:Array.from({length:12},(_,n)=>({text:'x'+n,kind:'query'}))}).length<=8);
});
test('an empty search offers recent queries and recently played tracks',()=>{
 const rows=suggestionRows('',{history:['one','two'],recent:[{id:'a',kind:'song',title:'Song'}],local:[{id:'b',kind:'song',title:'Hidden'}]});
 assert.deepEqual(rows.map(row=>[row.kind,row.text]),[['recent','one'],['recent','two'],['song','Song']]);
});

test('search matches forgive case, accents, alphabet, word order and one slip',()=>{
 const maneskin={id:'m',kind:'artist',title:'Måneskin'},kino={id:'k',kind:'artist',title:'\u041a\u0438\u043d\u043e'},believer={id:'b',kind:'song',title:'Believer',artists:['Imagine Dragons']};
 assert.equal(foldSearch('  Måneskin — \u0401\u041b\u041a\u0410!  '),'maneskin elka');
 assert.equal(matchScore('maneskin',maneskin),100);
 assert.equal(matchScore('kino',kino),100);
 assert.equal(matchScore('beli',believer),80);
 assert.equal(matchScore('dragons imagine',believer),60);
 assert.equal(matchScore('believer imagine',believer),90);
 assert.equal(matchScore('believer imagine dragons',believer),90);
 assert.equal(matchScore('belever',believer),30);
 assert.equal(matchScore('zzz',believer),0);
});
test('the closest catalog match leads and an artist leads only when named',()=>{
 const song={id:'s',kind:'song',title:'Numb',artists:['Linkin Park']},artist={id:'a',kind:'artist',title:'Linkin Park'},cover={id:'c',kind:'song',title:'Numb (cover)',artists:['Someone']};
 assert.deepEqual(suggestionRows('numb',{rich:[artist,cover,song]}).map(row=>row.item.id),['s','c','a']);
 assert.deepEqual(suggestionRows('linkin park',{rich:[song,artist]}).map(row=>row.item.id)[0],'a');
});

test('arrow keys move to the nearest result in that direction',()=>{
 const box=(left,top,width=100,height=40)=>({left,top,width,height,right:left+width,bottom:top+height});
 const best=box(0,0,300,80),row1=box(0,100,600),row2=box(0,150,600),cardA=box(0,220,120,150),cardB=box(140,220,120,150);
 const all=[['best',best],['row1',row1],['row2',row2],['cardA',cardA],['cardB',cardB]].map(([node,b])=>({node,box:b}));
 const go=(from,dir)=>nearestInDirection(from,all.filter(entry=>entry.box!==from),dir);
 assert.equal(go(best,'down'),'row1');assert.equal(go(row1,'down'),'row2');assert.equal(go(row2,'down'),'cardA');
 assert.equal(go(cardA,'right'),'cardB');assert.equal(go(cardB,'left'),'cardA');assert.equal(go(best,'up'),null);
});
test('the original song leads its live takes and uploads named after the artist',()=>{
 const live={id:'l',kind:'song',title:'Imagine Dragons - Believer (Live in Vegas)',artists:['ImagineDragons']},show={id:'p',kind:'song',title:'Imagine Dragons - Believer - Pinkpop 2017 (HD Live Show)',artists:['Summervibzz']},song={id:'s',kind:'song',title:'Believer',artists:['Imagine Dragons']};
 assert.equal(suggestionRows('Believer Imagine Dragons',{rich:[live,show,song]})[0].item.id,'s');
 assert.equal(suggestionRows('believer live',{rich:[song,live]})[0].item.id,'l');
});
test('the same song under two ids shows once',()=>{
 const a={id:'a',kind:'song',title:'Believer',artists:['Imagine Dragons']},b={id:'b',kind:'song',title:'Believer',artists:['Imagine Dragons']};
 assert.deepEqual(suggestionRows('believer',{rich:[a],local:[b]}).map(row=>row.item?.id),['a']);
});
test('a lyric card starts from the sung line and keeps at most four lines in order',async()=>{
 const {startingPick,togglePick,fitRows,cardFileName}=await import('../src/music-lyric-card-model.js');
 const lines=['','one','two','three','four','five'];
 assert.deepEqual(startingPick(lines,-1),[1]);assert.deepEqual(startingPick(lines,3),[3]);assert.deepEqual(startingPick(['',''],0),[]);
 let pick=[3];for(const index of [1,5,2,4])pick=togglePick(pick,index,lines);
 assert.deepEqual(pick,[2,3,4,5]);assert.deepEqual(togglePick([2],2,lines),[2]);assert.deepEqual(togglePick([2],0,lines),[2]);
 const fit=fitRows(['a b c d e f g h'],{width:100,height:1000},(text,px)=>text.length*px/2);
 assert.ok(fit.size<=76&&fit.rows.join(' ')==='a b c d e f g h');
 assert.equal(cardFileName('Believer','Imagine Dragons'),'Imagine Dragons - Believer lyric.png');
 assert.equal(cardFileName('a/b:c?',''),'a b c lyric.png');assert.equal(cardFileName('',''),'Devil Music lyric.png');
});
test('two sung lines on a card are kept apart',async()=>{
 const {wrapRows}=await import('../src/music-lyric-card-model.js');
 assert.deepEqual(wrapRows(['one two','three'],100,()=>10),['one two',null,'three']);
});
test('the timeline finds the line sung under the pointer',async()=>{
 const {lineAt}=await import('../src/music-timeline-model.js');
 const lines=[{text:'a',at:10,end:14},{text:'b',at:15,end:20},{text:'c',at:60,end:70}];
 assert.equal(lineAt(lines,16),'b');assert.equal(lineAt(lines,40),'');assert.equal(lineAt(lines,5),'');
});
test('the lean spring reaches its target and settles',async()=>{
 const {springStep}=await import('../src/music-lean.js');
 let state={x:0,y:0,vx:0,vy:0,tx:4,ty:-2,settled:false},steps=0;
 while(!state.settled&&steps<400){state=springStep(state);steps++;}
 assert.ok(state.settled&&steps<200);assert.equal(state.x,4);assert.equal(state.y,-2);
 state={...state,tx:0,ty:0,settled:false};let overshoot=0;
 while(!state.settled){state=springStep(state);overshoot=Math.min(overshoot,state.x);}
 assert.ok(overshoot<0&&overshoot>-1);
});
