import test from 'node:test';
import assert from 'node:assert/strict';
import {canvasLoopStart,canvasQuality,CANVAS_LOOP} from '../src/music-canvas.js';

test('a music video loops a stretch past its intro that fits before the end',()=>{
 assert.equal(canvasLoopStart(210),210*0.33);
 assert.equal(canvasLoopStart(14),5-1);assert.equal(canvasLoopStart(30),10*0.99);
 for(const duration of [12,16,30,90,600]){const start=canvasLoopStart(duration);assert.ok(start>=0);assert.ok(start+CANVAS_LOOP<=duration);}
 for(const duration of [NaN,Infinity,0,8,CANVAS_LOOP+2])assert.equal(canvasLoopStart(duration),0);
});

test('the canvas picture is sharp enough for the window it fills',()=>{
 assert.equal(canvasQuality(800,1),720);assert.equal(canvasQuality(1000,1),1080);assert.equal(canvasQuality(800,1.5),1080);
 assert.equal(canvasQuality(undefined,undefined),720);
});
