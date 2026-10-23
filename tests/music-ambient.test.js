import test from 'node:test';
import assert from 'node:assert/strict';
import {createAmbientEnvelope} from '../src/music-ambient-model.js';
import {paintAmbient,ambientArtwork} from '../src/music-ambient-light.js';

test('mini and main light rendering rejects invalid levels and unsafe artwork',()=>{
 const lights=Array.from({length:3},()=>({style:{}}));
 paintAmbient(lights,[Infinity,-2,9]);
 assert.deepEqual(lights.slice(0,2).map(n=>Number(n.style.opacity)),[.17,.17]);
 assert.ok(Math.abs(Number(lights[2].style.opacity)-.83)<1e-10);
 assert.equal(ambientArtwork('https://i.ytimg.com@evil.test/cover.jpg'),'none');
 assert.equal(ambientArtwork('file:///C:/private.jpg'),'none');
 assert.equal(ambientArtwork('https://i.ytimg.com/cover.jpg'),'url("https://i.ytimg.com/cover.jpg")');
});
test('ambient has no pulse in silence or when the analysis signal is missing',()=>{
 const envelope=createAmbientEnvelope();
 for(let i=0;i<120;i++)assert.deepEqual(envelope.sample({bass:1,mid:1,high:1,rms:0}),[0,0,0]);
 assert.deepEqual(envelope.sample(null),[0,0,0]);
});
test('bass onset drives its own light, other frequencies remain independent',()=>{
 const envelope=createAmbientEnvelope();const hit=envelope.sample({bass:.85,mid:0,high:0,rms:.2});
 assert.ok(hit[0]>.5);assert.equal(hit[1],0);assert.equal(hit[2],0);
 for(let i=0;i<120;i++)envelope.sample(null);const off=envelope.sample(null);assert.ok(off[0]<.001);
 envelope.reset();const high=envelope.sample({bass:0,mid:0,high:.9,rms:.2});assert.equal(high[0],0);assert.equal(high[1],0);assert.ok(high[2]>.3);
});
test('reaction is bounded, settles gently and reset removes the previous track energy',()=>{
 const envelope=createAmbientEnvelope();const loud=envelope.sample({bass:99,mid:99,high:99,rms:1});
 assert.ok(loud.every(v=>v>=0&&v<=1));const release=envelope.sample(null);assert.ok(release[0]>0&&release[0]<loud[0]);
 envelope.reset();assert.deepEqual(envelope.sample({bass:NaN,mid:Infinity,high:-8,rms:1}),[0,0,0]);
});
