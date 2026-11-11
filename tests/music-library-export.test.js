import test from "node:test";
import assert from "node:assert/strict";
import { exportLibrary, libraryLists } from "../src/music-library-export.js";

const song = (n, extra = {}) => ({
  kind: "song",
  id: String(n).padStart(11, "0"),
  title: "Song " + n,
  artists: ["Band"],
  duration: 200 + n,
  ...extra,
});
const saved = {
  favorites: [song(1), song(2, { title: '=HYPERLINK("x")', artists: ["A, B"] })],
  playlists: [
    { name: "Road, trip", items: [song(3), { kind: "song", id: "local:abc", title: "My file", artists: [] }] },
    { name: "Empty", items: [] },
  ],
};

test("a spreadsheet keeps commas and quotes in their cells and never runs a formula", () => {
  const csv = exportLibrary(saved, "csv", { likedName: "Liked" });
  assert.ok(csv.startsWith("﻿Playlist,Title,Artists,Album,Duration,YouTube Music\r\n"));
  assert.match(csv, /\r\nLiked,Song 1,Band,,201,https:\/\/music\.youtube\.com\/watch\?v=00000000001\r\n/);
  assert.match(csv, /"'=HYPERLINK\(""x""\)","A, B"/);
  assert.match(csv, /"Road, trip",My file,,,,\r\n/);
  assert.ok(!csv.includes("Empty") && !csv.includes("local:"));
});

test("players get each song with its length and address, files on this computer stay out", () => {
  const m3u = exportLibrary(saved, "m3u", { likedName: "Liked" });
  assert.ok(m3u.startsWith("#EXTM3U\n"));
  assert.match(m3u, /#PLAYLIST:Liked\n#EXTINF:201,Band - Song 1\nhttps:\/\/music\.youtube\.com\/watch\?v=00000000001\n/);
  assert.ok(!m3u.includes("My file"));
});

test("plain data lists every playlist in order", () => {
  const data = JSON.parse(exportLibrary(saved, "json", { likedName: "Liked", now: new Date(0) }));
  assert.equal(data.exportedAt, "1970-01-01T00:00:00.000Z");
  assert.deepEqual(
    data.playlists.map(list => [list.name, list.songs.length]),
    [
      ["Liked", 2],
      ["Road, trip", 2],
    ],
  );
  assert.equal(data.playlists[1].songs[1].youtubeMusic, undefined);
  assert.equal(libraryLists({}).length, 0);
  assert.throws(() => exportLibrary(saved, "xls"));
});
