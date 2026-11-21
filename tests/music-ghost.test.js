import test from 'node:test';
import assert from 'node:assert/strict';
import {ghostLean,ghostClip} from '../src/music-ghost.js';

test('the ghost leans toward the cursor within its limits, and stays upright under it',()=>{
 assert.deepEqual(ghostLean(0,0),{x:0,y:0});
 const right=ghostLean(400,0);assert.ok(right.y>0&&right.y<=22);assert.ok(Math.abs(right.x)<0.5);
 const up=ghostLean(0,-400);assert.ok(up.x>0&&up.x<=14);
 const far=ghostLean(5000,0),near=ghostLean(300,0);assert.ok(far.y<near.y);
 assert.equal(ghostClip('listening'),'assets/ghost/listening.webm');
});
