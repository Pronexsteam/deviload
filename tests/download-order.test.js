import test from 'node:test';
import assert from 'node:assert/strict';
import {orderDownloads,orderLibrary} from '../src/download-order.js';
const ids=jobs=>jobs.map(job=>job.id);
test('completion outranks creation, legacy order is deterministic and waiting order is preserved',()=>{
 const jobs=[{id:7,status:'queued'},{id:4,status:'done'},{id:9,status:'paused'},
  {id:1,status:'done',completedAt:2000},{id:2,status:'done',completedAt:1000},{id:3,status:'done'}];
 assert.deepEqual(ids(orderDownloads(jobs)),[1,2,4,3,7,9]);
 assert.deepEqual(ids(jobs),[7,4,9,1,2,3]);
});
test('library keeps a completed playlist together in recorded file order, including original last file',()=>{
 const parent={id:1,status:'done',file:'last.mp4',completedAt:2000,downloads:[['a','first.mp4'],['b','middle.mp4'],['c','last.mp4']]};
 const jobs=[parent,{id:2,status:'done',completedAt:1000,file:'other.mp4'},
  {id:3,libraryParent:1,file:'first.mp4',completedAt:2000},{id:4,libraryParent:1,file:'middle.mp4',completedAt:2000}];
 assert.deepEqual(ids(orderLibrary(jobs,jobs)),[3,4,1,2]);
 assert.deepEqual(ids(orderLibrary(jobs.filter(j=>j.id!==3),jobs)),[4,1,2]);
 assert.deepEqual(ids(orderLibrary(jobs,jobs,'playlist')),[2,3,4,1]);
});
