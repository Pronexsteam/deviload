import test from 'node:test';
import assert from 'node:assert/strict';
import {artistPageCandidates,exactArtist} from '../src/music-artist-model.js';
test('artist resolution accepts only artist browse IDs and never silently chooses an ambiguous name',()=>{
 const a={kind:'artist',id:'UCartist1',title:'Adele'},b={kind:'artist',id:'UCartist2',title:'ADELE'};
 const data={sections:[{items:[a,a,{...a,kind:'song'},{...a,id:'https://other.example'},b]}]};
 assert.deepEqual(artistPageCandidates(data),[a,b]);assert.equal(exactArtist([a],' adele '),a);assert.equal(exactArtist([a,b],'Adele'),null);assert.equal(exactArtist([a],'Another singer'),null);
 assert.deepEqual(artistPageCandidates({sections:[{}]}),[]);
});
