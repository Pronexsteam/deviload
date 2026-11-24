import test from "node:test";
import assert from "node:assert/strict";
import { aiArtistFilter } from "../src/music-ai-filter.js";
import { recommendationAllowed } from "../src/music-taste.js";
import { playbackCandidates } from "../src/music-playback-candidates.js";

test("AI-made artists leave recommendations and automatic radio only while the filter has a list", () => {
  const ai = { id: "aaaaaaaaaaa", title: "Song", artists: ["Neural Groove Machine"] },
    human = { id: "bbbbbbbbbbb", title: "Song", artists: ["Daft Punk"] };
  aiArtistFilter.set(null);
  assert.equal(recommendationAllowed({})(ai), true, "off by default");
  aiArtistFilter.set(new Set(["neural groove machine"]));
  assert.equal(recommendationAllowed({})(ai), false);
  assert.equal(recommendationAllowed({})(human), true);
  const queue = [human, ai];
  const kept = playbackCandidates(queue, {
    automatic: new Set([ai.id, human.id]),
    currentId: "x",
    artistKey: name => name.toLowerCase(),
    excluded: key => aiArtistFilter.has(key),
  });
  assert.deepEqual(
    kept.map(item => item.id),
    [human.id],
  );
  const manual = playbackCandidates(queue, { automatic: new Set(), currentId: "x", excluded: () => true });
  assert.equal(manual, queue, "songs the listener chose are never removed");
  aiArtistFilter.set(null);
});
