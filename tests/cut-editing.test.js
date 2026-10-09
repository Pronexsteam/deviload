import test from 'node:test';
import assert from 'node:assert/strict';
import {trimBounds, exportPresets} from '../src/cut-editing.js';

test('precise trims accept fractional boundaries and reject empty or out-of-source ranges', () => {
  assert.deepEqual(trimBounds(1.234, 3.456, 10), {start:1.234,end:3.456});
  assert.deepEqual(trimBounds(9.9, 10, 10), {start:9.9,end:10});
  for (const bounds of [[NaN,3,10],[-1,3,10],[4,3,10],[1,11,10],[1,1.01,10],[1,Infinity,10]]) assert.throws(() => trimBounds(...bounds));
});

test('export presets keep compatible video containers and do not alter the project canvas', () => {
  assert.equal(exportPresets.small.codec, 'h264');
  assert.equal(exportPresets.audio.format, 'mp3');
  assert.equal(exportPresets.gif.quality, '480');
  assert.ok(Object.values(exportPresets).every(preset => !('canvas' in preset)));
});
