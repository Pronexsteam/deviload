import test from "node:test";
import assert from "node:assert/strict";
globalThis.document ??= { documentElement: { lang: "en" } };
const { coverRgb, createPulse, lightColour } = await import("../src/music-lighting.js");

test("the cover colour becomes a vivid LED colour, grey covers a soft white", () => {
  assert.deepEqual(coverRgb("hsl(0 78% 80%)"), [255, 0, 0]);
  assert.deepEqual(coverRgb("hsl(240 78% 80%)"), [0, 0, 255]);
  assert.deepEqual(coverRgb(""), [255, 236, 230]);
});

test("the bass pulses the brightness: up fast, down slowly, dim but lit on pause", () => {
  const pulse = createPulse();
  const quiet = pulse.next(0.1, true);
  const hit = pulse.next(0.9, true);
  const after = pulse.next(0.1, true);
  assert.ok(quiet < 0.25 && hit > 0.6, "a hit lights up");
  assert.ok(after < hit && after > quiet, "and fades rather than drops");
  assert.equal(pulse.next(0.9, false), 0.25);
});

test("the strongest hits turn a little whiter, never past white", () => {
  assert.deepEqual(lightColour([255, 0, 0], 0.5), [128, 0, 0]);
  const peak = lightColour([255, 0, 0], 1);
  assert.equal(peak[0], 255);
  assert.ok(peak[1] > 0 && peak[1] <= 64);
});
