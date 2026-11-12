import test from "node:test";
import assert from "node:assert/strict";
import { soundSettings, createMusicRate, vibeOf, reverbTail, VIBES } from "../src/music-sound-model.js";

const player = () => ({
  preservesPitch: true,
  playbackRate: 1,
  defaultPlaybackRate: 1,
  addEventListener() {},
});

test("sound moods are remembered only when they exist", () => {
  assert.equal(soundSettings({ vibe: "slowed" }).vibe, "slowed");
  assert.equal(soundSettings({ vibe: "toString" }).vibe, "");
  assert.equal(soundSettings({}).vibe, "");
  assert.equal(vibeOf("8d"), VIBES["8d"]);
  assert.equal(vibeOf("__proto__"), null);
});

test("Slowed and Nightcore change speed and pitch together, rooms keep normal time", () => {
  const node = player();
  let vibe = VIBES.slowed;
  const rate = createMusicRate(
    [node],
    () => 1.25,
    () => vibe,
  );
  rate.refresh();
  assert.equal(node.playbackRate, Math.round(1.25 * 0.85 * 1000) / 1000);
  assert.equal(node.preservesPitch, false);
  vibe = VIBES["8d"];
  rate.refresh();
  assert.equal(node.playbackRate, 1.25);
  assert.equal(node.preservesPitch, true);
  vibe = VIBES.nightcore;
  rate.setMode("host");
  assert.equal(node.playbackRate, 1);
  assert.equal(node.preservesPitch, true);
});

test("the reverb tail fades out in both ears", () => {
  let seed = 1;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const [left, right] = reverbTail(8000, 1, random);
  assert.equal(left.length, 8000);
  const energy = (data, from, to) => data.slice(from, to).reduce((sum, v) => sum + v * v, 0);
  assert.ok(energy(left, 100, 2000) > energy(left, 6000, 7900) * 10);
  assert.notDeepEqual(left.slice(200, 210), right.slice(200, 210));
  assert.equal(left[0], 0);
});
