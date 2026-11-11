import test from "node:test";
import assert from "node:assert/strict";
import { likedEntry, libraryPlaylists, joinLibrary, readLibrary } from "../src-tauri/spotify-import.mjs";

const track = (id, name, artist) => ({
  track: {
    _uri: "spotify:track:" + id,
    data: {
      __typename: "Track",
      name,
      artists: { items: [{ profile: { name: artist } }] },
      albumOfTrack: { name: "Album" },
      duration: { totalMilliseconds: 201000 },
    },
  },
});
const A = "4Mcivvdi3voJG7aYosxtnT",
  B = "7lBwQzYymGLZz9ybb4isD0";

test("liked songs keep their identity and skip what is not a song", () => {
  assert.deepEqual(likedEntry(track(A, "First", "Artist")), {
    key: "spotify:track:" + A,
    spotifyId: A,
    title: "First",
    artists: ["Artist"],
    album: "Album",
    liked: true,
    plays: 0,
    durationMs: 201000,
  });
  assert.equal(likedEntry({ track: { _uri: "spotify:episode:" + A, data: { __typename: "Episode" } } }), null);
  assert.equal(likedEntry(track("short", "Bad", "Artist")), null);
  assert.equal(likedEntry(track(A, "", "Artist")), null);
});

test("library playlists come out flat, without folders or other items", () => {
  const page = {
    data: {
      me: {
        libraryV3: {
          items: [
            { item: { __typename: "PlaylistResponseWrapper", _uri: "spotify:playlist:37i9dQZF1DZ06evO3eIivx", data: { name: "Road" } } },
            { item: { __typename: "FolderResponseWrapper", _uri: "spotify:user:x:folder:1" } },
            { item: { __typename: "PlaylistResponseWrapper", _uri: "spotify:playlist:bad", data: { name: "Bad" } } },
            { item: { __typename: "PlaylistResponseWrapper", _uri: "spotify:playlist:2WkXJXAOqb1MQWhPrlGdlL", data: {} } },
          ],
        },
      },
    },
  };
  assert.deepEqual(libraryPlaylists(page), [
    { id: "37i9dQZF1DZ06evO3eIivx", name: "Road" },
    { id: "2WkXJXAOqb1MQWhPrlGdlL", name: "Spotify playlist" },
  ]);
  assert.throws(() => libraryPlaylists({ data: {} }));
});

test("a liked song appears once and stays liked inside playlists", () => {
  const liked = [likedEntry(track(A, "First", "Artist"))];
  const road = { name: "Road", entries: [{ ...liked[0], liked: false }, { key: "spotify:track:" + B, title: "Second", artists: ["X"], liked: false, plays: 0 }] };
  const result = joinLibrary(liked, [road, { name: "Empty", entries: [] }], 0);
  assert.equal(result.entries.length, 2);
  assert.equal(result.entries[0].liked, true);
  assert.equal(result.entries[1].liked, false);
  assert.deepEqual(result.playlists.map(list => list.name), ["Liked Songs", "Road"]);
  assert.equal(result.completeness, "complete");
  assert.equal(result.origin, "account");
  const partial = joinLibrary(liked, [], 3);
  assert.equal(partial.completeness, "unknown");
  assert.equal(partial.warnings.length, 1);
});

test("a missing or malformed sign-in stops before any request", async () => {
  let requests = 0;
  const fetcher = async () => {
    requests++;
    throw Error("no network in tests");
  };
  await assert.rejects(readLibrary("", { fetcher }), /Sign in to Spotify again/);
  await assert.rejects(readLibrary("bad value; other=1", { fetcher }), /Sign in to Spotify again/);
  assert.equal(requests, 0);
});
