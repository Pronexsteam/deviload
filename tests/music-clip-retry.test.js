import test from "node:test";
import assert from "node:assert/strict";

// Just enough of a page for the clip to create its video element and hear its events.
const nodes = [];
globalThis.addEventListener ??= () => {};
globalThis.document ??= { addEventListener() {}, hidden: false };
globalThis.document.createElement ??= () => {
  const node = { handlers: {}, style: {}, setAttribute() {}, removeAttribute() {}, pause() {}, load() {}, remove() {}, play: async () => {} };
  node.addEventListener = (name, fn) => (node.handlers[name] = fn);
  nodes.push(node);
  return node;
};
const { createMusicClip } = await import("../src/music-clip.js");
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setTimeout(resolve, 0)); };
const memory = () => { const map = new Map(); return { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)), removeItem: k => map.delete(k) }; };

test("a music video whose engine stream broke is tried again through the reserve, not the same engine stream", async () => {
  const calls = [];
  const invoke = async (command, args) => {
    calls.push(command);
    if (command === "music_catalog") return { sections: [{ items: [{ id: "AbCdEfGhIjK", kind: "song", title: "Believer (Official Music Video)", artists: ["Imagine Dragons"], duration: "3:37" }] }] };
    if (command === "music_clip_stream") return args.id ? { url: "http://127.0.0.1/engine" } : null;
    if (command === "cinema_stream") return { url: "http://127.0.0.1/reserve", height: 720, qualities: [720] };
    return null;
  };
  const song = { id: "song-1", title: "Believer", artists: ["Imagine Dragons"], duration: 216 };
  const audio = { paused: false, currentTime: 10, playbackRate: 1, addEventListener() {} };
  const clip = createMusicClip({ invoke, language: () => "en", storage: memory(), getItem: () => song, getHost: () => ({ append() {} }), isVisible: () => true, getAudio: () => audio });
  clip.toggle();
  await settle();
  const first = nodes.at(-1);
  assert.equal(first.src, "http://127.0.0.1/engine");
  // YouTube stops the engine's stream: the retry asks the reserve.
  first.handlers.error();
  await settle();
  assert.equal(nodes.at(-1).src, "http://127.0.0.1/reserve");
  assert.deepEqual(calls.filter(c => c !== "music_catalog"), ["music_clip_stream", "music_clip_stream", "cinema_stream"]);
});
