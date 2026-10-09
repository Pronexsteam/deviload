import test from 'node:test';
import assert from 'node:assert/strict';
import {batchEligible, runBatch} from '../src/queue-selection.js';
import {counts, inLibrary} from '../src/view-model.js';

test('batch controls exclude hidden tasks, unfinished files and live recordings', () => {
  assert.equal(batchEligible({status:'done',file:'x.mp4'}, 'phone'), true);
  for (const job of [{status:'running',file:'x.mp4'}, {status:'done',file:''}, {status:'done',file:'x.mp4',hiddenInQueue:true}]) {
    assert.equal(batchEligible(job, 'phone'), false);
  }
  for (const action of ['cancel','pause']) assert.equal(batchEligible({status:'running',live:true}, action), false);
  assert.equal(batchEligible({status:'error'}, 'retry'), true);
  assert.equal(batchEligible({status:'paused'}, 'resume'), true);
});

test('batch survives partial failure and rechecks state before each operation', async () => {
  const jobs = [{id:1,status:'queued'}, {id:2,status:'queued'}, {id:3,status:'queued'}, {id:4,status:'queued'}];
  const calls = [];
  const result = await runBatch([1,1,2,3,4,99], 'pause', () => jobs, async job => {
    calls.push(job.id);
    if (job.id === 1) jobs[2].status = 'done';
    if (job.id === 2) throw new Error('Cannot save');
  });
  assert.deepEqual(calls, [1,2,4]);
  assert.deepEqual(result.completed, [1,4]);
  assert.deepEqual(result.skipped, [3,99]);
  assert.deepEqual(result.failed.map(item => item.id), [2]);
});

test('removing finished tasks from the queue does not lower the library count', () => {
  const jobs = [{id:1,status:'done',file:'one.mp4'}, {id:2,status:'done',file:'two.mp3'}];
  assert.equal(jobs.filter(inLibrary).length, 2);
  jobs.forEach(job => job.hiddenInQueue = true);
  assert.equal(counts(jobs).total, 0);
  assert.equal(jobs.filter(inLibrary).length, 2);
  jobs[0].hiddenInLibrary = true;
  assert.equal(jobs.filter(inLibrary).length, 1);
});
