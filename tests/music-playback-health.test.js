import test from 'node:test';
import assert from 'node:assert/strict';
import {bufferedSeconds,canPrepareAudio,keyboardSeek} from '../src/music-playback-health.js';

test('preparation uses the buffer containing playback, not a distant seek range',()=>{
  const audio={currentTime:20,duration:180,readyState:4,buffered:{length:2,start:i=>[0,100][i],end:i=>[23,180][i]}};
  assert.equal(bufferedSeconds(audio),3);assert.equal(canPrepareAudio(audio),false);
  audio.buffered.end=i=>[30,180][i];assert.equal(canPrepareAudio(audio),true);
  audio.readyState=3;assert.equal(canPrepareAudio(audio),false);
  audio.readyState=4;audio.currentTime=96;assert.equal(canPrepareAudio(audio),false);
  audio.currentTime=178;assert.equal(canPrepareAudio(audio),true);
  audio.duration=Infinity;assert.equal(canPrepareAudio(audio),false);
});
test('seek keyboard steps are in seconds, clamped, and unavailable for unknown durations',()=>{
  assert.equal(keyboardSeek('ArrowRight',40,200),45);
  assert.equal(keyboardSeek('ArrowLeft',2,200),0);
  assert.equal(keyboardSeek('PageUp',40,200),60);
  assert.equal(keyboardSeek('PageDown',40,200),20);
  assert.equal(keyboardSeek('Home',40,200),0);
  assert.equal(keyboardSeek('End',40,200),200);
  assert.equal(keyboardSeek('ArrowRight',199,200),200);
  assert.equal(keyboardSeek('ArrowRight',40,NaN),null);
  assert.equal(keyboardSeek('Tab',40,200),null);
});
