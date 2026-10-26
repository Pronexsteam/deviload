import test from 'node:test';
import assert from 'node:assert/strict';
import {roomPosition,roomCorrection} from '../src/music-room-sync.js';
test('room clocks use bounded age and transport, independent of the two computer clocks',()=>{
 assert.equal(roomPosition({state:{position:20,duration:100,playing:true},age_ms:400,transport_ms:100},500),21);
 assert.equal(roomPosition({state:{position:20,duration:100,playing:false},age_ms:9000,transport_ms:2000},3000),20);
 assert.equal(roomPosition({state:{position:99,duration:100,playing:true},age_ms:10000}),100);
});
test('room synchronization gently corrects small drift and seeks only for a larger mismatch',()=>{
 assert.deepEqual(roomCorrection(20,20.05),{seek:null,rate:1});
 assert.deepEqual(roomCorrection(20,20.7),{seek:null,rate:1.025});
 assert.deepEqual(roomCorrection(20,19.3),{seek:null,rate:.975});
 assert.deepEqual(roomCorrection(20,30),{seek:30,rate:1});
});
