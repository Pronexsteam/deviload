import test from "node:test";
import assert from "node:assert/strict";
import {createEngineUpdater} from "../src/engine-update.js";

test("manual and automatic updates share one request and unlock after failure", async () => {
  let calls = 0;
  let reject;
  const busy = [];
  const run = createEngineUpdater(() => {
    calls++;
    if (calls === 1) return new Promise((_, fail) => { reject = fail; });
    return Promise.resolve({before:"old", after:"new"});
  }, state => busy.push(state));
  const automatic = run();
  const manual = run();
  assert.equal(automatic, manual);
  await Promise.resolve();
  assert.equal(calls, 1);
  reject(new Error("network timeout"));
  await assert.rejects(manual, /network timeout/);
  assert.deepEqual(busy, [true, false]);
  assert.deepEqual(await run(), {before:"old", after:"new"});
  assert.equal(calls, 2);
  assert.deepEqual(busy, [true, false, true, false]);
});

test("a synchronous bridge failure also restores the update controls", async () => {
  const busy = [];
  const run = createEngineUpdater(() => { throw new Error("bridge unavailable"); }, state => busy.push(state));
  await assert.rejects(run(), /bridge unavailable/);
  assert.deepEqual(busy, [true, false]);
});
