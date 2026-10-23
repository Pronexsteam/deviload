import test from 'node:test';import assert from 'node:assert/strict';
import {panelLayout,searchSuggestions,rememberSearch,collectionFacts} from '../src/music-ui-model.js';
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
