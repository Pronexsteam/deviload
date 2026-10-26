import test from "node:test";
import assert from "node:assert/strict";
import {createCinemaQueue,localCinemaEntries,localCinemaOrder} from "../src/cinema-queue.js";
test("Cinema snapshots original order and retains unavailable positions",()=>{
  const jobs=[{id:3,file:"C:/Three.mp4",status:"done"},{id:1,file:"C:/One.mp4",status:"done"}];
  const ids=[3,2,1],q=createCinemaQueue();q.replace(localCinemaEntries(jobs,ids));ids.reverse();jobs.pop();
  assert.deepEqual(q.items.map(item=>item.id),[3,2,1]);assert.equal(q.items[1].status,"unavailable");assert.equal(q.next(),2);
  q.select(2);assert.equal(q.next(),-1);assert.equal(q.next(-1),0);assert.equal(q.next(0),-1);
});
test("Cinema ignores stale work after selection and close, appends pages without resetting playback",()=>{
  const q=createCinemaQueue();q.replace([{id:"a"},{id:"b"}]);const first=q.select(0),second=q.select(1);
  assert.equal(q.valid(first),false);q.append([{id:"c",index:51}]);assert.equal(q.current.id,"b");assert.equal(q.valid(second),true);
  q.invalidate();assert.equal(q.valid(second),false);
});
test("automatic advance stops after one forward pass and does not retry failed items in a loop",()=>{
  const q=createCinemaQueue();q.replace([{id:1},{id:2},{id:3,unavailable:true},{id:4}]);q.items[1].status="error";
  assert.equal(q.next(),3);q.select(3);assert.equal(q.next(),-1);q.items[0].status="error";assert.equal(q.next(-1),-1);
});
test("downloaded playlist uses recorded order including last file on parent, without mixing filtered-out files",()=>{
  const jobs=[{id:10,file:"last.mp4",downloads:[["a","first.mp4"],["b","middle.mp4"],["c","last.mp4"]]},
    {id:11,libraryParent:10,file:"first.mp4"},{id:12,libraryParent:10,file:"middle.mp4"},{id:20,file:"outside.mp4"}];
  assert.deepEqual(localCinemaOrder(jobs,[20,12,11,10],11),[11,12,10]);
  assert.deepEqual(localCinemaOrder(jobs,[20,11,10],11),[11,10]);
  assert.deepEqual(localCinemaOrder(jobs,[20,12,11,10],20),[20,12,11,10]);
});
