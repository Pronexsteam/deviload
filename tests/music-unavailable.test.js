import test from "node:test";
import assert from "node:assert/strict";
import { createUnavailableSongs } from "../src/music-unavailable.js";

function memory() {
  const data = new Map();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
}
function fakeNode() {
  const classes = new Set();
  return {
    dataset: {},
    title: "",
    classList: { toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)) },
    removeAttribute(name) {
      if (name === "title") this.title = "";
    },
    has: name => classes.has(name),
  };
}

test("a song that would not play is faded with its reason until it plays again", () => {
  const storage = memory(),
    row = fakeNode();
  let clock = 1000;
  const songs = createUnavailableSongs({
    storage,
    now: () => clock,
    root: () => null,
    describe: r => `Why: ${r}`,
  });
  songs.mark("abc", "Gone from YouTube");
  songs.flag(row, "abc");
  assert.ok(row.has("is-unavailable"));
  assert.equal(row.title, "Why: Gone from YouTube");
  const reopened = createUnavailableSongs({ storage, now: () => clock, root: () => null });
  assert.equal(reopened.reason("abc"), "Gone from YouTube", "kept between sessions");
  reopened.clear("abc");
  reopened.flag(row, "abc");
  assert.ok(!row.has("is-unavailable"));
  assert.equal(row.title, "", "the reason goes with the mark");
  songs.mark("old", "x");
  clock += 15 * 24 * 60 * 60 * 1000;
  assert.ok(
    !createUnavailableSongs({ storage, now: () => clock, root: () => null }).has("old"),
    "forgotten after two weeks",
  );
});
