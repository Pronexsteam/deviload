import test from "node:test";
import assert from "node:assert/strict";
import { matchTempo, mixPlan, beatOffset, djFade, DJ } from "../src/music-dj-model.js";

test("tempos meet directly or at half and double time, never when far apart", () => {
  assert.equal(matchTempo(128, 124).factor, 1);
  assert.ok(Math.abs(matchTempo(128, 124).ratio - 128 / 124) < 1e-9);
  assert.equal(matchTempo(140, 70).factor, 2);
  assert.equal(matchTempo(70, 140).factor, 0.5);
  assert.equal(matchTempo(128, 100), null);
  assert.equal(matchTempo(0, 120), null);
});

test("a mix starts on a beat of the current song, a whole phrase before its end", () => {
  const outGrid = { bpm: 120, first: 180.25, confidence: 4 },
    inGrid = { bpm: 118, first: 0.6, confidence: 3 },
    plan = mixPlan({ outGrid, inGrid, duration: 230 });
  assert.equal(plan.beats, 16);
  assert.equal(plan.length, 8);
  const beats = (plan.startAt - outGrid.first) / 0.5;
  assert.ok(Math.abs(beats - Math.round(beats)) < 1e-9);
  assert.ok(plan.startAt + plan.length <= 230 - 0.5);
  assert.ok(plan.startAt + plan.length > 230 - 0.5 - 0.5);
  assert.equal(plan.inStart, 0.6);
  assert.ok(Math.abs(plan.ratio - 120 / 118) < 1e-9);
});

test("the next song starts near its beginning but on its own beat", () => {
  const plan = mixPlan({
    outGrid: { bpm: 128, first: 200, confidence: 4 },
    inGrid: { bpm: 128, first: 30, confidence: 4 },
    duration: 260,
  });
  assert.ok(plan.inStart <= 12 && plan.inStart >= 0);
  const beats = (30 - plan.inStart) / (60 / 128);
  assert.ok(Math.abs(beats - Math.round(beats)) < 1e-6);
});

test("an unsteady beat or a far tempo gives no mix", () => {
  const steady = { bpm: 120, first: 150, confidence: 4 };
  assert.equal(
    mixPlan({
      outGrid: steady,
      inGrid: { bpm: 120, first: 1, confidence: DJ.confidence - 0.1 },
      duration: 200,
    }),
    null,
  );
  assert.equal(
    mixPlan({ outGrid: steady, inGrid: { bpm: 95, first: 1, confidence: 4 }, duration: 200 }),
    null,
  );
  assert.equal(mixPlan({ outGrid: steady, inGrid: null, duration: 200 }), null);
});

test("the beat offset is the nearest way round and in the next song's seconds", () => {
  const outGrid = { first: 0 },
    inGrid = { first: 0 };
  const at = (outTime, inTime) =>
    beatOffset({ outTime, outGrid, outPeriod: 0.5, inTime, inGrid, inPeriod: 0.5 });
  assert.ok(Math.abs(at(10, 4)) < 1e-9);
  assert.ok(Math.abs(at(10, 4.05) - 0.05) < 1e-9);
  assert.ok(Math.abs(at(10, 3.95) + 0.05) < 1e-9);
  assert.ok(Math.abs(at(10.45, 4)) - 0.05 < 1e-9);
});

test("in a DJ fade both songs are up through the middle", () => {
  assert.deepEqual(djFade(0), { in: 0, out: 1 });
  const middle = djFade(0.5);
  assert.ok(middle.in > 0.95 && middle.out > 0.95);
  const end = djFade(1);
  assert.equal(end.in, 1);
  assert.ok(end.out < 1e-9);
});
