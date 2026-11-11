import test from "node:test";
import assert from "node:assert/strict";
globalThis.document ??= { documentElement: { lang: "en" }, createElement: () => ({}) };
const { createRecordingAlign, sameSong, readAlignments, ALIGN_KEY } = await import(
  "../src/music-recording-align.js"
);

const memory = () => {
  const map = new Map();
  return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), map };
};
// A few seconds of tones, loud enough to be heard, as if captured from the player at a given time.
const sound = startedAt => async () => ({
  samples: Float32Array.from({ length: 16000 * 8 }, (_, i) => 0.3 * Math.sin(i / (3 + ((i >> 12) % 5)))),
  rate: 16000,
  startedAt,
});

test("the heard song must be the song playing, by title and singer", () => {
  assert.ok(sameSong({ title: "Hymn For The Weekend", artist: "Coldplay" }, "Hymn For The Weekend (feat. Beyoncé)", ["Coldplay"]));
  assert.ok(!sameSong({ title: "Hymn for the Weekend (Seeb Remix)", artist: "Coldplay & Seeb" }, "Hymn For The Weekend", ["Coldplay"]));
  assert.ok(!sameSong({ title: "Yellow", artist: "Coldplay" }, "Hymn For The Weekend", ["Coldplay"]));
  assert.ok(!sameSong({ title: "Hymn For The Weekend", artist: "Somebody Else" }, "Hymn For The Weekend", ["Coldplay"]));
});

test("an upload with a longer intro is shifted back to the studio clock, once per upload", async () => {
  const storage = memory(),
    calls = [];
  const align = createRecordingAlign({
    storage,
    capture: sound(61.5),
    invoke: async (command, args) => {
      calls.push([command, Object.keys(args)]);
      return { title: "Hymn For The Weekend", artist: "Coldplay", offset: 59.94, skew: 0.0004 };
    },
  });
  assert.equal(align.shift("video"), 0);
  const options = { audio: {}, title: "Hymn For The Weekend", artists: ["Coldplay"] };
  assert.equal(await align.measure("video", options), -1.56);
  assert.equal(align.shift("video"), -1.56);
  await align.measure("video", options);
  assert.deepEqual(calls, [["music_recognize", ["uri", "samplems"]]]);
  // Remembered across sessions, and another upload of the song has its own.
  assert.equal(createRecordingAlign({ storage, invoke: async () => null }).shift("video"), -1.56);
  assert.equal(align.shift("audio"), 0);
  assert.ok(readAlignments(storage).video);
});

test("another song, another speed or no answer leave the lyrics as they are", async () => {
  const options = { audio: {}, title: "Hymn For The Weekend", artists: ["Coldplay"] };
  for (const answer of [
    { title: "Yellow", artist: "Coldplay", offset: 30 },
    { title: "Hymn For The Weekend", artist: "Coldplay", offset: 30, skew: 0.05 },
    null,
  ]) {
    const storage = memory();
    const align = createRecordingAlign({ storage, capture: sound(10), invoke: async () => answer });
    assert.equal(await align.measure("x", options), 0);
    // Not asked again right away.
    assert.ok(align.known("x"));
  }
  // A failed listening (a jump in the song, no connection) is tried again later.
  const align = createRecordingAlign({
    storage: memory(),
    capture: async () => {
      throw Object.assign(Error(), { name: "AbortError" });
    },
    invoke: async () => null,
  });
  assert.equal(await align.measure("y", options), 0);
  assert.equal(align.known("y"), false);
});

test("broken saved shifts are ignored", () => {
  const storage = memory();
  storage.setItem(ALIGN_KEY, "[1,2]");
  assert.deepEqual(readAlignments(storage), {});
});

test("a music video nobody hears is measured from its address, and only measured shifts count", async () => {
  const heard = [];
  const align = createRecordingAlign({
    storage: memory(),
    capture: async () => assert.fail("the playing song is not listened to here"),
    captureFrom: async address => (heard.push(address), sound(48)()),
    invoke: async () => ({ title: "Song", artist: "Band", offset: 45.5 }),
  });
  assert.equal(align.value("clip"), null);
  assert.equal(await align.measure("clip", { address: "http://127.0.0.1/clip", title: "Song", artists: ["Band"] }), -2.5);
  assert.deepEqual(heard, ["http://127.0.0.1/clip"]);
  assert.equal(align.value("clip"), -2.5);
  const unknown = createRecordingAlign({ storage: memory(), capture: sound(10), invoke: async () => null });
  await unknown.measure("x", { audio: {}, title: "Song", artists: ["Band"] });
  assert.equal(unknown.value("x"), null);
});
