import test from "node:test";
import assert from "node:assert/strict";
import { musicShortcut } from "../src/music-shortcuts.js";
// Translations read the page language when they load.
globalThis.document ??= { documentElement: { lang: "en" }, createElement: () => ({}) };
const { SPEEDS, stepSpeed, speedText } = await import("../src/music-speed.js");

test("[ and ] step between common speeds, from any speed set on the slider", () => {
  assert.equal(stepSpeed(1, 1), 1.25);
  assert.equal(stepSpeed(1, -1), 0.75);
  assert.equal(stepSpeed(1.1, 1), 1.25);
  assert.equal(stepSpeed(1.1, -1), 1);
  assert.equal(stepSpeed(2, 1), 2, "the fastest stays");
  assert.equal(stepSpeed(0.5, -1), 0.75, "below the list moves into it");
  assert.equal(stepSpeed(0.75, -1), 0.75);
  assert.deepEqual(SPEEDS, [0.75, 1, 1.25, 1.5, 2]);
  assert.equal(speedText(1.5), "1.5×");
  assert.equal(speedText(1), "1×");
});

test("the bracket keys are speed shortcuts unless typing", () => {
  const key = (code, extra = {}) => musicShortcut({ code, key: code, target: { closest: () => null }, ...extra });
  assert.equal(key("BracketLeft"), "slower");
  assert.equal(key("BracketRight"), "faster");
  assert.equal(key("BracketRight", { ctrlKey: true }), null);
  assert.equal(musicShortcut({ code: "BracketLeft", key: "[", target: { closest: s => (s.startsWith("input") ? {} : null) } }), null);
});
