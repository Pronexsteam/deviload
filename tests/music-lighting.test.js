import test from "node:test";
import assert from "node:assert/strict";
globalThis.document ??= { documentElement: { lang: "en" } };
const { coverRgb, createPulse, lightColour, lightingState, retryDelay } = await import("../src/music-lighting.js");

test("the cover colour becomes a vivid LED colour, grey covers a soft white", () => {
  assert.deepEqual(coverRgb("hsl(0 78% 80%)"), [255, 0, 0]);
  assert.deepEqual(coverRgb("hsl(240 78% 80%)"), [0, 0, 255]);
  assert.deepEqual(coverRgb(""), [255, 236, 230]);
});

test("the bass pulses the brightness: at least half bright while playing, full on a hit, softer on pause", () => {
  const pulse = createPulse();
  const quiet = pulse.next(0.1, true);
  const hit = pulse.next(0.9, true);
  const after = pulse.next(0.1, true);
  assert.equal(quiet, 0.5, "quiet music still lights the keys at half");
  assert.ok(hit > 0.8, "a hit lights up");
  assert.ok(after < hit && after > quiet, "and fades rather than drops");
  assert.equal(pulse.next(0.9, false), 0.4);
});

test("the strongest hits turn a little whiter, never past white", () => {
  assert.deepEqual(lightColour([255, 0, 0], 0.5), [128, 0, 0]);
  const peak = lightColour([255, 0, 0], 1);
  assert.equal(peak[0], 255);
  assert.ok(peak[1] > 0 && peak[1] <= 64);
});

test("the start's answer becomes what the settings row says and when it looks again", () => {
  assert.equal(lightingState({ connected: true, devices: ["Keyboard"] }), "on");
  assert.equal(lightingState({ connected: true, devices: [] }), "empty");
  assert.equal(lightingState({ connected: false, error: "missing" }), "missing");
  assert.equal(lightingState({ connected: false, error: "server_off" }), "server-off");
  assert.equal(lightingState({ connected: false, error: "starting" }), "starting");
  assert.equal(lightingState(null), "lost");
  assert.ok(retryDelay("starting") < retryDelay("server-off"));
  assert.ok(retryDelay("server-off") < retryDelay("lost"));
  assert.ok(retryDelay("lost") < retryDelay("missing"));
});
