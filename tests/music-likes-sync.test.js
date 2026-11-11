import test from "node:test";
import assert from "node:assert/strict";
globalThis.document ??= { documentElement: { lang: "en" } };
const { createLikesSync, readLikesSync, LIKES_SYNC_KEY } = await import("../src/music-likes-sync.js");
const { t } = await import("../src/i18n.js");

const memory = () => {
  const map = new Map();
  return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), map };
};
const like = n => ({ videoId: String(n).padStart(11, "0"), title: "Song " + n, artists: ["A"], liked: true });

test("likes come over once each, only while turned on and once a day", async () => {
  const storage = memory(),
    calls = [],
    notes = [];
  let clock = 1_000_000,
    account = [like(1), like(2)];
  const liked = new Set();
  const sync = createLikesSync({
    storage,
    now: () => clock,
    notify: (message, error) => notes.push([message, !!error]),
    invoke: async (command, args) => (calls.push([command, args]), { entries: account }),
    add: async entries => entries.filter(entry => !liked.has(entry.videoId) && liked.add(entry.videoId)).length,
  });
  // Off by default: starting the app reads nothing.
  assert.equal(await sync.maybe(), 0);
  assert.equal(calls.length, 0);
  sync.setEnabled(true);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(calls, [["music_youtube_liked", { limit: 200 }]]);
  assert.equal(liked.size, 2);
  assert.equal(readLikesSync(storage).enabled, true);
  // Within a day nothing is read again.
  clock += 3600000;
  await sync.maybe();
  assert.equal(calls.length, 1);
  // Removed here, still liked there: the next day does not bring it back; a new like does come.
  liked.delete(like(1).videoId);
  account = [like(3), like(1), like(2)];
  clock += 86400000;
  assert.equal(await sync.maybe(), 1);
  assert.deepEqual([...liked].sort(), [like(2).videoId, like(3).videoId]);
  assert.equal(notes.at(-1)[0], t("New likes from YouTube Music: {count}", { count: 1 }));
});

test("a quiet daily reading that fails stays quiet; the button explains", async () => {
  const notes = [];
  const sync = createLikesSync({
    storage: memory(),
    notify: (message, error) => notes.push([message, !!error]),
    invoke: async () => {
      throw Error("Sign in to YouTube in Music settings first.");
    },
    add: async () => 0,
  });
  sync.setEnabled(true);
  await new Promise(resolve => setTimeout(resolve, 0));
  notes.length = 0;
  await sync.maybe();
  assert.equal(notes.length, 0);
  await assert.rejects(sync.sync());
  assert.equal(notes.at(-1)[1], true);
});

test("broken saved state starts turned off", () => {
  const storage = memory();
  storage.setItem(LIKES_SYNC_KEY, "{oops");
  assert.deepEqual(readLikesSync(storage), { enabled: false, last: 0, seen: [] });
});
