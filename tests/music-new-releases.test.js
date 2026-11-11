import test from "node:test";
import assert from "node:assert/strict";
import { releasesFromPage, mergeReleases, createNewReleases, RELEASES_KEY } from "../src/music-new-releases.js";
import { downloadMusic } from "../src/music-download.js";

const album = (id, subtitle) => ({ kind: "album", id, title: id, subtitle });
const page = items => ({ sections: [{ title: "Top songs", items: [{ kind: "song", id: "x", subtitle: "2026" }] }, { title: "Albums", items }] });
const memory = () => {
  const map = new Map();
  return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), map };
};

test("only this year's and last year's albums and singles, with the artist named", () => {
  const found = releasesFromPage(page([album("MPREa", "Single • 2026"), album("MPREb", "2025"), album("MPREc", "2019")]), { title: "Band" }, 2026);
  assert.deepEqual(found.map(item => [item.id, item.year, item.subtitle]), [
    ["MPREa", 2026, "Band · Single • 2026"],
    ["MPREb", 2025, "Band · 2025"],
  ]);
});

test("newest year first, artists take turns, and a release shared by two artists appears once", () => {
  const first = [{ id: "a1", year: 2026 }, { id: "a2", year: 2026 }, { id: "a3", year: 2025 }];
  const second = [{ id: "b1", year: 2026 }, { id: "a1", year: 2026 }];
  assert.deepEqual(mergeReleases([first, second]).map(item => item.id), ["a1", "b1", "a2", "a3"]);
  assert.equal(mergeReleases([first, second], 2).length, 2);
});

test("artist pages are read one at a time, kept for half a day, and a total failure keeps the old shelf", async () => {
  const storage = memory(),
    asked = [];
  let clock = Date.UTC(2026, 10, 12),
    broken = false;
  const artists = [{ kind: "artist", id: "UC1", title: "One" }, { kind: "artist", id: "UC2", title: "Two" }, { kind: "playlist", id: "VL1" }];
  const releases = createNewReleases({
    storage,
    now: () => clock,
    pause: async () => {},
    loadArtist: async artist => {
      asked.push(artist.id);
      if (broken) throw Error("offline");
      return page([album("MPRE" + artist.id, "Single • 2026")]);
    },
  });
  assert.deepEqual(releases.cached(artists, "en"), []);
  const items = await releases.load(artists, "en");
  assert.deepEqual(items.map(item => item.id), ["MPREUC1", "MPREUC2"]);
  assert.deepEqual(asked, ["UC1", "UC2"]);
  assert.deepEqual(releases.cached(artists, "en").map(item => item.id), ["MPREUC1", "MPREUC2"]);
  await releases.load(artists, "en");
  assert.equal(asked.length, 2);
  clock += 13 * 3600000;
  broken = true;
  assert.deepEqual((await releases.load(artists, "en")).map(item => item.id), ["MPREUC1", "MPREUC2"]);
  assert.ok(storage.map.has(RELEASES_KEY));
  assert.deepEqual(await releases.load([], "en"), []);
});

test("a whole playlist goes to downloads as one request of song links", async () => {
  const calls = [];
  const invoke = async (command, args) => {
    calls.push([command, args.text]);
    return command === "preflight_download" ? { ready: true, blockers: [] } : 2;
  };
  const songs = [{ kind: "song", id: "aaaaaaaaaaa" }, { kind: "song", id: "bbbbbbbbbbb" }];
  assert.equal(await downloadMusic(invoke, songs, { cookiesMode: "none" }), 2);
  assert.equal(calls.at(-1)[1], "https://www.youtube.com/watch?v=aaaaaaaaaaa\nhttps://www.youtube.com/watch?v=bbbbbbbbbbb");
  await assert.rejects(downloadMusic(invoke, [], {}));
  await assert.rejects(downloadMusic(invoke, [{ kind: "song", id: "local:x" }], {}));
});
