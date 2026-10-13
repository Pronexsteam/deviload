import test from 'node:test';
import assert from 'node:assert/strict';
import {createMusicNavigation} from '../src/music-navigation.js';
test('music back follows visited screens and ignores refreshes of the same screen',()=>{
 const home={type:'catalog',kind:'home'},search={type:'catalog',kind:'search',value:'Jazz'},list={type:'playlist',id:'one'};
 const navigation=createMusicNavigation(home);
 assert.equal(navigation.back(),null);navigation.visit(search);navigation.visit({...search});navigation.visit(list);
 assert.deepEqual(navigation.back(),search);assert.deepEqual(navigation.back(),home);assert.equal(navigation.canGoBack(),false);
});
test('history is bounded and a new destination after back keeps the correct route',()=>{
 const navigation=createMusicNavigation({id:0},2);for(let id=1;id<=4;id++)navigation.visit({id});
 assert.deepEqual(navigation.back(),{id:3});navigation.visit({id:5});assert.deepEqual(navigation.back(),{id:3});assert.deepEqual(navigation.back(),{id:2});assert.equal(navigation.back(),null);
});
