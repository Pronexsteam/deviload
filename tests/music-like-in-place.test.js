import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// The like handler lives inside the player; run its in-place update on a small stand-in page.
const source = await readFile(new URL("../src/devil-music.js", import.meta.url), "utf8");
const start = source.indexOf("  function showLike(item) {");
const end = source.indexOf("  function toggleShuffle() {", start);
const body = source.slice(start, end);

test("liking a song in a list updates its heart and menu entry where they are, without rebuilding the page", () => {
  const heart = { textContent: "♡", attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
  const label = { textContent: "Like this song" };
  const option = {
    title: "Like this song",
    attrs: { "aria-label": "Like this song" },
    getAttribute(k) { return this.attrs[k]; },
    setAttribute(k, v) { this.attrs[k] = v; },
    querySelector: () => label,
  };
  const row = { dataset: { trackId: "song-1" }, querySelectorAll: s => (s === ".music-like" ? [heart] : [option]) };
  const other = { dataset: { trackId: "song-2" }, querySelectorAll: () => { throw Error("another song's row was touched"); } };
  const document = { querySelectorAll: () => [row, other] };
  const saved = { favorites: [{ id: "song-1" }] };
  const t = text => text;
  const showLike = new Function("document", "saved", "t", `${body}; return showLike;`)(document, saved, t);
  showLike({ id: "song-1" });
  assert.equal(heart.textContent, "♥");
  assert.equal(heart.attrs["aria-pressed"], "true");
  assert.equal(option.attrs["aria-label"], "Remove from liked songs");
  assert.equal(label.textContent, "Remove from liked songs");
  // Both list hearts call it instead of re-rendering the page.
  assert.equal((source.match(/else showLike\(item\);/g) || []).length, 2);
});
