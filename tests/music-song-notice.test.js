import test from "node:test";
import assert from "node:assert/strict";
globalThis.document ??= { documentElement: { lang: "en" } };
const { shouldAnnounce } = await import("../src/music-song-notice.js");

const base = { enabled: true, id: "a", last: "", playing: true, hidden: true, focused: false };

test("a new song is announced only when it starts unseen and the person asked for it", () => {
  assert.equal(shouldAnnounce(base), true);
  assert.equal(shouldAnnounce({ ...base, enabled: false }), false);
  assert.equal(shouldAnnounce({ ...base, last: "a" }), false);
  assert.equal(shouldAnnounce({ ...base, playing: false }), false);
  assert.equal(shouldAnnounce({ ...base, hidden: false, focused: true }), false);
  // Behind another window counts as unseen too.
  assert.equal(shouldAnnounce({ ...base, hidden: false, focused: false }), true);
});
