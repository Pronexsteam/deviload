import test from 'node:test';
import assert from 'node:assert/strict';
import {ttmlTime,parseTtml,richerLyricsFit} from '../src/music-ttml.js';
test('provider clocks support fractional seconds and reject invalid clocks',()=>{
  assert.equal(ttmlTime('4:46.082'),286.082);assert.equal(ttmlTime('00:00:32.116'),32.116);
  assert.equal(ttmlTime('120ms'),.12);assert.equal(ttmlTime('3.2s'),3.2);
  for(const raw of ['',null,'1e3','2:abc','-1','Infinity'])assert.ok(Number.isNaN(ttmlTime(raw)));
  assert.deepEqual(parseTtml('<!DOCTYPE tt><tt/>',200),[]);
});
test('word enrichment cannot replace a full text with an excerpt or unrelated song',()=>{
  const base={plain:'One two three four five six seven eight nine ten'};
  assert.equal(richerLyricsFit([{text:'One two three'}],base),false);
  assert.equal(richerLyricsFit([{text:'Other words from another artist'}],base),false);
  assert.equal(richerLyricsFit([{text:'One two three four five six seven eight nine ten'}],base),true);
  assert.equal(richerLyricsFit([{text:'One One One One One One One One One One'}],base),false);
});
