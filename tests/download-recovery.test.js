import test from 'node:test';
import assert from 'node:assert/strict';
import {diagnoseError,hostCooldown} from '../src/view-model.js';

const reel='https://www.facebook.com/reel/1578198251014489';

test('shared host wait matches backend aliases without overriding schedules or paused tasks',()=>{
  const limits=[{host:'youtube.com',until:700},{host:'facebook.com',until:650}];
  for(const url of ['https://youtu.be/test','https://music.youtube.com/watch?v=test'])assert.deepEqual(hostCooldown({status:'queued',url},limits,100),{host:'youtube.com',minutes:10});
  assert.equal(hostCooldown({status:'queued',url:reel,scheduledAt:750},limits,100),null);
  assert.equal(hostCooldown({status:'paused',url:reel},limits,100),null);
  assert.equal(hostCooldown({status:'queued',url:'https://facebook.com.evil.org/post'},limits,100),null);
  assert.equal(hostCooldown({status:'queued',url:reel},limits,650),null);
  assert.deepEqual(hostCooldown({status:'queued',url:reel,scheduledAt:50},limits,649),{host:'facebook.com',minutes:1});
});

test('Facebook login failures offer cookies without promising embedded YouTube sign-in',()=>{
  for(const url of [reel,'https://fb.watch/example/','https://m.facebook.com/watch/?v=123']){
    const result=diagnoseError(['ERROR: Login required. Use --cookies-from-browser or --cookies'],true,url);
    assert.equal(result.title,'Facebook needs a session');
    assert.equal(result.action,'cookies');
    assert.doesNotMatch(result.message,/YouTube|Sign in to Facebook in Deviload/);
  }
});

test('Facebook parser failures suggest a current extractor and verifiable source access',()=>{
  const result=diagnoseError(['ERROR: [facebook] 1578198251014489: Cannot parse data'],false,reel);
  assert.equal(result.title,'Facebook did not return the video');
  assert.equal(result.action,'update');
  assert.match(result.message,/browser/);
});

test('Facebook host checks cannot classify another website with a similar name',()=>{
  const result=diagnoseError(['ERROR: Login required. Use --cookies'],false,'https://facebook.com.example.org/video/1');
  assert.equal(result.title,'Sign-in needed');
  assert.doesNotMatch(result.message,/Facebook/);
});

test('rate limits take precedence over stale parser or authentication hints',()=>{
  const result=diagnoseError(['Cannot parse data','Use --cookies','HTTP Error 429: Too Many Requests'],false,reel);
  assert.equal(result.title,'Too many requests');
  assert.equal(result.action,'');
  assert.doesNotMatch(result.message,/YouTube/);
});
